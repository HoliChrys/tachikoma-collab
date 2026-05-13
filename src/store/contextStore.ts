import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import { EventBus, type MonorepoEvent } from '../collaborative/sseClient';
import type { ContextStoreNode, HierarchyItem, UserRecord } from '../types';
import type { ContextSessionGroup, TmuxSessionInfo } from '../sessions/sessionTypes';
import { log, logError } from '../log';
import { PersistentCache, type CacheSnapshot } from './persistentCache';

type SyncState = 'disconnected' | 'hydrating' | 'syncing' | 'synced' | 'stale';

export class ContextStore implements vscode.Disposable {
    private nodes = new Map<string, ContextStoreNode>();
    private activeContexts = new Set<string>();
    private openBufferContexts = new Map<string, number>();
    private users = new Map<string, UserRecord>();
    private sessions: ContextSessionGroup[] = [];
    private tmuxSessions: TmuxSessionInfo[] = [];

    private client: TachikomaClient | null = null;
    private eventBus: EventBus | null = null;
    private cache: PersistentCache;
    private myUserId = '';
    private host = '';
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private state: SyncState = 'disconnected';

    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    private readonly _onSyncStateChanged = new vscode.EventEmitter<SyncState>();
    readonly onSyncStateChanged = this._onSyncStateChanged.event;

    constructor(globalState: vscode.Memento) {
        this.cache = new PersistentCache(globalState);
    }

    getSyncState(): SyncState {
        return this.state;
    }

    private setState(s: SyncState): void {
        if (this.state !== s) {
            this.state = s;
            this._onSyncStateChanged.fire(s);
        }
    }

    async init(client: TachikomaClient, userId: string): Promise<void> {
        this.client = client;
        this.myUserId = userId;
        this.host = client.baseUrl;

        // Step 1: hydrate from cache instantly (if available)
        const cached = this.cache.load(this.host, userId);
        if (cached) {
            this.hydrateFromCache(cached);
            this.setState('stale');
            this._onDidChange.fire();
        } else {
            this.setState('hydrating');
        }

        // Step 2: subscribe to SSE for live deltas
        this.connectEventStream();

        // Step 3: background resync to converge with server truth
        void this.resync();
    }

    private hydrateFromCache(snap: CacheSnapshot): void {
        this.nodes.clear();
        this.buildTree(snap.galaxies, snap.systems, snap.spaces);

        this.users.clear();
        for (const u of snap.users) {
            this.users.set(u.user_id, u);
            for (const ctx of u.contexts ?? []) {
                const node = this.nodes.get(ctx);
                if (node) node.grantedUsers.add(u.user_id);
                if (ctx === 'global') {
                    for (const n of this.nodes.values()) {
                        n.grantedUsers.add(u.user_id);
                    }
                }
            }
        }

        this.sessions = snap.sessions ?? [];
        this.tmuxSessions = snap.tmuxSessions ?? [];

        log(`Hydrated from cache: ${this.nodes.size} contexts, ${this.users.size} users, ${this.sessions.length} session groups`);
    }

    private async resync(): Promise<void> {
        if (!this.client) return;
        this.setState('syncing');
        log('ContextStore: resyncing from API...');

        try {
            const [galaxies, systems, spaces, userList, sessionsResp, tmuxResp] = await Promise.all([
                this.client.getGalaxies(),
                this.client.getSystems(),
                this.client.getSpaces(),
                this.client.listUsers() as Promise<UserRecord[]>,
                this.client.listSessionsByContext().catch(() => ({ groups: [], total_active: 0, total_exited: 0 })),
                this.client.listTmuxSessions().catch(() => ({ sessions: [] })),
            ]);

            // Preserve active contexts + live users state across rebuild
            const prevActive = new Set(this.activeContexts);
            const prevActiveUsers = new Map<string, Set<string>>();
            for (const [k, v] of this.nodes) {
                if (v.activeUsers.size > 0) prevActiveUsers.set(k, new Set(v.activeUsers));
            }

            this.nodes.clear();
            this.buildTree(galaxies, systems, spaces);

            // Resolve user contexts in parallel
            this.users.clear();
            await Promise.all(userList.map(async (u) => {
                try {
                    const resp = await this.client!.getUserContexts(u.user_id);
                    u.contexts = resp.contexts ?? [];
                } catch {
                    u.contexts = [];
                }
                this.users.set(u.user_id, u);
                for (const ctx of u.contexts) {
                    const node = this.nodes.get(ctx);
                    if (node) node.grantedUsers.add(u.user_id);
                    if (ctx === 'global') {
                        for (const n of this.nodes.values()) {
                            n.grantedUsers.add(u.user_id);
                        }
                    }
                }
            }));

            this.sessions = sessionsResp.groups ?? [];
            this.tmuxSessions = tmuxResp.sessions ?? [];

            // Restore active state
            this.openBufferContexts.forEach((_, ctx) => {
                if (this.nodes.has(ctx) || prevActive.has(ctx)) {
                    // active context still valid
                }
            });
            for (const [k, set] of prevActiveUsers) {
                const node = this.nodes.get(k);
                if (node) node.activeUsers = set;
            }
            this.recalculateActive();

            this.setState('synced');
            log(`Resynced: ${galaxies.length} galaxies, ${systems.length} systems, ${spaces.length} spaces, ${userList.length} users, ${this.sessions.length} session groups, ${this.tmuxSessions.length} tmux`);
            this._onDidChange.fire();
            this.schedulePersist();
        } catch (err) {
            logError('Resync failed', err);
            this.setState('stale');
        }
    }

    private buildTree(galaxies: HierarchyItem[], systems: HierarchyItem[], spaces: HierarchyItem[]): void {
        for (const g of galaxies) {
            this.nodes.set(g.path, {
                path: g.path, name: g.name, type: 'galaxy',
                parentPath: '', hive_channel: g.hive_channel,
                active: false, activeUsers: new Set(), grantedUsers: new Set(), children: [],
            });
        }
        for (const s of systems) {
            this.nodes.set(s.path, {
                path: s.path, name: s.name, type: 'system',
                parentPath: s.parent_path, hive_channel: s.hive_channel,
                active: false, activeUsers: new Set(), grantedUsers: new Set(), children: [],
            });
            const parent = this.nodes.get(s.parent_path);
            if (parent) parent.children.push(s.path);
        }
        for (const s of spaces) {
            this.nodes.set(s.path, {
                path: s.path, name: s.name, type: 'space',
                parentPath: s.parent_path, hive_channel: s.hive_channel,
                active: false, activeUsers: new Set(), grantedUsers: new Set(), children: [],
            });
            const parent = this.nodes.get(s.parent_path);
            if (parent) parent.children.push(s.path);
        }
    }

    private connectEventStream(): void {
        if (!this.client) return;
        const token = this.client.getToken();
        if (!token) return;

        this.eventBus = new EventBus({ token, baseUrl: this.client.baseUrl });
        const stream = this.eventBus.subscribe(
            {
                eventTypes: [
                    // Hierarchy
                    'space.created', 'space.updated', 'space.shared', 'space.unshared',
                    // Users
                    'user.created', 'user.activated', 'user.suspended', 'user.removed',
                    // Sessions
                    'session.discovered', 'session.activated', 'session.suspended',
                    'tmux_session.created', 'tmux_session.killed', 'tmux_session.hibernated',
                    'tmux_session.resumed',
                    // Collab
                    'component.participant_joined', 'component.participant_left',
                    // ACL
                    'context.access.granted', 'context.access.revoked',
                ],
            },
            (connected) => {
                if (connected && this.state === 'stale') this.setState('synced');
                else if (!connected) this.setState('stale');
            },
        );

        void (async () => {
            try {
                for await (const event of stream) {
                    this.handleEvent(event);
                }
            } catch {
                log('ContextStore: SSE stream ended');
                this.setState('stale');
            }
        })();
    }

    private handleEvent(event: MonorepoEvent): void {
        let changed = false;
        switch (event.event_type) {
            case 'component.participant_joined': {
                const ctx = this.resolveContextFromEvent(event);
                const uid = event.participant_id as string;
                if (ctx && uid && uid !== this.myUserId) {
                    ctx.activeUsers.add(uid);
                    changed = true;
                }
                break;
            }
            case 'component.participant_left': {
                const ctx = this.resolveContextFromEvent(event);
                const uid = event.participant_id as string;
                if (ctx && uid) {
                    ctx.activeUsers.delete(uid);
                    changed = true;
                }
                break;
            }
            case 'space.created': {
                const path = event.space_path as string;
                if (path && !this.nodes.has(path)) {
                    const parts = path.split('.');
                    const name = parts[parts.length - 1];
                    const parentPath = parts.slice(0, -1).join('.');
                    const type: 'galaxy' | 'system' | 'space' =
                        parts.length === 1 ? 'galaxy' :
                        parts.length === 2 ? 'system' : 'space';
                    this.nodes.set(path, {
                        path, name, type, parentPath,
                        hive_channel: (event.hive_channel as string) ?? '',
                        active: false, activeUsers: new Set(), grantedUsers: new Set(), children: [],
                    });
                    const parent = this.nodes.get(parentPath);
                    if (parent && !parent.children.includes(path)) parent.children.push(path);
                    changed = true;
                }
                break;
            }
            case 'space.updated':
            case 'space.shared':
            case 'space.unshared':
                // Schedule a partial resync — these are infrequent
                void this.resync();
                break;

            case 'user.created':
            case 'user.activated':
            case 'user.suspended':
            case 'user.removed': {
                const uid = (event.user_id ?? event.entity_id) as string;
                if (uid) {
                    const existing = this.users.get(uid);
                    if (event.event_type === 'user.removed') {
                        this.users.delete(uid);
                    } else if (existing) {
                        existing.state = event.event_type === 'user.suspended' ? 'suspended' : 'active';
                    } else if (event.event_type === 'user.created') {
                        // New user — fetch their contexts on demand
                        void this.fetchUser(uid);
                    }
                    changed = true;
                }
                break;
            }

            case 'session.discovered':
            case 'session.activated':
            case 'session.suspended':
            case 'tmux_session.created':
            case 'tmux_session.killed':
            case 'tmux_session.hibernated':
            case 'tmux_session.resumed':
                // Refresh sessions in the background
                void this.refreshSessions();
                break;

            case 'context.access.granted': {
                const uid = (event.user_or_agent_id ?? event.user_id) as string;
                const ctxPath = (event.context_path ?? event.context_id) as string;
                if (uid && ctxPath) {
                    const u = this.users.get(uid);
                    if (u && !u.contexts.includes(ctxPath)) {
                        u.contexts = [...u.contexts, ctxPath];
                    }
                    const node = this.nodes.get(ctxPath);
                    if (node) node.grantedUsers.add(uid);
                    changed = true;
                }
                break;
            }
            case 'context.access.revoked': {
                const uid = (event.user_or_agent_id ?? event.user_id) as string;
                const ctxPath = (event.context_path ?? event.context_id) as string;
                if (uid && ctxPath) {
                    const u = this.users.get(uid);
                    if (u) u.contexts = u.contexts.filter((c) => c !== ctxPath);
                    const node = this.nodes.get(ctxPath);
                    if (node) node.grantedUsers.delete(uid);
                    changed = true;
                }
                break;
            }
        }
        if (changed) {
            this._onDidChange.fire();
            this.schedulePersist();
        }
    }

    private async fetchUser(uid: string): Promise<void> {
        if (!this.client) return;
        try {
            const users = await this.client.listUsers() as UserRecord[];
            const newUser = users.find((u) => u.user_id === uid);
            if (!newUser) return;
            try {
                const resp = await this.client.getUserContexts(uid);
                newUser.contexts = resp.contexts ?? [];
            } catch {
                newUser.contexts = [];
            }
            this.users.set(uid, newUser);
            this._onDidChange.fire();
            this.schedulePersist();
        } catch (err) {
            logError(`Failed to fetch new user ${uid}`, err);
        }
    }

    private async refreshSessions(): Promise<void> {
        if (!this.client) return;
        try {
            const [sessionsResp, tmuxResp] = await Promise.all([
                this.client.listSessionsByContext().catch(() => ({ groups: [], total_active: 0, total_exited: 0 })),
                this.client.listTmuxSessions().catch(() => ({ sessions: [] })),
            ]);
            this.sessions = sessionsResp.groups ?? [];
            this.tmuxSessions = tmuxResp.sessions ?? [];
            this._onDidChange.fire();
            this.schedulePersist();
        } catch (err) {
            logError('Sessions refresh failed', err);
        }
    }

    private schedulePersist(): void {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => void this.persist(), 500);
    }

    private async persist(): Promise<void> {
        try {
            await this.cache.save({
                host: this.host,
                userId: this.myUserId,
                galaxies: [...this.nodes.values()].filter((n) => n.type === 'galaxy').map(this.nodeToItem),
                systems: [...this.nodes.values()].filter((n) => n.type === 'system').map(this.nodeToItem),
                spaces: [...this.nodes.values()].filter((n) => n.type === 'space').map(this.nodeToItem),
                users: [...this.users.values()],
                sessions: this.sessions,
                tmuxSessions: this.tmuxSessions,
            });
        } catch (err) {
            logError('Cache persist failed', err);
        }
    }

    private nodeToItem(n: ContextStoreNode): HierarchyItem {
        return {
            id: n.path,
            name: n.name,
            level: n.type,
            path: n.path,
            parent_path: n.parentPath,
            owner_id: '',
            hive_channel: n.hive_channel,
            tools: [],
            packages: [],
        };
    }

    private resolveContextFromEvent(event: MonorepoEvent): ContextStoreNode | undefined {
        const channel = event.channel as string;
        if (!channel) return undefined;
        const prefix = 'monorepo.';
        const ctxPath = channel.startsWith(prefix) ? channel.slice(prefix.length) : channel;
        return this.nodes.get(ctxPath);
    }

    // --- Activation ---

    activateContext(contextPath: string): void {
        const count = (this.openBufferContexts.get(contextPath) ?? 0) + 1;
        this.openBufferContexts.set(contextPath, count);
        this.recalculateActive();
    }

    deactivateContext(contextPath: string): void {
        const count = (this.openBufferContexts.get(contextPath) ?? 1) - 1;
        if (count <= 0) {
            this.openBufferContexts.delete(contextPath);
        } else {
            this.openBufferContexts.set(contextPath, count);
        }
        this.recalculateActive();
    }

    private recalculateActive(): void {
        this.activeContexts.clear();
        for (const node of this.nodes.values()) {
            node.active = false;
        }

        for (const ctxPath of this.openBufferContexts.keys()) {
            let path = ctxPath;
            while (path) {
                this.activeContexts.add(path);
                const node = this.nodes.get(path);
                if (node) node.active = true;
                const lastDot = path.lastIndexOf('.');
                path = lastDot > 0 ? path.substring(0, lastDot) : '';
            }
        }

        this._onDidChange.fire();
    }

    // --- Queries ---

    getRoots(): ContextStoreNode[] {
        return [...this.nodes.values()].filter((n) => n.type === 'galaxy');
    }

    getChildren(parentPath: string): ContextStoreNode[] {
        const parent = this.nodes.get(parentPath);
        if (!parent) return [];
        return parent.children.map((c) => this.nodes.get(c)).filter(Boolean) as ContextStoreNode[];
    }

    getNode(path: string): ContextStoreNode | undefined {
        return this.nodes.get(path);
    }

    getSessions(): ContextSessionGroup[] {
        return this.sessions;
    }

    getTmuxSessions(): TmuxSessionInfo[] {
        return this.tmuxSessions;
    }

    async invalidateCache(): Promise<void> {
        await this.cache.invalidate();
        await this.resync();
    }

    getActiveCollaborators(): UserRecord[] {
        if (this.activeContexts.size === 0) {
            return [...this.users.values()];
        }

        const activeUserIds = new Set<string>();
        for (const ctxPath of this.activeContexts) {
            const node = this.nodes.get(ctxPath);
            if (!node) continue;
            for (const uid of node.activeUsers) {
                activeUserIds.add(uid);
            }
        }

        return [...activeUserIds]
            .map((uid) => this.users.get(uid))
            .filter(Boolean) as UserRecord[];
    }

    getGrantedUsers(): UserRecord[] {
        if (this.activeContexts.size === 0) {
            return [...this.users.values()];
        }

        const grantedIds = new Set<string>();
        for (const ctxPath of this.activeContexts) {
            const node = this.nodes.get(ctxPath);
            if (!node) continue;
            for (const uid of node.grantedUsers) {
                grantedIds.add(uid);
            }
        }

        return [...grantedIds]
            .map((uid) => this.users.get(uid))
            .filter(Boolean) as UserRecord[];
    }

    isActive(path: string): boolean {
        return this.activeContexts.has(path);
    }

    getActiveContextPaths(): string[] {
        return [...this.activeContexts];
    }

    dispose(): void {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this._onDidChange.dispose();
        this._onSyncStateChanged.dispose();
    }
}

export type { SyncState };
