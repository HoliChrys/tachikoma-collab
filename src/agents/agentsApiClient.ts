// VI-1d agent + swarm REST wrapper.
//
// Endpoint status (as of 2026-05-20):
//   GET  /api/users/agents      — IMPLEMENTED (users.py:173)
//   POST /api/users/agents      — IMPLEMENTED (users.py:181, admin only)
//   GET  /api/agents/{id}       — NOT YET (no server route)
//   POST /api/agents/{id}/stop  — NOT YET (no server route)
//   GET  /api/swarms            — NOT YET (no server route)
//   POST /api/swarms            — NOT YET (no server route)
//   POST /api/swarms/{id}/members         — NOT YET
//   DELETE /api/swarms/{id}/members/{aid} — NOT YET
//
// The wrapper translates HTTP 404 into a sentinel Error so call-sites
// can degrade gracefully while the unimplemented endpoints stay 404.
//
// Spec: .agents/specs/to_do/VI-1d-agent-hosting.md.
// ASCII only, 4-space indent.

import type { TachikomaClient } from '../api/tachikomaClient';
import { log, logError } from '../log';

export const BACKEND_DEFERRED_MESSAGE =
    'Backend endpoint not yet available - feature deferred to backend update';

export interface AgentRecord {
    id: string;
    name: string;
    template: string;
    owner_id: string;
    mode: 'local' | 'remote';
    machine_ids: string[];
    state: 'idle' | 'working' | 'awaiting_approval' | 'stopped' | 'blocked';
    created_at?: string;
}

export interface SwarmMember {
    agent_id: string;
    role?: string;
    link?: string;
}

export interface SwarmRecord {
    id: string;
    name: string;
    topology_kind: 'mesh' | 'star' | 'hierarchical';
    creator: string;
    members: SwarmMember[];
    created_at?: string;
}

/**
 * Tiny wrapper around the connected TachikomaClient that performs raw
 * fetch (since `client.request` is private) but mirrors its auth and
 * error-handling contract. The wrapper translates HTTP 404 into a
 * sentinel Error so call-sites can degrade gracefully while the backend
 * endpoints are not yet implemented.
 */
export class AgentsApiClient {
    constructor(private readonly client: TachikomaClient) {}

    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const url = `${this.client.baseUrl}${path}`;
        const token = this.client.getToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        log(`agents:${method} ${url}`);

        let resp: Response;
        try {
            resp = await fetch(url, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
            });
        } catch (err) {
            logError(`agents: network error reaching ${url}`, err);
            throw new Error(`Cannot reach ${url} (${err instanceof Error ? err.message : err})`);
        }

        if (resp.status === 404) {
            log(`agents:${method} ${path} -> 404 (backend endpoint missing)`);
            throw new Error(BACKEND_DEFERRED_MESSAGE);
        }
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            const detail = `${method} ${path} -> ${resp.status} ${resp.statusText}${text ? '\n' + text : ''}`;
            logError(detail);
            throw new Error(detail);
        }
        return resp.json() as Promise<T>;
    }

    // --- Agents ---

    async listAgents(userId: string): Promise<AgentRecord[]> {
        // Server lives at /api/users/agents (users.py:173). The owner_id
        // filter is not honoured server-side yet — the endpoint returns
        // ALL agent-type users — but the query param is harmless and
        // we keep it for when the filter lands.
        const qs = userId ? `?owner_id=${encodeURIComponent(userId)}` : '';
        const resp = await this.request<AgentRecord[] | { agents: AgentRecord[] }>(
            'GET', `/api/users/agents${qs}`,
        );
        return Array.isArray(resp) ? resp : (resp.agents ?? []);
    }

    async spawnAgent(template: string, name: string, machineIds: string[]): Promise<AgentRecord> {
        // Server: POST /api/users/agents (users.py:181, admin only).
        return this.request<AgentRecord>('POST', '/api/users/agents', {
            template,
            name,
            machine_ids: machineIds,
            mode: 'local',
        });
    }

    async getAgent(id: string): Promise<AgentRecord> {
        return this.request<AgentRecord>('GET', `/api/agents/${encodeURIComponent(id)}`);
    }

    async stopAgent(id: string): Promise<void> {
        await this.request('POST', `/api/agents/${encodeURIComponent(id)}/stop`);
    }

    // --- Swarms ---

    async listSwarms(): Promise<SwarmRecord[]> {
        const resp = await this.request<SwarmRecord[] | { swarms: SwarmRecord[] }>(
            'GET', '/api/swarms',
        );
        return Array.isArray(resp) ? resp : (resp.swarms ?? []);
    }

    async createSwarm(name: string, topology: 'mesh' | 'star' | 'hierarchical'): Promise<SwarmRecord> {
        return this.request<SwarmRecord>('POST', '/api/swarms', {
            name,
            topology_kind: topology,
        });
    }

    async addMember(swarmId: string, agentId: string, role?: string, link?: string): Promise<void> {
        await this.request('POST', `/api/swarms/${encodeURIComponent(swarmId)}/members`, {
            agent_id: agentId,
            role,
            link,
        });
    }

    async removeMember(swarmId: string, agentId: string): Promise<void> {
        await this.request(
            'DELETE',
            `/api/swarms/${encodeURIComponent(swarmId)}/members/${encodeURIComponent(agentId)}`,
        );
    }
}

/** True when the given error came from a 404 backend response. */
export function isBackendDeferred(err: unknown): boolean {
    return err instanceof Error && err.message === BACKEND_DEFERRED_MESSAGE;
}
