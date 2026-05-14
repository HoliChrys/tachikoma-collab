import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { ContextStore } from '../store/contextStore';
import { log } from '../log';
import type { ContextSessionGroup, TmuxSessionInfo, ZellijSessionInfo } from './sessionTypes';

interface ContextNode {
    kind: 'context';
    ctxId: string;
    contextPath: string;
    isActive: boolean;
    zwebAvailable: boolean;
    zwebPort: number;
    sessions: SessionEntry[];
}

interface SessionEntry {
    kind: 'session';
    parentCtxId: string;
    sessionId: string;
    name: string;
    sessionType: 'tmux' | 'zellij';
    tmuxTarget?: string;
    tmuxSocket?: string;
    zwebPort?: number;
}

interface ZellijEntry {
    kind: 'zellij';
    parentCtxId: string;
    contextPath: string;
    port: number;
}

interface EmptyEntry { kind: 'empty'; label: string; description?: string }

type SessionNode = ContextNode | SessionEntry | ZellijEntry | EmptyEntry;

export class SessionsProvider implements vscode.TreeDataProvider<SessionNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SessionNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private client: TachikomaClient | null = null;
    private store: ContextStore | null = null;
    private storeListener: vscode.Disposable | null = null;
    private connected = false;

    setClient(client: TachikomaClient | null): void {
        this.client = client;
        this.connected = !!client;
        this._onDidChangeTreeData.fire(undefined);
    }

    setStore(store: ContextStore): void {
        this.storeListener?.dispose();
        this.store = store;
        this.storeListener = store.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
    }

    /** No-op now: refresh is driven by SSE events on the ContextStore. */
    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SessionNode): vscode.TreeItem {
        if (element.kind === 'empty') {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('info');
            item.description = element.description;
            return item;
        }

        if (element.kind === 'context') {
            const item = new vscode.TreeItem(
                element.ctxId,
                vscode.TreeItemCollapsibleState.Expanded,
            );
            item.iconPath = new vscode.ThemeIcon(
                'folder-library',
                element.isActive ? new vscode.ThemeColor('charts.green') : undefined,
            );
            const count = element.sessions.length;
            const activeTag = element.isActive ? '· active' : '';
            item.description = element.zwebAvailable
                ? `${count} · zweb:${element.zwebPort} ${activeTag}`.trim()
                : `${count} ${activeTag}`.trim();
            item.contextValue = 'sessionContext';
            return item;
        }

        if (element.kind === 'session') {
            const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('terminal');
            item.description = element.sessionType;
            item.contextValue = 'tmuxSession';
            item.command = {
                command: 'tachikoma.attachSession',
                title: 'Attach',
                arguments: [element],
            };
            return item;
        }

        // zellij entry
        const item = new vscode.TreeItem('Zellij Web', vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('browser');
        item.description = `port ${element.port}`;
        item.contextValue = 'zellijWeb';
        item.command = {
            command: 'tachikoma.openZellij',
            title: 'Open in browser',
            arguments: [element],
        };
        return item;
    }

    getChildren(element?: SessionNode): SessionNode[] {
        if (!this.connected) {
            return [{ kind: 'empty', label: 'Not connected', description: 'Run "Tachikoma: Connect" to load sessions' }];
        }

        if (!element) {
            return this.buildContextNodes();
        }

        if (element.kind === 'context') {
            return element.sessions;
        }

        return [];
    }

    private buildContextNodes(): SessionNode[] {
        if (!this.store) return [];

        const groups: ContextSessionGroup[] = this.store.getSessions();
        const tmuxSessions: TmuxSessionInfo[] = this.store.getTmuxSessions();
        const activeCtxs = new Set(this.store.getActiveContextPaths());

        const tmuxByCtx = new Map<string, TmuxSessionInfo[]>();
        for (const t of tmuxSessions) {
            const list = tmuxByCtx.get(t.ctx_id) ?? [];
            list.push(t);
            tmuxByCtx.set(t.ctx_id, list);
        }

        const ctxMap = new Map<string, ContextNode>();

        const ensureCtxNode = (ctxId: string, contextPath: string, opts?: { zwebAvailable?: boolean; zwebPort?: number }): ContextNode => {
            let node = ctxMap.get(ctxId);
            if (!node) {
                node = {
                    kind: 'context',
                    ctxId,
                    contextPath,
                    isActive: activeCtxs.has(ctxId),
                    zwebAvailable: opts?.zwebAvailable ?? false,
                    zwebPort: opts?.zwebPort ?? 0,
                    sessions: [],
                };
                ctxMap.set(ctxId, node);
            } else if (opts?.zwebAvailable) {
                node.zwebAvailable = true;
                node.zwebPort = opts.zwebPort ?? node.zwebPort;
            }
            return node;
        };

        for (const g of groups) {
            const groupCtxId = g.ctx_id || g.context_path || 'global';
            const groupNode = ensureCtxNode(groupCtxId, g.context_path, {
                zwebAvailable: g.zweb_available,
                zwebPort: g.zweb_port,
            });

            if (g.zweb_available) {
                groupNode.sessions.push({
                    kind: 'zellij',
                    parentCtxId: groupCtxId,
                    contextPath: g.context_path,
                    port: g.zweb_port,
                } as unknown as SessionEntry);
            }

            for (const s of g.active_sessions ?? []) {
                // Heuristic: try to assign session to a more specific context based on its name
                const inferred = this.store.findContextByName(s.name);
                const targetCtxId = inferred ? inferred.path : groupCtxId;
                const targetCtxPath = inferred ? inferred.path : g.context_path;
                const targetNode = ensureCtxNode(targetCtxId, targetCtxPath);
                targetNode.sessions.push({
                    kind: 'session',
                    parentCtxId: targetCtxId,
                    sessionId: s.id,
                    name: s.name,
                    sessionType: (s.session_type as 'tmux' | 'zellij') || 'zellij',
                });
            }
        }

        for (const [ctxId, tmuxList] of tmuxByCtx) {
            for (const t of tmuxList) {
                const inferred = this.store.findContextByName(t.name || t.tmux_target);
                const targetCtxId = inferred ? inferred.path : ctxId;
                const node = ensureCtxNode(targetCtxId, targetCtxId);
                node.sessions.push({
                    kind: 'session',
                    parentCtxId: targetCtxId,
                    sessionId: t.session_id,
                    name: t.name || t.tmux_target,
                    sessionType: 'tmux',
                    tmuxTarget: t.tmux_target,
                    tmuxSocket: t.tmux_socket,
                });
            }
        }

        const nodes = [...ctxMap.values()];

        if (nodes.length === 0) {
            return [{ kind: 'empty', label: 'No sessions yet', description: 'Sessions appear when tmux or zellij starts in a context' }];
        }

        // Active first, then alphabetical
        nodes.sort((a, b) => {
            if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
            return a.ctxId.localeCompare(b.ctxId);
        });

        return nodes;
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}

export type { SessionNode, ContextNode, SessionEntry, ZellijEntry };
