import { EventSource } from 'eventsource';
import { log, logError } from '../log';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { McpProfileStore } from './mcpProfileStore';

/**
 * SSE-driven live update bridge for the MCP profile state.
 *
 * Opens an `EventSource` on the backend `/api/mcp/sse` channel and
 * translates the tachikoma-specific + MCP-standard notifications into
 * imperative `McpProfileStore` mutations:
 *
 *   notifications/tachikoma/active_profile_changed
 *     → store.applyActiveProfileChanged(uid, new_id)
 *
 *   notifications/tools/list_changed   (+ resources, prompts)
 *     → store.applyListChanged()  (debounced refresh)
 *
 * Reconnect with exponential backoff is delegated to the EventSource
 * polyfill; on a true failure we surface the error in the log and
 * leave the store untouched (the next manual refresh recovers).
 */
export class McpProfileSseBridge {
    private eventSource: EventSource | null = null;

    constructor(
        private readonly client: TachikomaClient,
        private readonly store: McpProfileStore,
    ) {}

    /**
     * Start listening. Idempotent — calling twice closes the previous
     * connection and opens a new one with the (presumably refreshed)
     * token.
     */
    start(): void {
        this.stop();
        const token = this.client.getToken();
        if (!token) {
            log('McpProfileSseBridge: no token, skipping connect');
            return;
        }
        const url = `${this.client.baseUrl}/api/mcp/sse?token=${encodeURIComponent(token)}`;
        log(`McpProfileSseBridge: connecting to ${url.replace(/token=[^&]+/, 'token=***')}`);
        try {
            this.eventSource = new EventSource(url);
        } catch (err) {
            logError('McpProfileSseBridge: EventSource constructor failed', err);
            return;
        }

        this.eventSource.addEventListener('message', (ev: MessageEvent) => {
            this._handleFrame(ev.data);
        });
        this.eventSource.addEventListener('error', (ev: Event) => {
            log(`McpProfileSseBridge: SSE error (will auto-reconnect): ${String(ev)}`);
        });
    }

    stop(): void {
        if (this.eventSource) {
            try { this.eventSource.close(); }
            catch (err) { logError('McpProfileSseBridge.stop: close failed', err); }
            this.eventSource = null;
        }
    }

    private _handleFrame(raw: string): void {
        if (!raw) return;
        let msg: any;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;  // unparseable frames are silently dropped
        }
        const method = msg?.method;
        if (!method) return;

        if (method === 'notifications/tachikoma/active_profile_changed') {
            const params = msg.params ?? {};
            const uid = String(params.user_id ?? '');
            const newId = String(params.new_profile_id ?? '');
            if (uid) {
                this.store.applyActiveProfileChanged(uid, newId);
            }
            return;
        }

        if (
            method === 'notifications/tools/list_changed'
            || method === 'notifications/resources/list_changed'
            || method === 'notifications/prompts/list_changed'
        ) {
            this.store.applyListChanged();
            return;
        }
        // Other notifications (mcp standard or otherwise) are passed
        // through to whoever else wants them — the bridge here only
        // observes profile-related ones.
    }

    dispose(): void {
        this.stop();
    }
}
