// VI-1d agent + swarm command surface.
//
// Registers four palette commands :
//   - tachikoma.agents.spawn       prompt template + name, call spawnAgent
//   - tachikoma.agents.stop        stop the selected (or prompted) agent
//   - tachikoma.swarm.create       prompt name + topology, call createSwarm
//   - tachikoma.swarm.addMember    prompt swarm + agent + role, call addMember
//
// All commands degrade gracefully when /api/agents or /api/swarms return
// 404 (the BACKEND_DEFERRED_MESSAGE sentinel from agentsApiClient.ts).
//
// Wiring into extension.ts is deferred; this module just exposes the
// `registerAgentCommands` factory.
//
// Spec: .agents/specs/to_do/VI-1d-agent-hosting.md.
// ASCII only, 4-space indent.

import * as vscode from 'vscode';
import * as os from 'os';
import type { AuthManager } from '../auth/authManager';
import { log, logError } from '../log';
import {
    AgentsApiClient,
    BACKEND_DEFERRED_MESSAGE,
    isBackendDeferred,
    type AgentRecord,
    type SwarmRecord,
} from './agentsApiClient';

const TEMPLATES = ['claude', 'openclaw', 'react'] as const;
const TOPOLOGIES = ['mesh', 'star', 'hierarchical'] as const;

function localComputerId(): string {
    // Same normalisation as extension.ts:163 (first DNS label only,
    // lowercase) so this id is stable across mDNS / Tailscale FQDN
    // flips and matches the one the heartbeat loop sends.
    const rawHost = os.hostname();
    const label = (rawHost.split('.')[0] || rawHost).toLowerCase();
    return `vscode-${label}-${os.userInfo().username}`;
}

function requireApi(authManager: AuthManager): AgentsApiClient | null {
    const client = authManager.getClient();
    if (!client) {
        vscode.window.showWarningMessage('Tachikoma: connect first');
        return null;
    }
    return new AgentsApiClient(client);
}

function reportError(action: string, err: unknown): void {
    if (isBackendDeferred(err)) {
        vscode.window.showWarningMessage(`Tachikoma: ${action} unavailable - ${BACKEND_DEFERRED_MESSAGE}`);
        log(`agents:${action} skipped - backend deferred`);
        return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Tachikoma: ${action} failed - ${msg}`);
    logError(`agents:${action}`, err);
}

export function registerAgentCommands(
    authManager: AuthManager,
    onChange?: () => void,
): vscode.Disposable {
    const fire = (): void => { try { onChange?.(); } catch { /* noop */ } };

    return vscode.Disposable.from(
        vscode.commands.registerCommand('tachikoma.agents.spawn', async () => {
            const api = requireApi(authManager); if (!api) return;
            const template = await vscode.window.showQuickPick([...TEMPLATES], {
                placeHolder: 'Agent template',
            });
            if (!template) return;
            const name = await vscode.window.showInputBox({
                prompt: 'Agent name',
                placeHolder: `${template}-local`,
                ignoreFocusOut: true,
            });
            if (!name) return;
            try {
                const agent = await api.spawnAgent(template, name, [localComputerId()]);
                vscode.window.showInformationMessage(`Spawned agent ${agent.name} (${agent.id})`);
                fire();
            } catch (err) {
                reportError('spawn', err);
            }
        }),

        vscode.commands.registerCommand('tachikoma.agents.stop', async (node?: { agent?: AgentRecord }) => {
            const api = requireApi(authManager); if (!api) return;
            let id = node?.agent?.id;
            if (!id) {
                id = await vscode.window.showInputBox({
                    prompt: 'Agent id to stop',
                    ignoreFocusOut: true,
                });
                if (!id) return;
            }
            try {
                await api.stopAgent(id);
                vscode.window.showInformationMessage(`Agent ${id} stopped`);
                fire();
            } catch (err) {
                reportError('stop', err);
            }
        }),

        vscode.commands.registerCommand('tachikoma.swarm.create', async () => {
            const api = requireApi(authManager); if (!api) return;
            const name = await vscode.window.showInputBox({
                prompt: 'Swarm name',
                ignoreFocusOut: true,
            });
            if (!name) return;
            const topology = await vscode.window.showQuickPick([...TOPOLOGIES], {
                placeHolder: 'Topology',
            });
            if (!topology) return;
            try {
                const swarm = await api.createSwarm(name, topology as typeof TOPOLOGIES[number]);
                vscode.window.showInformationMessage(`Swarm ${swarm.name} (${swarm.id}) created`);
                fire();
            } catch (err) {
                reportError('swarm.create', err);
            }
        }),

        vscode.commands.registerCommand('tachikoma.swarm.addMember', async () => {
            const api = requireApi(authManager); if (!api) return;
            let swarms: SwarmRecord[] = [];
            try {
                swarms = await api.listSwarms();
            } catch (err) {
                reportError('swarm.list', err);
                return;
            }
            if (swarms.length === 0) {
                vscode.window.showInformationMessage('No swarms - create one first.');
                return;
            }
            const swarmPick = await vscode.window.showQuickPick(
                swarms.map(s => ({ label: s.name, description: s.topology_kind, detail: s.id })),
                { placeHolder: 'Pick a swarm' },
            );
            if (!swarmPick) return;
            const agentId = await vscode.window.showInputBox({
                prompt: 'Agent id to add',
                ignoreFocusOut: true,
            });
            if (!agentId) return;
            const role = await vscode.window.showInputBox({
                prompt: 'Role (optional)',
                ignoreFocusOut: true,
            });
            const link = await vscode.window.showInputBox({
                prompt: 'Link / parent (optional)',
                ignoreFocusOut: true,
            });
            try {
                await api.addMember(swarmPick.detail!, agentId, role || undefined, link || undefined);
                vscode.window.showInformationMessage(`Agent ${agentId} added to ${swarmPick.label}`);
                fire();
            } catch (err) {
                reportError('swarm.addMember', err);
            }
        }),
    );
}
