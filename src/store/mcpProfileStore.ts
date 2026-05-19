import * as vscode from 'vscode';
import { log, logError } from '../log';
import type {
    MCPProfile,
    TachikomaClient,
} from '../api/tachikomaClient';

/**
 * Single source of truth for the connected user's MCP profile state
 * inside the extension. Backs the statusbar, the TreeView, and the
 * webview-side profile picker.
 *
 * The store is **reactive but lazy**: it never polls. Updates come
 * from two paths:
 *  1. Explicit refresh — `refresh()` re-fetches `/api/mcp/profiles?user_id=...`
 *     and `/api/users/{uid}/active-profile`.
 *  2. SSE-driven hints — `applyActiveProfileChanged()` and
 *     `applyToolsListChanged()` are called by the SSE bridge
 *     (`McpProfileSseBridge`) when the backend signals a change.
 *
 * The fan-out is intentionally fine-grained: the SSE notification
 * carries the new profile_id explicitly, so we don't always need to
 * refetch — the bridge only triggers `refresh()` when the capabilities
 * themselves moved.
 */
export class McpProfileStore {
    private profiles: MCPProfile[] = [];
    private activeProfileId: string = '';
    private currentUserId: string = '';

    private readonly _emitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this._emitter.event;

    constructor(private readonly client: TachikomaClient) {}

    /** Re-fetch both the granted profile list and the active id from
     * the backend. Idempotent. */
    async refresh(userId: string): Promise<void> {
        this.currentUserId = userId;
        try {
            const list = await this.client.listMcpProfiles(userId);
            this.profiles = list.profiles ?? [];
        } catch (err) {
            logError('McpProfileStore.refresh: listMcpProfiles failed', err);
            this.profiles = [];
        }
        try {
            const active = await this.client.getActiveProfile(userId);
            this.activeProfileId = active.active_profile_id ?? '';
        } catch (err) {
            logError('McpProfileStore.refresh: getActiveProfile failed', err);
            this.activeProfileId = '';
        }
        this._emitter.fire();
    }

    /** Switch the active profile. The actual state update lands when
     * the SSE notification fires back — but we apply an optimistic UI
     * update immediately so the statusbar/tree don't flicker. */
    async setActive(profileId: string): Promise<void> {
        if (!this.currentUserId) {
            log('McpProfileStore.setActive: no current user, skipping');
            return;
        }
        const previous = this.activeProfileId;
        this.activeProfileId = profileId;
        this._emitter.fire();
        try {
            await this.client.setActiveProfile(this.currentUserId, profileId);
        } catch (err) {
            logError('McpProfileStore.setActive: API call failed, rolling back', err);
            this.activeProfileId = previous;
            this._emitter.fire();
            throw err;
        }
    }

    /** Apply an SSE-driven active profile change. The notification
     * carries the new id directly so no refetch needed. */
    applyActiveProfileChanged(userId: string, newProfileId: string): void {
        if (userId !== this.currentUserId) return;
        if (this.activeProfileId === newProfileId) return;
        this.activeProfileId = newProfileId;
        this._emitter.fire();
    }

    /** Called by the SSE bridge on `tools|resources|prompts/list_changed`.
     * Triggers a debounced refresh of profiles since the capability
     * set under one of them moved. */
    private _refreshTimer: NodeJS.Timeout | null = null;
    applyListChanged(): void {
        if (!this.currentUserId) return;
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => {
            this.refresh(this.currentUserId).catch(err =>
                logError('McpProfileStore: debounced refresh failed', err),
            );
        }, 250);
    }

    // ── Read-only accessors used by UI ────────────────────────────────

    getProfiles(): readonly MCPProfile[] { return this.profiles; }
    getActiveProfileId(): string { return this.activeProfileId; }
    getActiveProfile(): MCPProfile | undefined {
        return this.profiles.find(p => p.id === this.activeProfileId);
    }
    getUserId(): string { return this.currentUserId; }

    /** Flatten one or all profiles' capabilities for UI grouping. */
    listCapabilitiesByKind(profileId?: string): Record<string, string[]> {
        const target = profileId
            ? this.profiles.filter(p => p.id === profileId)
            : (this.activeProfileId
                ? this.profiles.filter(p => p.id === this.activeProfileId)
                : this.profiles);
        const out: Record<string, string[]> = {
            tool: [], ui: [], resource: [], prompt: [],
        };
        for (const p of target) {
            for (const cap of p.capabilities ?? []) {
                if (out[cap.kind]) out[cap.kind].push(cap.id);
            }
        }
        return out;
    }

    dispose(): void {
        this._emitter.dispose();
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
    }
}
