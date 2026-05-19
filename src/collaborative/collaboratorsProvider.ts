import * as vscode from 'vscode';
import type { ContextStore } from '../store/contextStore';
import type { UserRecord } from '../types';

type CollabNode =
    | { kind: 'header'; label: string; description?: string; children: CollabNode[] }
    | { kind: 'user'; user: UserRecord; isLive: boolean; isSelf?: boolean }
    | { kind: 'empty'; label: string };

export class CollaboratorsProvider implements vscode.TreeDataProvider<CollabNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CollabNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private store: ContextStore | null = null;
    private storeListener: vscode.Disposable | null = null;

    setStore(store: ContextStore): void {
        this.storeListener?.dispose();
        this.store = store;
        this.storeListener = store.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
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
        const displayName = element.isSelf ? `${u.name || u.user_id} (you)` : (u.name || u.user_id);
        const item = new vscode.TreeItem(displayName, vscode.TreeItemCollapsibleState.None);

        if (element.isSelf) {
            item.iconPath = new vscode.ThemeIcon('person-filled', new vscode.ThemeColor('charts.green'));
            item.description = 'connected';
        } else if (element.isLive) {
            item.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
            item.description = 'active';
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
        if (!this.store) return [];

        if (element?.kind === 'header') return element.children;
        if (element) return [];

        const myUserId = this.store.getMyUserId();
        const activeUsers = this.store.getActiveCollaborators();
        const grantedUsers = this.store.getGrantedUsers();
        const activePaths = this.store.getActiveContextPaths();

        const sections: CollabNode[] = [];

        // Always-on "You" section — the current user is implicitly connected as long
        // as the extension is authed. Built from the cached UserRecord if present,
        // otherwise from a minimal placeholder.
        if (myUserId) {
            const meRecord = activeUsers.find((u) => u.user_id === myUserId)
                ?? grantedUsers.find((u) => u.user_id === myUserId)
                ?? { user_id: myUserId, name: myUserId, state: 'active', user_type: 'user', contexts: [] } as UserRecord;
            sections.push({
                kind: 'header',
                label: 'You',
                children: [{ kind: 'user', user: meRecord, isLive: true, isSelf: true }],
            });
        }

        // Other live users (exclude self — store already excludes us from activeUsers, but be defensive)
        const otherActive = activeUsers.filter((u) => u.user_id !== myUserId);
        if (otherActive.length > 0) {
            sections.push({
                kind: 'header',
                label: `Live (${otherActive.length})`,
                children: otherActive.map((u) => ({ kind: 'user', user: u, isLive: true })),
            });
        }

        // Granted but not live (exclude self + already-live)
        const liveIds = new Set([myUserId, ...otherActive.map((u) => u.user_id)]);
        const grantedOnly = grantedUsers.filter((u) => !liveIds.has(u.user_id));
        if (grantedOnly.length > 0) {
            sections.push({
                kind: 'header',
                label: `Granted (${grantedOnly.length})`,
                description: activePaths.length > 0 ? activePaths.join(', ') : undefined,
                children: grantedOnly.map((u) => ({ kind: 'user', user: u, isLive: false })),
            });
        }

        return sections;
    }
}
