// Tachikoma extra status bar items — MCP profile, agent count, runner.
//
// Complements the existing AuthManager status item (priority 100, left) and
// ConnectionStatusItem (priority 99, left) with three right-aligned items:
//
//   priority 95 — MCP profile (rocket icon, click -> selectProfile)
//   priority 94 — Agent count  (robot icon,  click -> tachikomaAgents view)
//   priority 93 — Runner state (server icon, click -> runner audit log)
//
// All three react live: MCP profile via McpProfileStore.onDidChange, agent
// count via auth onDidConnect + a 30s poll, runner state via the
// RunnerStateProvider event exposed by initRunner().
//
// The class is constructed up-front in activate() before mcpProfileStore /
// runner.state exist, then wired in via attachMcpProfileStore() and
// attachRunnerState() once those resources are available. This mirrors the
// existing AuthManager / ConnectionStatusItem pattern.
//
// ASCII only, 4-space indent. TypeScript strict.

import * as vscode from 'vscode';
import { log, logError } from '../log';
import {
    AgentsApiClient,
    isBackendDeferred,
} from '../agents/agentsApiClient';
import type { AuthManager } from './authManager';
import type { McpProfileStore } from '../store/mcpProfileStore';
import type { RunnerStateProvider } from '../runner';
import type { RunnerStateSnapshot } from '../runner/transport';

const AGENT_POLL_MS = 30_000;

/**
 * Bundle of status bar items that surface live Tachikoma state.
 *
 * Construct once in activate(), then attach the McpProfileStore and the
 * RunnerStateProvider as soon as they exist — typically inside
 * authManager.onDidConnect, the same lifecycle the existing surfaces use.
 */
export class TachikomaStatusBar implements vscode.Disposable {
    private readonly mcpItem: vscode.StatusBarItem;
    private readonly agentItem: vscode.StatusBarItem;
    private readonly runnerItem: vscode.StatusBarItem;

    private readonly disposables: vscode.Disposable[] = [];

    private mcpStore: McpProfileStore | null = null;
    private mcpSub: vscode.Disposable | null = null;

    private runnerState: RunnerStateProvider | null = null;
    private runnerSub: vscode.Disposable | null = null;

    private agentPollTimer: ReturnType<typeof setInterval> | null = null;
    private agentCount: number | null = null;
    private agentCountUnknown = false;

    constructor(private readonly authManager: AuthManager) {
        this.mcpItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            95,
        );
        this.mcpItem.name = 'Tachikoma MCP Profile';
        this.mcpItem.command = 'tachikoma.mcp.selectProfile';

        this.agentItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            94,
        );
        this.agentItem.name = 'Tachikoma Agents';
        // Focus the agents tree view — this is the same view extension.ts
        // registers as 'tachikomaAgents'. focus is a built-in command on
        // every TreeView contribution.
        this.agentItem.command = 'tachikomaAgents.focus';

        this.runnerItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            93,
        );
        this.runnerItem.name = 'Tachikoma Runner';
        // The runner audit log lives in the shared Tachikoma output channel
        // (see runner/rpcDispatcher.ts). showOutput surfaces that channel.
        this.runnerItem.command = 'tachikoma.showOutput';

        this.disposables.push(this.mcpItem, this.agentItem, this.runnerItem);

        // Auth lifecycle drives the agent poll + a re-render of all items.
        this.disposables.push(
            this.authManager.onDidConnect(() => {
                this.startAgentPoll();
                void this.refreshAgentCount();
                this.renderAll();
            }),
            this.authManager.onDidDisconnect(() => {
                this.stopAgentPoll();
                this.agentCount = null;
                this.agentCountUnknown = false;
                this.renderAll();
            }),
        );

        this.renderAll();
        this.mcpItem.show();
        this.agentItem.show();
        this.runnerItem.show();
    }

    /** Wire the MCP profile store. Safe to call once; subsequent calls
     * replace the binding so the item keeps tracking the latest store. */
    attachMcpProfileStore(store: McpProfileStore): void {
        this.mcpSub?.dispose();
        this.mcpStore = store;
        this.mcpSub = store.onDidChange(() => this.renderMcp());
        this.renderMcp();
    }

    /** Wire the runner state event source from initRunner(). */
    attachRunnerState(provider: RunnerStateProvider): void {
        this.runnerSub?.dispose();
        this.runnerState = provider;
        this.runnerSub = provider.onDidChangeState((s) => this.renderRunner(s));
        this.renderRunner(provider.getState());
    }

    // ── Rendering ────────────────────────────────────────────────────

    private renderAll(): void {
        this.renderMcp();
        this.renderAgents();
        this.renderRunner(this.runnerState?.getState() ?? null);
    }

    private renderMcp(): void {
        if (!this.mcpStore) {
            this.mcpItem.text = '$(rocket) no profile';
            this.mcpItem.tooltip = new vscode.MarkdownString(
                '**MCP profile** — not loaded yet.\n\n'
                + 'Connect to Tachikoma to load the profile list.',
            );
            return;
        }
        const active = this.mcpStore.getActiveProfile();
        if (!active) {
            this.mcpItem.text = '$(rocket) no profile';
            this.mcpItem.tooltip = new vscode.MarkdownString(
                '**MCP profile** — no active profile selected.\n\n'
                + 'Click to pick one of your granted profiles.',
            );
            return;
        }
        const label = active.display_name || active.profile_name;
        this.mcpItem.text = `$(rocket) ${label}`;
        const capCount = active.capabilities?.length ?? 0;
        this.mcpItem.tooltip = new vscode.MarkdownString(
            `**MCP profile:** \`${active.profile_name}\`\n\n`
            + `${active.description || '_(no description)_'}\n\n`
            + `**${capCount}** capabilit${capCount === 1 ? 'y' : 'ies'} active\n\n`
            + 'Click to switch profile.',
        );
    }

    private renderAgents(): void {
        const connected = this.authManager.isConnected();
        if (!connected) {
            this.agentItem.text = '$(robot) -';
            this.agentItem.tooltip = new vscode.MarkdownString(
                '**Agents** — disconnected.\n\n'
                + 'Connect to Tachikoma to count local agents.',
            );
            this.agentItem.color = new vscode.ThemeColor(
                'descriptionForeground',
            );
            return;
        }
        if (this.agentCountUnknown) {
            this.agentItem.text = '$(robot) ?';
            this.agentItem.tooltip = new vscode.MarkdownString(
                '**Agents** — backend endpoint `/api/agents` not yet '
                + 'available.\n\nClick to open the Agents view.',
            );
            this.agentItem.color = new vscode.ThemeColor(
                'descriptionForeground',
            );
            return;
        }
        const n = this.agentCount ?? 0;
        this.agentItem.text = `$(robot) ${n}`;
        this.agentItem.tooltip = new vscode.MarkdownString(
            `**Agents** — ${n} local agent${n === 1 ? '' : 's'} `
            + 'reported by /api/agents.\n\nClick to open the Agents view.',
        );
        this.agentItem.color = undefined;
    }

    private renderRunner(snapshot: RunnerStateSnapshot | null): void {
        const s = snapshot ?? this.runnerState?.getState() ?? null;
        if (!s || s.state === 'idle') {
            this.runnerItem.text = '$(server) idle';
            this.runnerItem.color = new vscode.ThemeColor(
                'descriptionForeground',
            );
            this.runnerItem.tooltip = this.runnerTooltip(s, 'idle');
            return;
        }
        if (s.state === 'error') {
            this.runnerItem.text = '$(error) runner err';
            this.runnerItem.color = new vscode.ThemeColor('charts.red');
            this.runnerItem.tooltip = this.runnerTooltip(s, 'error');
            return;
        }
        if (s.state === 'connecting') {
            this.runnerItem.text = '$(sync~spin) runner';
            this.runnerItem.color = new vscode.ThemeColor(
                'descriptionForeground',
            );
            this.runnerItem.tooltip = this.runnerTooltip(s, 'connecting');
            return;
        }
        // active
        this.runnerItem.text = '$(server-process) runner';
        this.runnerItem.color = new vscode.ThemeColor('charts.green');
        this.runnerItem.tooltip = this.runnerTooltip(s, 'active');
    }

    private runnerTooltip(
        s: RunnerStateSnapshot | null,
        label: string,
    ): vscode.MarkdownString {
        const lines: string[] = [`**Runner:** ${label}`];
        if (s?.computerId) lines.push(`computer: \`${s.computerId}\``);
        if (s?.mode) lines.push(`transport: \`${s.mode}\``);
        if (s?.lastMethod) {
            const when = s.lastAt
                ? new Date(s.lastAt).toISOString().slice(11, 19)
                : '?';
            lines.push(`last RPC: \`${s.lastMethod}\` at ${when}`);
        }
        if (s?.lastError) lines.push(`error: ${s.lastError}`);
        lines.push('');
        lines.push('Click to open the runner audit log.');
        return new vscode.MarkdownString(lines.join('\n\n'));
    }

    // ── Agent count refresh ─────────────────────────────────────────

    private async refreshAgentCount(): Promise<void> {
        const client = this.authManager.getClient();
        const userId = this.authManager.getUserId();
        if (!client || !userId) {
            this.agentCount = null;
            this.agentCountUnknown = false;
            this.renderAgents();
            return;
        }
        try {
            const api = new AgentsApiClient(client);
            const agents = await api.listAgents(userId);
            this.agentCount = agents.length;
            this.agentCountUnknown = false;
        } catch (err) {
            if (isBackendDeferred(err)) {
                // 404 — endpoint not shipped yet, render "?"
                this.agentCount = null;
                this.agentCountUnknown = true;
                log('status bar: agents endpoint 404, rendering ?');
            } else {
                this.agentCount = null;
                this.agentCountUnknown = true;
                logError('status bar: agent count refresh failed', err);
            }
        }
        this.renderAgents();
    }

    private startAgentPoll(): void {
        this.stopAgentPoll();
        this.agentPollTimer = setInterval(() => {
            void this.refreshAgentCount();
        }, AGENT_POLL_MS);
    }

    private stopAgentPoll(): void {
        if (this.agentPollTimer) {
            clearInterval(this.agentPollTimer);
            this.agentPollTimer = null;
        }
    }

    dispose(): void {
        this.stopAgentPoll();
        this.mcpSub?.dispose();
        this.runnerSub?.dispose();
        for (const d of this.disposables) {
            try {
                d.dispose();
            } catch {
                // ignore
            }
        }
    }
}
