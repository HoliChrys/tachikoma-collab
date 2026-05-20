// VI-1d agents tree view.
//
// Lazy TreeDataProvider for the future "Agents" view under the Tachikoma
// activity bar. Mirrors the layout of the MCP Copilot tree (treeProvider.ts)
// and the sessions tree (sessionsProvider.ts).
//
// Backend endpoints `/api/agents` and `/api/swarms` are NOT YET available
// (see .agents/context/consume/backend-endpoint-status.md). When the API
// returns 404 the view shows a single info node pointing at the status
// doc so the user understands the feature is intentionally degraded.
//
// Spec: .agents/specs/to_do/VI-1d-agent-hosting.md.
// ASCII only, 4-space indent.

import * as vscode from 'vscode';
import type { AuthManager } from '../auth/authManager';
import { log, logError } from '../log';
import {
    AgentsApiClient,
    type AgentRecord,
    isBackendDeferred,
} from './agentsApiClient';

type NodeKind = 'root' | 'agent' | 'detail' | 'empty' | 'error';

interface TreeNode {
    kind: NodeKind;
    label: string;
    description?: string;
    iconId?: string;
    agent?: AgentRecord;
    children?: TreeNode[];
}

const STATE_ICON: Record<string, string> = {
    idle: 'circle-large-outline',
    working: 'loading~spin',
    awaiting_approval: 'question',
    blocked: 'error',
    stopped: 'circle-slash',
};

/**
 * Tree layout:
 *
 *   Agents (N)
 *   ├─ openclaw-local                idle
 *   │  ├─ state: idle
 *   │  ├─ template: openclaw
 *   │  └─ machines: vscode-host-user
 *   └─ ...
 *
 * On 404 from the backend, a single child node:
 *   "Backend endpoints not yet available - see .agents/context/consume/backend-endpoint-status.md"
 */
export class AgentsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private readonly _emitter = new vscode.EventEmitter<TreeNode | undefined>();
    readonly onDidChangeTreeData = this._emitter.event;

    private api: AgentsApiClient | null = null;
    private agents: AgentRecord[] = [];
    private lastError: string | null = null;
    private backendDeferred = false;
    private loaded = false;
    private connectListener: vscode.Disposable | null = null;

    constructor(private readonly authManager: AuthManager) {
        this.connectListener = authManager.onDidConnect(() => {
            void this.refresh();
        });
    }

    async refresh(): Promise<void> {
        const client = this.authManager.getClient();
        if (!client) {
            this.api = null;
            this.agents = [];
            this.lastError = null;
            this.backendDeferred = false;
            this.loaded = false;
            this._emitter.fire(undefined);
            return;
        }
        this.api = new AgentsApiClient(client);
        const userId = this.authManager.getUserId() ?? '';
        try {
            this.agents = await this.api.listAgents(userId);
            this.lastError = null;
            this.backendDeferred = false;
            log(`agents: loaded ${this.agents.length} agent(s)`);
        } catch (err) {
            this.agents = [];
            if (isBackendDeferred(err)) {
                this.backendDeferred = true;
                this.lastError = null;
                log('agents: backend endpoints deferred (404)');
            } else {
                this.backendDeferred = false;
                this.lastError = err instanceof Error ? err.message : String(err);
                logError('agents: refresh failed', err);
            }
        }
        this.loaded = true;
        this._emitter.fire(undefined);
    }

    getTreeItem(node: TreeNode): vscode.TreeItem {
        const collapsible = node.kind === 'root' || node.kind === 'agent';
        const item = new vscode.TreeItem(
            node.label,
            collapsible
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None,
        );
        item.description = node.description;
        if (node.iconId) item.iconPath = new vscode.ThemeIcon(node.iconId);
        item.contextValue = node.kind === 'agent' ? 'tachikomaAgent' : node.kind;
        return item;
    }

    getChildren(element?: TreeNode): TreeNode[] {
        if (!element) return [this.buildRoot()];
        return element.children ?? [];
    }

    private buildRoot(): TreeNode {
        if (!this.authManager.isConnected()) {
            return {
                kind: 'root',
                label: 'Agents',
                description: 'not connected',
                iconId: 'circle-slash',
                children: [{
                    kind: 'empty',
                    label: 'Not connected',
                    description: 'Run "Tachikoma: Connect" to load agents',
                    iconId: 'info',
                }],
            };
        }

        if (!this.loaded) {
            return {
                kind: 'root',
                label: 'Agents',
                description: 'loading...',
                iconId: 'loading~spin',
                children: [],
            };
        }

        if (this.backendDeferred) {
            return {
                kind: 'root',
                label: 'Agents',
                description: 'backend pending',
                iconId: 'warning',
                children: [{
                    kind: 'error',
                    label: 'Backend endpoints not yet available - see .agents/context/consume/backend-endpoint-status.md',
                    iconId: 'warning',
                }],
            };
        }

        if (this.lastError) {
            return {
                kind: 'root',
                label: 'Agents',
                description: 'error',
                iconId: 'error',
                children: [{
                    kind: 'error',
                    label: this.lastError,
                    iconId: 'error',
                }],
            };
        }

        if (this.agents.length === 0) {
            return {
                kind: 'root',
                label: 'Agents (0)',
                iconId: 'organization',
                children: [{
                    kind: 'empty',
                    label: 'No agents yet',
                    description: 'Use "Tachikoma: Spawn Agent" to create one',
                    iconId: 'info',
                }],
            };
        }

        return {
            kind: 'root',
            label: `Agents (${this.agents.length})`,
            iconId: 'organization',
            children: this.agents.map(a => this.agentNode(a)),
        };
    }

    private agentNode(a: AgentRecord): TreeNode {
        const stateIcon = STATE_ICON[a.state] ?? 'circle-outline';
        return {
            kind: 'agent',
            label: a.name || a.id,
            description: `${a.template} - ${a.state}`,
            iconId: stateIcon,
            agent: a,
            children: [
                { kind: 'detail', label: `state: ${a.state}`, iconId: stateIcon },
                { kind: 'detail', label: `template: ${a.template}`, iconId: 'symbol-class' },
                { kind: 'detail', label: `mode: ${a.mode}`, iconId: 'symbol-misc' },
                {
                    kind: 'detail',
                    label: `machines: ${(a.machine_ids ?? []).join(', ') || '(none)'}`,
                    iconId: 'device-desktop',
                },
            ],
        };
    }

    dispose(): void {
        this.connectListener?.dispose();
        this._emitter.dispose();
    }
}

export type { TreeNode };
