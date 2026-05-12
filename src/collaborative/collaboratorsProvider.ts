import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { CollaborationManager } from './collaborationManager';
import { log, logError } from '../log';

interface UserItem {
    user_id: string;
    name: string;
    state: string;
    user_type: string;
}

type CollabNode =
    | { kind: 'section'; label: string; children: CollabNode[] }
    | { kind: 'user'; user: UserItem; isLive: boolean };

export class CollaboratorsProvider implements vscode.TreeDataProvider<CollabNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CollabNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private users: UserItem[] = [];
    private liveParticipants = new Set<string>();
    private client: TachikomaClient | null = null;
    private disposable: vscode.Disposable | null = null;
    private refreshTimer: ReturnType<typeof setInterval> | null = null;

    setClient(client: TachikomaClient | null): void {
        this.client = client;
        if (client) {
            void this.fetchUsers();
            this.refreshTimer = setInterval(() => void this.fetchUsers(), 30_000);
        } else {
            this.users = [];
            this.liveParticipants.clear();
            if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
            this._onDidChangeTreeData.fire(undefined);
        }
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
            const resp = await this.client.listUsers();
            this.users = resp;
            log(`Loaded ${resp.length} users`);
        } catch (err) {
            logError('Failed to load users', err);
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: CollabNode): vscode.TreeItem {
        if (element.kind === 'section') {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
            item.iconPath = new vscode.ThemeIcon('organization');
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

        item.tooltip = `${u.user_id} (${u.user_type}) — ${u.state}`;
        return item;
    }

    getChildren(element?: CollabNode): CollabNode[] {
        if (!element) {
            const live: CollabNode[] = [];
            const registered: CollabNode[] = [];

            for (const u of this.users) {
                const isLive = this.liveParticipants.has(u.user_id);
                const node: CollabNode = { kind: 'user', user: u, isLive };
                if (isLive) {
                    live.push(node);
                }
                registered.push(node);
            }

            // Also add live participants not in users list
            for (const pid of this.liveParticipants) {
                if (!this.users.some((u) => u.user_id === pid)) {
                    live.push({
                        kind: 'user',
                        user: { user_id: pid, name: pid, state: 'active', user_type: 'unknown' },
                        isLive: true,
                    });
                }
            }

            const sections: CollabNode[] = [];
            if (live.length > 0) {
                sections.push({ kind: 'section', label: `Live (${live.length})`, children: live });
            }
            if (registered.length > 0) {
                sections.push({ kind: 'section', label: `Users (${registered.length})`, children: registered });
            }

            return sections.length > 0 ? sections : registered;
        }

        if (element.kind === 'section') {
            return element.children;
        }

        return [];
    }
}
