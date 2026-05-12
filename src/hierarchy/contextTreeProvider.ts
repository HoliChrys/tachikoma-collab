import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { ContextNode, HierarchyItem } from '../types';
import { log, logError } from '../log';

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
            log('Loading context hierarchy...');
            const [galaxies, systems, spaces] = await Promise.all([
                this.client.getGalaxies(),
                this.client.getSystems(),
                this.client.getSpaces(),
            ]);

            this.roots = this.buildTree(galaxies, systems, spaces);
            log(`Loaded ${galaxies.length} galaxies, ${systems.length} systems, ${spaces.length} spaces`);
        } catch (err) {
            logError('Failed to load hierarchy', err);
            this.roots = [];
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    private buildTree(galaxies: HierarchyItem[], systems: HierarchyItem[], spaces: HierarchyItem[]): ContextNode[] {
        const systemsByParent = new Map<string, HierarchyItem[]>();
        for (const s of systems) {
            const list = systemsByParent.get(s.parent_path) ?? [];
            list.push(s);
            systemsByParent.set(s.parent_path, list);
        }

        const spacesByParent = new Map<string, HierarchyItem[]>();
        for (const s of spaces) {
            const list = spacesByParent.get(s.parent_path) ?? [];
            list.push(s);
            spacesByParent.set(s.parent_path, list);
        }

        return galaxies.map((g) => ({
            id: g.id,
            name: g.name,
            type: 'galaxy' as const,
            path: g.path,
            hive_channel: g.hive_channel,
            children: (systemsByParent.get(g.path) ?? []).map((sys) => ({
                id: sys.id,
                name: sys.name,
                type: 'system' as const,
                path: sys.path,
                hive_channel: sys.hive_channel,
                children: (spacesByParent.get(sys.path) ?? []).map((sp) => ({
                    id: sp.id,
                    name: sp.name,
                    type: 'space' as const,
                    path: sp.path,
                    contextPath: sp.path,
                    hive_channel: sp.hive_channel,
                })),
            })),
        }));
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
        item.iconPath = new vscode.ThemeIcon(icons[element.type] ?? 'circle-outline');
        item.tooltip = element.path;
        item.description = element.type === 'galaxy' || element.type === 'system' || element.type === 'space'
            ? element.type
            : element.fsPath ? `${((element as { size?: number }).size ?? 0)} B` : undefined;
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
        if (!element) return this.roots;

        if (element.children && element.children.length > 0) {
            return element.children;
        }

        // For spaces and folders, list via API
        if ((element.type === 'space' || element.type === 'folder') && this.client) {
            return this.listRemoteDirectory(element);
        }

        return [];
    }

    private async listRemoteDirectory(element: ContextNode): Promise<ContextNode[]> {
        if (!this.client) return [];

        const contextPath = element.contextPath ?? element.path.split('/')[0] ?? element.path;
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
