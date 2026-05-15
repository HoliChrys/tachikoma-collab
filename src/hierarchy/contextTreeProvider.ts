import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { ContextStore } from '../store/contextStore';
import type { ContextNode, ContextStoreNode } from '../types';
import { log, logError } from '../log';

export class ContextTreeProvider implements vscode.TreeDataProvider<ContextNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ContextNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private store: ContextStore | null = null;
    private client: TachikomaClient | null = null;
    private storeDisposables: vscode.Disposable[] = [];

    setStore(store: ContextStore): void {
        this.storeDisposables.forEach((d) => d.dispose());
        this.store = store;
        this.storeDisposables = [
            store.onDidChange(() => this._onDidChangeTreeData.fire(undefined)),
            store.onContextFilesChanged((ctxPath) => {
                log(`Files changed in ${ctxPath} — refreshing tree`);
                this._onDidChangeTreeData.fire(undefined);
            }),
        ];
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    setClient(client: TachikomaClient | null): void {
        this.client = client;
        if (!client) this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ContextNode): vscode.TreeItem {
        const isLeafFile = element.type === 'file';
        const item = new vscode.TreeItem(
            element.name,
            isLeafFile
                ? vscode.TreeItemCollapsibleState.None
                : vscode.TreeItemCollapsibleState.Collapsed
        );

        const icons: Record<string, string> = {
            galaxy: 'star-full',
            system: 'server',
            space: 'folder-library',
            folder: 'folder',
            file: 'file',
        };

        const isCtx = element.type === 'galaxy' || element.type === 'system' || element.type === 'space';
        const isActive = isCtx && this.store?.isActive(element.path);

        const contextColors: Record<string, string> = {
            galaxy: 'charts.purple',
            system: 'charts.blue',
            space: 'charts.pink',
        };

        if (isActive) {
            item.iconPath = new vscode.ThemeIcon(
                icons[element.type] ?? 'circle-outline',
                new vscode.ThemeColor('charts.green'),
            );
        } else if (contextColors[element.type]) {
            item.iconPath = new vscode.ThemeIcon(
                icons[element.type] ?? 'circle-outline',
                new vscode.ThemeColor(contextColors[element.type]),
            );
        } else {
            item.iconPath = new vscode.ThemeIcon(icons[element.type] ?? 'circle-outline');
        }

        item.tooltip = element.path;

        if (isCtx) {
            const node = this.store?.getNode(element.path);
            const activeCount = node?.activeUsers.size ?? 0;
            item.description = activeCount > 0
                ? `${element.type} · ${activeCount} active`
                : element.type;
        }

        item.contextValue = element.type;

        if (element.type === 'file') {
            item.command = {
                command: 'tachikoma.openRemoteFile',
                title: 'Open File',
                arguments: [element],
            };
        }

        return item;
    }

    async getChildren(element?: ContextNode): Promise<ContextNode[]> {
        if (!this.store) return [];

        // Root: galaxies
        if (!element) {
            return this.store.getRoots().map(storeNodeToContextNode);
        }

        // Context nodes: children from store
        if (element.type === 'galaxy' || element.type === 'system') {
            return this.store.getChildren(element.path).map(storeNodeToContextNode);
        }

        // Spaces + folders: list files via API
        if ((element.type === 'space' || element.type === 'folder') && this.client) {
            return this.listRemoteDirectory(element);
        }

        return [];
    }

    private async listRemoteDirectory(element: ContextNode): Promise<ContextNode[]> {
        if (!this.client) return [];
        const contextPath = element.contextPath ?? element.path;
        const subpath = element.type === 'folder' ? (element.subpath ?? '') : '';

        try {
            const entries = await this.client.listContextFiles(contextPath, subpath);
            return entries.map((e) => ({
                id: `${contextPath}/${e.path}`,
                name: e.name,
                type: (e.type === 'directory' || e.type === 'dir') ? 'folder' as const : 'file' as const,
                path: e.path,
                fsPath: e.path,
                contextPath,
                subpath: (e.type === 'directory' || e.type === 'dir')
                    ? (subpath ? `${subpath}/${e.name}` : e.name)
                    : undefined,
                size: e.size,
            }));
        } catch (err) {
            logError(`Failed to list ${contextPath}/${subpath}`, err);
            return [];
        }
    }
}

function storeNodeToContextNode(n: ContextStoreNode): ContextNode {
    return {
        id: n.path,
        name: n.name,
        type: n.type,
        path: n.path,
        contextPath: n.path,
        hive_channel: n.hive_channel,
    };
}
