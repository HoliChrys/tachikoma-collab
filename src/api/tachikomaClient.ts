import { log, logError } from '../log';
import type {
    LoginResponse,
    UserInfo,
    HierarchyItem,
    FileEntry,
    ComponentResponse,
    ComponentStateResponse,
} from '../types';
import type {
    TmuxSessionInfo,
    ContextSessionGroup,
    ZellijWebInfo,
} from '../sessions/sessionTypes';

export class TachikomaClient {
    readonly baseUrl: string;
    private token: string | null = null;
    private machineId: string | null = null;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    setToken(token: string | null): void {
        this.token = token;
    }

    getToken(): string | null {
        return this.token;
    }

    /** Tag every request with the local machine identity so the server can
     * enforce role-based policy (e.g., refuse deletes from "local" machines).
     * Must be called after registerComputer() returns the machine_id. */
    setMachineId(machineId: string | null): void {
        this.machineId = machineId;
    }

    private headers(): Record<string, string> {
        const h: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.token) {
            h['Authorization'] = `Bearer ${this.token}`;
        }
        if (this.machineId) {
            // Server resolves machine_id → ComputerRecord.node_type
            // and stamps origin_machine_type on emitted events.
            h['X-Machine-Id'] = this.machineId;
        }
        return h;
    }

    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const url = `${this.baseUrl}${path}`;
        log(`${method} ${url}`);

        let resp: Response;
        try {
            resp = await fetch(url, {
                method,
                headers: this.headers(),
                body: body ? JSON.stringify(body) : undefined,
            });
        } catch (err) {
            logError(`Network error — cannot reach ${url}`, err);
            throw new Error(`Cannot reach ${url} — check that the host is correct and the server is running. (${err instanceof Error ? err.message : err})`);
        }

        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            const detail = `${method} ${path} → ${resp.status} ${resp.statusText}${text ? '\n' + text : ''}`;
            logError(detail);
            throw new Error(detail);
        }

        log(`${method} ${path} → ${resp.status} OK`);
        return resp.json() as Promise<T>;
    }

    async ping(): Promise<{ ok: boolean; status: number; detail: string }> {
        const url = `${this.baseUrl}/api/auth/me`;
        log(`PING ${url}`);
        try {
            const resp = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            const detail = `${resp.status} ${resp.statusText}`;
            log(`PING → ${detail}`);
            return { ok: resp.status === 401 || resp.ok, status: resp.status, detail };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logError(`PING failed`, err);
            return { ok: false, status: 0, detail: msg };
        }
    }

    // --- Auth ---

    async login(username: string, password: string): Promise<LoginResponse> {
        log(`Authenticating as "${username}"...`);
        const resp = await this.request<LoginResponse>('POST', '/api/auth/login', { username, password });
        this.token = resp.token;
        log(`Authenticated: user_id=${resp.user_id}, roles=${resp.roles.join(',')}`);
        return resp;
    }

    async me(): Promise<UserInfo> {
        return this.request<UserInfo>('GET', '/api/auth/me');
    }

    async logout(): Promise<void> {
        await this.request('POST', '/api/auth/logout');
        this.token = null;
        log('Logged out');
    }

    async refreshToken(): Promise<LoginResponse> {
        log('Refreshing token...');
        const resp = await this.request<LoginResponse>('POST', '/api/auth/refresh');
        this.token = resp.token;
        log(`Token refreshed for ${resp.user_id}`);
        return resp;
    }

    // --- Users ---

    async listUsers(): Promise<Array<{ user_id: string; name: string; state: string; user_type: string }>> {
        return this.request('GET', '/api/users');
    }

    async getUserContexts(userId: string): Promise<{ user_id: string; contexts: string[] }> {
        return this.request('GET', `/api/users/${userId}/contexts`);
    }

    // --- Hierarchy ---

    async getGalaxies(): Promise<HierarchyItem[]> {
        return this.request<HierarchyItem[]>('GET', '/api/hierarchy/galaxies');
    }

    async getSystems(): Promise<HierarchyItem[]> {
        return this.request<HierarchyItem[]>('GET', '/api/hierarchy/systems');
    }

    async getSpaces(): Promise<HierarchyItem[]> {
        return this.request<HierarchyItem[]>('GET', '/api/hierarchy/spaces');
    }

    async listContextFiles(contextPath: string, subpath: string = ''): Promise<FileEntry[]> {
        const params = subpath ? `?subpath=${encodeURIComponent(subpath)}` : '';
        const resp = await this.request<{ entries: FileEntry[] }>('GET', `/api/hierarchy/${contextPath}/files${params}`);
        return resp.entries ?? [];
    }

    async readFile(contextPath: string, filePath: string): Promise<string> {
        const resp = await this.request<{ content: string }>('GET', `/api/hierarchy/${contextPath}/file?path=${encodeURIComponent(filePath)}`);
        return resp.content;
    }

    async writeFile(contextPath: string, filePath: string, content: string): Promise<void> {
        await this.request('PUT', `/api/hierarchy/${contextPath}/file?path=${encodeURIComponent(filePath)}`, { content });
    }

    async createFile(contextPath: string, filePath: string): Promise<void> {
        await this.request('POST', `/api/hierarchy/${contextPath}/file?path=${encodeURIComponent(filePath)}`, { content: '' });
    }

    async createDir(contextPath: string, dirPath: string): Promise<void> {
        await this.request('POST', `/api/hierarchy/${contextPath}/mkdir?path=${encodeURIComponent(dirPath)}`);
    }

    async deleteEntry(contextPath: string, entryPath: string): Promise<void> {
        await this.request('DELETE', `/api/hierarchy/${contextPath}/file?path=${encodeURIComponent(entryPath)}`);
    }

    // --- Sessions ---

    async listSessionsByContext(): Promise<{ groups: ContextSessionGroup[]; total_active: number; total_exited: number }> {
        return this.request('GET', '/api/sessions/by-context');
    }

    async listTmuxSessions(ctxId?: string): Promise<{ sessions: TmuxSessionInfo[] }> {
        const qs = ctxId ? `?ctx_id=${encodeURIComponent(ctxId)}` : '';
        return this.request('GET', `/api/sessions/tmux${qs}`);
    }

    async getSessionWebInfo(contextPath: string): Promise<ZellijWebInfo> {
        const qs = contextPath ? `?context_path=${encodeURIComponent(contextPath)}` : '';
        return this.request('GET', `/api/sessions/web-info${qs}`);
    }

    async getSessionWeb(sessionId: string): Promise<{ ctx_id: string; iframe_url: string; session_url?: string; port: number; token: string }> {
        return this.request('GET', `/api/sessions/${encodeURIComponent(sessionId)}/web`);
    }

    async unlockSession(sessionId: string, password: string): Promise<{ ok: boolean }> {
        return this.request('POST', `/api/sessions/${encodeURIComponent(sessionId)}/unlock`, { password });
    }

    async grantSession(sessionId: string, actorId: string): Promise<unknown> {
        return this.request('POST', `/api/sessions/${encodeURIComponent(sessionId)}/grant`, { actor_id: actorId });
    }

    async listSessionGrants(sessionId: string): Promise<{ grants: Array<{ actor_id: string; granted_at: string }> }> {
        return this.request('GET', `/api/sessions/${encodeURIComponent(sessionId)}/grants`);
    }

    // --- Components ---

    async listComponents(sessionId?: string, componentType?: string): Promise<{ components: ComponentResponse[]; total: number }> {
        const params = new URLSearchParams();
        if (sessionId) params.set('session_id', sessionId);
        if (componentType) params.set('component_type', componentType);
        const qs = params.toString();
        return this.request('GET', `/api/components/${qs ? '?' + qs : ''}`);
    }

    /**
     * Snapshot of currently active participants per component.
     * Use on (re)connect to hydrate local activeUsers BEFORE subscribing to SSE,
     * which only delivers deltas after subscription time.
     */
    async getActiveParticipants(contextPath?: string): Promise<{
        participants: Array<{
            component_id: string;
            component_type: string;
            session_id: string;
            context_path: string;
            file_path: string;
            user_ids: string[];
        }>;
        total: number;
    }> {
        const qs = contextPath ? `?context_path=${encodeURIComponent(contextPath)}` : '';
        return this.request('GET', `/api/components/active-participants${qs}`);
    }

    async createComponent(componentType: string, sessionId: string, title: string = '', initialData: Record<string, unknown> = {}): Promise<ComponentResponse> {
        return this.request<ComponentResponse>('POST', '/api/components/', {
            component_type: componentType,
            session_id: sessionId,
            title,
            initial_data: initialData,
        });
    }

    async getComponentState(componentId: string): Promise<ComponentStateResponse> {
        return this.request<ComponentStateResponse>('GET', `/api/components/${componentId}/state`);
    }

    async updateComponent(componentId: string, sessionId: string, fields: Record<string, unknown>): Promise<unknown> {
        return this.request('POST', `/api/components/${componentId}/update`, {
            session_id: sessionId,
            fields,
        });
    }

    async joinComponent(componentId: string, sessionId: string, participantType: string = 'user'): Promise<unknown> {
        return this.request('POST', `/api/components/${componentId}/join`, {
            session_id: sessionId,
            participant_type: participantType,
        });
    }

    async leaveComponent(componentId: string, sessionId: string): Promise<unknown> {
        return this.request('POST', `/api/components/${componentId}/leave`, {
            session_id: sessionId,
        });
    }

    getStreamUrl(): string {
        return `${this.baseUrl}/api/components/stream?token=${encodeURIComponent(this.token ?? '')}`;
    }

    async registerComputer(data: {
        machine_id: string;
        hostname: string;
        node_type: string;
        os_type: string;
        os_version: string;
        ip_addresses?: string[];
        tachikoma_version?: string;
        name?: string;
    }): Promise<unknown> {
        return this.request('POST', '/api/network/computers/register', data);
    }

    async computerHeartbeat(machineId: string): Promise<unknown> {
        return this.request('POST', `/api/network/computers/${machineId}/heartbeat`);
    }

    // ── MCP profiles + active profile (E5+) ────────────────────────────

    /** List MCPProfileRecord visible to *userId* (granted directly or
     * via group membership). */
    async listMcpProfiles(userId: string): Promise<{ profiles: MCPProfile[]; total: number }> {
        const q = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
        return this.request<{ profiles: MCPProfile[]; total: number }>(
            'GET', `/api/mcp/profiles/${q}`,
        );
    }

    /** Read the user's currently active MCP profile (or null). */
    async getActiveProfile(userId: string): Promise<ActiveProfileResponse> {
        return this.request<ActiveProfileResponse>(
            'GET', `/api/users/${encodeURIComponent(userId)}/active-profile`,
        );
    }

    /** Set / clear the user's active MCP profile. Empty string clears.
     * The backend emits UserActiveProfileChanged on the EventBus and a
     * matching SSE notification reaches the connected extension. */
    async setActiveProfile(
        userId: string, profileId: string,
    ): Promise<{ user_id: string; active_profile_id: string; previous_profile_id: string }> {
        return this.request(
            'PATCH', `/api/users/${encodeURIComponent(userId)}/active-profile`,
            { profile_id: profileId },
        );
    }
}

// ── MCP profile types (kept in this file to avoid a new types module) ────

export interface MCPCapability {
    kind: 'tool' | 'ui' | 'resource' | 'prompt';
    id: string;
    name: string;
    description?: string;
}

export interface MCPProfile {
    id: string;
    profile_name: string;
    display_name: string;
    icon: string;
    user_id: string;
    created_by: string;
    description: string;
    context_path: string;
    labels: Record<string, string>;
    state: 'active' | 'suspended' | 'archived';
    tool_names: string[];
    capabilities: MCPCapability[];
}

export interface ActiveProfileResponse {
    user_id: string;
    active_profile_id: string;
    profile: MCPProfile | null;
}
