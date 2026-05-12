import type {
    LoginResponse,
    UserInfo,
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
        const resp = await fetch(url, {
            method,
            headers: this.headers(),
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`${method} ${path} failed (${resp.status}): ${text}`);
        }
        return resp.json() as Promise<T>;
    }

    // --- Auth ---

    async login(username: string, password: string): Promise<LoginResponse> {
        const resp = await this.request<LoginResponse>('POST', '/api/auth/login', { username, password });
        this.token = resp.token;
        return resp;
    }

    async me(): Promise<UserInfo> {
        return this.request<UserInfo>('GET', '/api/auth/me');
    }

    async logout(): Promise<void> {
        await this.request('POST', '/api/auth/logout');
        this.token = null;
    }

    async refreshToken(): Promise<LoginResponse> {
        const resp = await this.request<LoginResponse>('POST', '/api/auth/refresh');
        this.token = resp.token;
        return resp;
    }

    // --- Hierarchy ---

    async getHierarchy(): Promise<unknown> {
        return this.request('GET', '/api/hierarchy/galaxies');
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
