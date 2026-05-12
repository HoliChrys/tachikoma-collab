import { log, logError } from '../log';
import type {
    LoginResponse,
    UserInfo,
    HierarchyItem,
    ComponentResponse,
    ComponentStateResponse,
} from '../types';

export class TachikomaClient {
    readonly baseUrl: string;
    private token: string | null = null;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    setToken(token: string | null): void {
        this.token = token;
    }

    getToken(): string | null {
        return this.token;
    }

    private headers(): Record<string, string> {
        const h: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.token) {
            h['Authorization'] = `Bearer ${this.token}`;
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

    // --- Components ---

    async listComponents(sessionId?: string, componentType?: string): Promise<{ components: ComponentResponse[]; total: number }> {
        const params = new URLSearchParams();
        if (sessionId) params.set('session_id', sessionId);
        if (componentType) params.set('component_type', componentType);
        const qs = params.toString();
        return this.request('GET', `/api/components/${qs ? '?' + qs : ''}`);
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
}
