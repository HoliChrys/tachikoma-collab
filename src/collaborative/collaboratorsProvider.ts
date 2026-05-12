import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { CollaborationManager } from './collaborationManager';
import type { ContextNode } from '../types';
import { log, logError } from '../log';

interface UserItem {
    user_id: string;
    name: string;
    state: string;
    user_type: string;
    contexts: string[];
}

type CollabNode =
    | { kind: 'header'; label: string; description?: string; children: CollabNode[] }
    | { kind: 'user'; user: UserItem; isLive: boolean }
    | { kind: 'empty'; label: string };

export class CollaboratorsProvider implements vscode.TreeDataProvider<CollabNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CollabNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private allUsers: UserItem[] = [];
    private liveParticipants = new Set<string>();
    private client: TachikomaClient | null = null;
    private selectedContext: ContextNode | null = null;
    private disposable: vscode.Disposable | null = null;
    private refreshTimer: ReturnType<typeof setInterval> | null = null;

    setClient(client: TachikomaClient | null): void {
        this.client = client;
        if (client) {
            void this.fetchUsers();
            this.refreshTimer = setInterval(() => void this.fetchUsers(), 30_000);
        } else {
            this.allUsers = [];
            this.liveParticipants.clear();
            this.selectedContext = null;
            if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    setSelectedContext(ctx: ContextNode): void {
        this.selectedContext = ctx;
        log(`Context selected: ${ctx.path} (${ctx.type})`);
        this._onDidChangeTreeData.fire(undefined);
    }

    bind(manager: CollaborationManager): void {
        this.disposable?.dispose();
        this.disposable = manager.onParticipantsChanged((ps) => {
            this.liveParticipants = new Set(ps);
            this._onDidChangeTreeData.fire(undefined);
        });
    }

    unbind(): void {
        this.disposable?.dispose();
        this.disposable = null;
        this.liveParticipants.clear();
        this._onDidChangeTreeData.fire(undefined);
    }

    private async fetchUsers(): Promise<void> {
        if (!this.client) return;
        try {
            const users = await this.client.listUsers() as UserItem[];

            // Fetch contexts for each user
            for (const u of users) {
                try {
                    const resp = await this.client.getUserContexts(u.user_id);
                    u.contexts = resp.contexts ?? [];
                } catch {
                    u.contexts = [];
                }
            }

            this.allUsers = users;
            log(`Loaded ${users.length} users with contexts`);
        } catch (err) {
            logError('Failed to load users', err);
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    private usersForContext(): UserItem[] {
        if (!this.selectedContext) return this.allUsers;

        const ctxPath = this.selectedContext.path;
        return this.allUsers.filter((u) => {
            if (!u.contexts || u.contexts.length === 0) return false;
            return u.contexts.some((c) =>
                c === 'global' || c === ctxPath || ctxPath.startsWith(c + '.') || c.startsWith(ctxPath + '.')
            );
        });
    }

    getTreeItem(element: CollabNode): vscode.TreeItem {
        if (element.kind === 'header') {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
            item.iconPath = new vscode.ThemeIcon('organization');
            item.description = element.description;
            return item;
        }

        if (element.kind === 'empty') {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('info');
            return item;
        }

        const u = element.user;
        const displayName = u.name || u.user_id;
        const item = new vscode.TreeItem(displayName, vscode.TreeItemCollapsibleState.None);

        if (element.isLive) {
            item.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
            item.description = 'editing';
        } else if (u.state === 'active') {
            item.iconPath = new vscode.ThemeIcon('account');
            item.description = u.user_type;
        } else {
            item.iconPath = new vscode.ThemeIcon('circle-outline');
            item.description = u.state;
        }

        item.tooltip = `${u.user_id} (${u.user_type}) — contexts: ${(u.contexts ?? []).join(', ') || 'none'}`;
        return item;
    }

    getChildren(element?: CollabNode): CollabNode[] {
        if (!element) {
            const contextUsers = this.usersForContext();
            const live: CollabNode[] = [];
            const granted: CollabNode[] = [];

            for (const u of contextUsers) {
                const isLive = this.liveParticipants.has(u.user_id);
                const node: CollabNode = { kind: 'user', user: u, isLive };
                if (isLive) live.push(node);
                granted.push(node);
            }

            for (const pid of this.liveParticipants) {
                if (!contextUsers.some((u) => u.user_id === pid)) {
                    live.push({
                        kind: 'user',
                        user: { user_id: pid, name: pid, state: 'active', user_type: 'unknown', contexts: [] },
                        isLive: true,
                    });
                }
            }

            const ctxLabel = this.selectedContext?.name ?? 'all';
            const sections: CollabNode[] = [];

            if (live.length > 0) {
                sections.push({ kind: 'header', label: `Live (${live.length})`, children: live });
            }

            if (granted.length > 0) {
                sections.push({
                    kind: 'header',
                    label: `Granted (${granted.length})`,
                    description: ctxLabel,
                    children: granted,
                });
            } else if (this.selectedContext) {
                sections.push({
                    kind: 'empty',
                    label: `No users granted on ${ctxLabel}`,
                });
            }

            return sections;
        }

        if (element.kind === 'header') {
            return element.children;
        }

        return [];
    }
}
