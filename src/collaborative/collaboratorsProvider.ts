import * as vscode from 'vscode';
import type { ContextStore } from '../store/contextStore';
import type { UserRecord } from '../types';

type CollabNode =
    | { kind: 'header'; label: string; description?: string; children: CollabNode[] }
    | { kind: 'user'; user: UserRecord; isLive: boolean }
    | { kind: 'empty'; label: string };

export class CollaboratorsProvider implements vscode.TreeDataProvider<CollabNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CollabNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private store: ContextStore | null = null;

    setStore(store: ContextStore): void {
        this.store = store;
        store.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
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

        const activeUsers = this.store.getActiveCollaborators();
        const grantedUsers = this.store.getGrantedUsers();
        const activePaths = this.store.getActiveContextPaths();

        const sections: CollabNode[] = [];

        if (activeUsers.length > 0) {
            sections.push({
                kind: 'header',
                label: `Live (${activeUsers.length})`,
                children: activeUsers.map((u) => ({ kind: 'user', user: u, isLive: true })),
            });
        }

        if (grantedUsers.length > 0) {
            const activeIds = new Set(activeUsers.map((u) => u.user_id));
            const grantedOnly = grantedUsers.filter((u) => !activeIds.has(u.user_id));
            if (grantedOnly.length > 0) {
                sections.push({
                    kind: 'header',
                    label: `Granted (${grantedOnly.length})`,
                    description: activePaths.length > 0 ? activePaths.join(', ') : undefined,
                    children: grantedOnly.map((u) => ({ kind: 'user', user: u, isLive: false })),
                });
            }
        }

        if (sections.length === 0 && activePaths.length > 0) {
            return [{ kind: 'empty', label: 'No collaborators in active contexts' }];
        }

        if (sections.length === 0) {
            return [{ kind: 'empty', label: 'Open a file to see collaborators' }];
        }

        return sections;
    }
}
