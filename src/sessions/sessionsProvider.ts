import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { ContextStore } from '../store/contextStore';
import { log, logError } from '../log';
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

interface EmptyEntry { kind: 'empty'; label: string }

type SessionNode = ContextNode | SessionEntry | ZellijEntry | EmptyEntry;

export class SessionsProvider implements vscode.TreeDataProvider<SessionNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SessionNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private client: TachikomaClient | null = null;
    private store: ContextStore | null = null;
    private groups: ContextSessionGroup[] = [];
    private tmuxByCtx = new Map<string, TmuxSessionInfo[]>();
    private showAll = false;
    private refreshTimer: ReturnType<typeof setInterval> | null = null;

    setClient(client: TachikomaClient | null): void {
        this.client = client;
        if (client) {
            void this.refresh();
            this.refreshTimer = setInterval(() => void this.refresh(), 15_000);
        } else {
            this.groups = [];
            this.tmuxByCtx.clear();
            if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    setStore(store: ContextStore): void {
        this.store = store;
        store.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
    }

    setShowAll(showAll: boolean): void {
        this.showAll = showAll;
        this._onDidChangeTreeData.fire(undefined);
    }

    async refresh(): Promise<void> {
        if (!this.client) return;
        try {
            const resp = await this.client.listSessionsByContext();
            this.groups = resp.groups ?? [];

            const tmuxResp = await this.client.listTmuxSessions();
            this.tmuxByCtx.clear();
            for (const t of (tmuxResp.sessions ?? [])) {
                const list = this.tmuxByCtx.get(t.ctx_id) ?? [];
                list.push(t);
                this.tmuxByCtx.set(t.ctx_id, list);
            }
            log(`Sessions: ${this.groups.length} ctxs, ${tmuxResp.sessions?.length ?? 0} tmux`);
        } catch (err) {
            logError('Failed to load sessions', err);
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SessionNode): vscode.TreeItem {
        if (element.kind === 'empty') {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('info');
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
            item.description = element.zwebAvailable
                ? `${count} session${count !== 1 ? 's' : ''} · zweb:${element.zwebPort}`
                : `${count} session${count !== 1 ? 's' : ''}`;
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
        const item = new vscode.TreeItem(`Zellij Web`, vscode.TreeItemCollapsibleState.None);
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
        if (!this.client) return [];

        if (!element) {
            return this.buildContextNodes();
        }

        if (element.kind === 'context') {
            return element.sessions;
        }

        return [];
    }

    private buildContextNodes(): SessionNode[] {
        const activeCtxs = this.store?.getActiveContextPaths() ?? [];
        const activeSet = new Set(activeCtxs);

        // Build context nodes from groups + tmux sessions
        const ctxMap = new Map<string, ContextNode>();

        for (const g of this.groups) {
            const ctxId = g.ctx_id || g.context_path || 'global';
            ctxMap.set(ctxId, {
                kind: 'context',
                ctxId,
                contextPath: g.context_path,
                isActive: activeSet.has(ctxId),
                zwebAvailable: g.zweb_available,
                zwebPort: g.zweb_port,
                sessions: [],
            });

            if (g.zweb_available) {
                ctxMap.get(ctxId)!.sessions.push({
                    kind: 'zellij' as const,
                    parentCtxId: ctxId,
                    contextPath: g.context_path,
                    port: g.zweb_port,
                } as unknown as SessionEntry);
            }

            for (const s of g.active_sessions ?? []) {
                ctxMap.get(ctxId)!.sessions.push({
                    kind: 'session',
                    parentCtxId: ctxId,
                    sessionId: s.id,
                    name: s.name,
                    sessionType: (s.session_type as 'tmux' | 'zellij') || 'zellij',
                });
            }
        }

        for (const [ctxId, tmuxList] of this.tmuxByCtx) {
            let node = ctxMap.get(ctxId);
            if (!node) {
                node = {
                    kind: 'context',
                    ctxId,
                    contextPath: ctxId,
                    isActive: activeSet.has(ctxId),
                    zwebAvailable: false,
                    zwebPort: 0,
                    sessions: [],
                };
                ctxMap.set(ctxId, node);
            }
            for (const t of tmuxList) {
                node.sessions.push({
                    kind: 'session',
                    parentCtxId: ctxId,
                    sessionId: t.session_id,
                    name: t.name || t.tmux_target,
                    sessionType: 'tmux',
                    tmuxTarget: t.tmux_target,
                    tmuxSocket: t.tmux_socket,
                });
            }
        }

        const nodes = [...ctxMap.values()];

        // Filter: only active contexts unless showAll
        const filtered = this.showAll
            ? nodes
            : nodes.filter((n) => n.isActive || n.ctxId === 'global');

        if (filtered.length === 0) {
            return [{ kind: 'empty', label: this.showAll ? 'No sessions' : 'Open a file to see sessions' }];
        }

        // Active first, then alpha
        filtered.sort((a, b) => {
            if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
            return a.ctxId.localeCompare(b.ctxId);
        });

        return filtered;
    }

    dispose(): void {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this._onDidChangeTreeData.dispose();
    }
}

export type { SessionNode, ContextNode, SessionEntry, ZellijEntry };
