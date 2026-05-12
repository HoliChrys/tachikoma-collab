import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { ContextNode } from '../types';

export class ContextTreeProvider implements vscode.TreeDataProvider<ContextNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ContextNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private roots: ContextNode[] = [];
    private client: TachikomaClient | null = null;

    setClient(client: TachikomaClient | null): void {
        this.client = client;
        if (client) {
            void this.refresh();
        } else {
            this.roots = [];
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    async refresh(): Promise<void> {
        if (!this.client) return;
        try {
            const data = await this.client.getHierarchy() as ContextNode[];
            this.roots = Array.isArray(data) ? data : [];
        } catch {
            this.roots = [];
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ContextNode): vscode.TreeItem {
        const hasChildren = element.children && element.children.length > 0;
        const item = new vscode.TreeItem(
            element.name,
            hasChildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );

        const icons: Record<string, string> = {
            global: 'globe',
            galaxy: 'star-full',
            system: 'server',
            space: 'folder',
        };
        item.iconPath = new vscode.ThemeIcon(icons[element.level] ?? 'circle-outline');
        item.tooltip = `${element.level}: ${element.path}`;
        item.description = element.level;
        item.contextValue = element.level;

        if (element.level === 'space') {
            item.command = {
                command: 'vscode.openFolder',
                title: 'Open Space',
                arguments: [vscode.Uri.file(element.path)],
            };
        }

        return item;
    }

    getChildren(element?: ContextNode): ContextNode[] {
        if (!element) return this.roots;
        return element.children ?? [];
    }
}
