import * as vscode from 'vscode';
import * as path from 'path';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { ContextNode, HierarchyItem } from '../types';
import { log, logError } from '../log';

export class ContextTreeProvider implements vscode.TreeDataProvider<ContextNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ContextNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private roots: ContextNode[] = [];
    private client: TachikomaClient | null = null;
    private monorepoRoot = '';

    setClient(client: TachikomaClient | null): void {
        this.client = client;
        if (client) {
            void this.refresh();
        } else {
            this.roots = [];
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    setMonorepoRoot(root: string): void {
        this.monorepoRoot = root;
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
                    fsPath: this.spaceToFsPath(sp.path),
                    hive_channel: sp.hive_channel,
                })),
            })),
        }));
    }

    private spaceToFsPath(dottedPath: string): string {
        if (!this.monorepoRoot) return '';
        const parts = dottedPath.split('.');
        return path.join(this.monorepoRoot, ...parts);
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
        item.tooltip = element.fsPath || element.path;
        item.description = element.type === 'galaxy' || element.type === 'system' || element.type === 'space'
            ? element.type
            : undefined;
        item.contextValue = element.type;

        if (element.type === 'file' && element.fsPath) {
            item.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [vscode.Uri.file(element.fsPath)],
            };
            item.resourceUri = vscode.Uri.file(element.fsPath);
        }

        return item;
    }

    async getChildren(element?: ContextNode): Promise<ContextNode[]> {
        if (!element) return this.roots;

        if (element.children && element.children.length > 0) {
            return element.children;
        }

        if ((element.type === 'space' || element.type === 'folder') && element.fsPath) {
            return this.listDirectory(element.fsPath);
        }

        return [];
    }

    private async listDirectory(dirPath: string): Promise<ContextNode[]> {
        try {
            const fs = await import('fs/promises');
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            const hidden = new Set(['.git', '.venv', 'node_modules', '__pycache__', '.mypy_cache', '.pytest_cache']);
            const sorted = entries
                .filter((e) => !e.name.startsWith('.') || !hidden.has(e.name))
                .filter((e) => !hidden.has(e.name))
                .sort((a, b) => {
                    if (a.isDirectory() && !b.isDirectory()) return -1;
                    if (!a.isDirectory() && b.isDirectory()) return 1;
                    return a.name.localeCompare(b.name);
                });

            return sorted.map((entry) => {
                const fullPath = path.join(dirPath, entry.name);
                return {
                    id: fullPath,
                    name: entry.name,
                    type: entry.isDirectory() ? 'folder' as const : 'file' as const,
                    path: fullPath,
                    fsPath: fullPath,
                };
            });
        } catch {
            return [];
        }
    }
}
