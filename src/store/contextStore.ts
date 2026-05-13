import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import { EventBus, type MonorepoEvent } from '../collaborative/sseClient';
import type { ContextStoreNode, HierarchyItem, UserRecord } from '../types';
import { log, logError } from '../log';

export class ContextStore implements vscode.Disposable {
    private nodes = new Map<string, ContextStoreNode>();
    private activeContexts = new Set<string>();
    private openBufferContexts = new Map<string, number>(); // contextPath → open buffer count
    private users = new Map<string, UserRecord>();
    private client: TachikomaClient | null = null;
    private eventBus: EventBus | null = null;
    private myUserId = '';

    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    async init(client: TachikomaClient, userId: string): Promise<void> {
        this.client = client;
        this.myUserId = userId;
        await this.loadInitialState();
        this.connectEventStream();
    }

    private async loadInitialState(): Promise<void> {
        if (!this.client) return;
        log('ContextStore: loading initial state...');

        try {
            const [galaxies, systems, spaces, userList] = await Promise.all([
                this.client.getGalaxies(),
                this.client.getSystems(),
                this.client.getSpaces(),
                this.client.listUsers() as Promise<UserRecord[]>,
            ]);

            this.nodes.clear();
            this.buildTree(galaxies, systems, spaces);

            // Load user contexts
            this.users.clear();
            await Promise.all(userList.map(async (u) => {
                try {
                    const resp = await this.client!.getUserContexts(u.user_id);
                    u.contexts = resp.contexts ?? [];
                } catch {
                    u.contexts = [];
                }
                this.users.set(u.user_id, u);

                // Populate grantedUsers on nodes
                for (const ctx of u.contexts) {
                    const node = this.nodes.get(ctx);
                    if (node) node.grantedUsers.add(u.user_id);
                    // "global" grant → add to all nodes
                    if (ctx === 'global') {
                        for (const n of this.nodes.values()) {
                            n.grantedUsers.add(u.user_id);
                        }
                    }
                }
            }));

            log(`ContextStore: loaded ${this.nodes.size} contexts, ${this.users.size} users`);
            this._onDidChange.fire();
        } catch (err) {
            logError('ContextStore: failed to load initial state', err);
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
        const stream = this.eventBus.subscribe({
            eventTypes: [
                'component.participant_joined', 'component.participant_left',
                'space.created', 'space.updated',
                'user.activated', 'user.suspended', 'user.created',
            ],
        });

        void (async () => {
            try {
                for await (const event of stream) {
                    this.handleEvent(event);
                }
            } catch {
                log('ContextStore: SSE stream ended');
            }
        })();
    }

    private handleEvent(event: MonorepoEvent): void {
        switch (event.event_type) {
            case 'component.participant_joined': {
                const ctx = this.resolveContextFromEvent(event);
                const uid = event.participant_id as string;
                if (ctx && uid && uid !== this.myUserId) {
                    ctx.activeUsers.add(uid);
                    this._onDidChange.fire();
                }
                break;
            }
            case 'component.participant_left': {
                const ctx = this.resolveContextFromEvent(event);
                const uid = event.participant_id as string;
                if (ctx && uid) {
                    ctx.activeUsers.delete(uid);
                    this._onDidChange.fire();
                }
                break;
            }
            case 'space.created': {
                const path = event.space_path as string;
                const name = path?.split('.').pop() ?? '';
                const parentPath = path?.split('.').slice(0, -1).join('.') ?? '';
                if (path && !this.nodes.has(path)) {
                    this.nodes.set(path, {
                        path, name, type: 'space', parentPath,
                        hive_channel: (event.hive_channel as string) ?? '',
                        active: false, activeUsers: new Set(), grantedUsers: new Set(), children: [],
                    });
                    const parent = this.nodes.get(parentPath);
                    if (parent) parent.children.push(path);
                    this._onDidChange.fire();
                }
                break;
            }
            case 'user.created':
            case 'user.activated':
            case 'user.suspended': {
                const uid = (event.user_id ?? event.entity_id) as string;
                if (uid) {
                    const existing = this.users.get(uid);
                    if (existing) {
                        existing.state = event.event_type === 'user.suspended' ? 'suspended' : 'active';
                    }
                    this._onDidChange.fire();
                }
                break;
            }
        }
    }

    private resolveContextFromEvent(event: MonorepoEvent): ContextStoreNode | undefined {
        const channel = event.channel as string;
        if (!channel) return undefined;
        // Channel format: "monorepo.tachikoma.paralelle.sdk" → context "tachikoma.paralelle.sdk"
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
            // Activate this context + all parents
            let path = ctxPath;
            while (path) {
                this.activeContexts.add(path);
                const node = this.nodes.get(path);
                if (node) node.active = true;
                // Walk up: "tachikoma.paralelle.sdk" → "tachikoma.paralelle" → "tachikoma"
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
        this._onDidChange.dispose();
    }
}
