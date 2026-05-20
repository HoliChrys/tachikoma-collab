import * as vscode from 'vscode';
import { log, logError } from '../log';
import type { AuthManager } from '../auth/authManager';
import type {
    ComputerResponse,
    NetworkEvent,
    TachikomaClient,
} from '../api/tachikomaClient';

/**
 * Live WebviewViewProvider for the dedicated "Runner" activity-bar
 * container (`tachikomaRunner` -> view `tachikomaRunnerHome`).
 *
 * Renders a whiteboard-style canvas of draggable cards, one per
 * computer the current user can see (ACL-filtered server-side via
 * GET /api/network/computers). Mirrors the dashboard's
 * RunnerWhiteboardView but ships as a single inline HTML/JS bundle
 * — VS Code webviews are isolated from the workbench DOM so styles
 * live here directly.
 *
 * Live updates :
 *   - Primary path subscribes to `/api/events/stream?entities=computer`
 *     on the existing event-bus SSE and refetches the inventory on
 *     `computer.*` notifications (same approach as McpProfileSseBridge).
 *   - Fallback path polls every 5 seconds when SSE cannot be reached
 *     (no token, network down, or the stream errors out).
 *
 * Webview <-> extension protocol :
 *   ext  -> view : { type: 'computers', payload: ComputerResponse[] }
 *                  { type: 'summary',   payload: { total, online } }
 *                  { type: 'error',     message: string }
 *   view -> ext  : { type: 'ready' }
 *                  { type: 'refresh' }
 *                  { type: 'openTerminal', machineId: string }
 *                  { type: 'attach',       machineId: string }
 *                  { type: 'dragEnd', machineId: string, x: number, y: number }
 *
 * Drag positions are persisted in webview-localStorage only; this view
 * does not write them back to the server (the dashboard does, on a
 * different surface).
 */
export class RunnerHomeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'tachikomaRunnerHome';

    private view: vscode.WebviewView | null = null;
    private sseDisposable: { dispose(): void } | null = null;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private lastComputers: ComputerResponse[] = [];
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly authManager: AuthManager,
    ) {
        // React to (re)connect events so we (re)wire SSE+poll without
        // requiring the user to reopen the view.
        this.disposables.push(
            this.authManager.onDidConnect(() => {
                this._restartLive();
                void this._refreshComputers();
            }),
            this.authManager.onDidDisconnect(() => {
                this._stopLive();
                this._postComputers([]);
            }),
        );
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _ctx: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };
        webviewView.webview.html = this._buildHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            (msg: IncomingMessage) => { void this._onMessage(msg); },
            undefined,
            this.disposables,
        );

        webviewView.onDidDispose(() => {
            this.view = null;
            this._stopLive();
        }, null, this.disposables);

        // Kick off live wiring on first resolve if already connected.
        if (this.authManager.isConnected()) {
            this._restartLive();
            void this._refreshComputers();
        } else {
            this._postComputers([]);
        }
    }

    dispose(): void {
        this._stopLive();
        for (const d of this.disposables) {
            try { d.dispose(); } catch { /* ignore */ }
        }
        this.disposables.length = 0;
        this.view = null;
    }

    // ── live update wiring ─────────────────────────────────────────────

    private _restartLive(): void {
        this._stopLive();
        const client = this.authManager.getClient();
        if (!client) {
            return;
        }
        // Always start the polling fallback at 30s — covers the case
        // where SSE silently drops mid-stream without emitting an error
        // event the fetch reader can see. SSE arrival just resets the
        // "last refresh" age but the timer is cheap (one GET).
        this.pollTimer = setInterval(() => {
            void this._refreshComputers();
        }, 30_000);

        try {
            this.sseDisposable = client.subscribeNetworkSse((ev: NetworkEvent) => {
                this._handleSseEvent(ev);
            });
        } catch (err) {
            logError('Runner: SSE subscribe failed, polling at 5s', err);
            // Tighter poll if SSE is broken so users still see updates.
            if (this.pollTimer) { clearInterval(this.pollTimer); }
            this.pollTimer = setInterval(() => {
                void this._refreshComputers();
            }, 5_000);
        }
    }

    private _stopLive(): void {
        if (this.sseDisposable) {
            try { this.sseDisposable.dispose(); } catch { /* ignore */ }
            this.sseDisposable = null;
        }
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private _handleSseEvent(ev: NetworkEvent): void {
        // Refetch on any computer.* or node.* event the stream lets through.
        // We don't try to patch in place — the round-trip is cheap and the
        // computer list ships fully ACL-filtered so deltas are tricky.
        const t = String(ev?.entity_type ?? '');
        const e = String(ev?.event_type ?? '');
        if (t === 'computer' || e.startsWith('computer.') || e.startsWith('node.')) {
            void this._refreshComputers();
        }
    }

    private async _refreshComputers(): Promise<void> {
        const client = this.authManager.getClient();
        if (!client) {
            this._postComputers([]);
            return;
        }
        try {
            const computers = await client.getNetworkComputers();
            this.lastComputers = computers;
            this._postComputers(computers);
        } catch (err) {
            logError('Runner: getNetworkComputers failed', err);
            // Keep the last known list visible; surface the error in the view.
            this._postError(err instanceof Error ? err.message : String(err));
        }
    }

    private _postComputers(computers: ComputerResponse[]): void {
        if (!this.view) return;
        const online = computers.filter(c => c.state === 'online').length;
        void this.view.webview.postMessage({
            type: 'computers',
            payload: computers,
        } satisfies OutgoingMessage);
        void this.view.webview.postMessage({
            type: 'summary',
            payload: { total: computers.length, online },
        } satisfies OutgoingMessage);
    }

    private _postError(message: string): void {
        if (!this.view) return;
        void this.view.webview.postMessage({
            type: 'error',
            message,
        } satisfies OutgoingMessage);
    }

    // ── webview -> extension ───────────────────────────────────────────

    private async _onMessage(msg: IncomingMessage): Promise<void> {
        if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
        try {
            switch (msg.type) {
                case 'ready':
                    // The webview just (re)loaded; push the current snapshot
                    // so the user does not stare at an empty grid while we
                    // wait for the first SSE event.
                    if (this.lastComputers.length > 0) {
                        this._postComputers(this.lastComputers);
                    } else {
                        void this._refreshComputers();
                    }
                    return;
                case 'refresh':
                    await this._refreshComputers();
                    return;
                case 'openTerminal':
                    await vscode.commands.executeCommand(
                        'tachikoma.runner.openTerminal',
                        msg.machineId,
                    );
                    return;
                case 'attach':
                    await vscode.commands.executeCommand(
                        'tachikoma.runner.attach',
                        msg.machineId,
                    );
                    return;
                case 'dragEnd':
                    // Positions are kept in webview-localStorage only; the
                    // extension host is informed so future iterations can
                    // sync to the server without changing the protocol.
                    log(`Runner: drag ${msg.machineId} -> (${msg.x}, ${msg.y})`);
                    return;
                default:
                    log(`Runner: ignored unknown message ${(msg as { type?: string }).type ?? ''}`);
            }
        } catch (err) {
            logError(`Runner: message ${msg.type} failed`, err);
        }
    }

    // ── HTML ───────────────────────────────────────────────────────────

    private _buildHtml(webview: vscode.Webview): string {
        const nonce = makeNonce();
        const csp = [
            `default-src 'none'`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `script-src 'nonce-${nonce}'`,
            `img-src ${webview.cspSource} data:`,
            `connect-src 'none'`,
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Tachikoma Runner</title>
<style>
    :root {
        --tk-bg: #0d0a1f;
        --tk-bg-2: #16102e;
        --tk-purple: #7b4dff;
        --tk-purple-2: #a584ff;
        --tk-purple-dim: rgba(123, 77, 255, 0.28);
        --tk-text: #ece9ff;
        --tk-text-dim: #9a96b8;
        --tk-text-dimer: #6c6890;
        --tk-glass: rgba(255, 255, 255, 0.04);
        --tk-glass-border: rgba(180, 160, 255, 0.18);
        --tk-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
        --tk-online: #10b981;
        --tk-offline: #6b7280;
        --tk-busy: #f59e0b;
        --col-local-primary: #10b981;
        --col-local-light: #34d399;
        --col-local-bg: rgba(16, 185, 129, 0.10);
        --col-local-border: rgba(16, 185, 129, 0.30);
        --col-server-primary: #8b5cf6;
        --col-server-light: #a78bfa;
        --col-server-bg: rgba(139, 92, 246, 0.10);
        --col-server-border: rgba(139, 92, 246, 0.30);
        --col-cloud-primary: #0ea5e9;
        --col-cloud-bg: rgba(14, 165, 233, 0.10);
        --col-cloud-border: rgba(14, 165, 233, 0.30);
    }
    * { box-sizing: border-box; }
    html, body {
        margin: 0; padding: 0;
        height: 100%;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        color: var(--tk-text);
        background:
            radial-gradient(600px 320px at 20% -10%, var(--tk-purple-dim), transparent 70%),
            radial-gradient(500px 280px at 110% 110%, rgba(165, 132, 255, 0.18), transparent 70%),
            linear-gradient(180deg, var(--tk-bg) 0%, var(--tk-bg-2) 100%);
        overflow: hidden;
    }
    body { display: flex; flex-direction: row; }

    /* ── pulse keyframe (online icon background) ────────────────────── */
    @keyframes tk-pulse {
        0%   { box-shadow: 0 0 0 0   rgba(16, 185, 129, 0.55); }
        70%  { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0.00); }
        100% { box-shadow: 0 0 0 0   rgba(16, 185, 129, 0.00); }
    }

    /* ── mini sidebar ───────────────────────────────────────────────── */
    .sidebar {
        flex: 0 0 auto;
        width: 56px;
        height: 100%;
        background: rgba(13, 10, 31, 0.78);
        border-right: 1px solid var(--tk-glass-border);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        overflow: hidden;
        transition: width 180ms ease;
        z-index: 30;
        display: flex;
        flex-direction: column;
    }
    .sidebar:hover { width: 240px; }
    .sidebar-title {
        flex: 0 0 auto;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--tk-text-dimer);
        padding: 12px 14px 6px;
        white-space: nowrap;
        opacity: 0;
        transition: opacity 180ms ease;
    }
    .sidebar:hover .sidebar-title { opacity: 1; }
    .sidebar-list {
        flex: 1 1 auto;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 6px 6px 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .sb-entry {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
        border-radius: 8px;
        cursor: pointer;
        color: var(--tk-text);
        border: 1px solid transparent;
        background: rgba(255, 255, 255, 0.02);
        transition: background 120ms ease, border-color 120ms ease;
        white-space: nowrap;
        overflow: hidden;
    }
    .sb-entry:hover {
        background: rgba(123, 77, 255, 0.14);
        border-color: rgba(165, 132, 255, 0.32);
    }
    .sb-icon {
        position: relative;
        flex: 0 0 32px;
        width: 32px; height: 32px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .sb-entry[data-node-type="local"]  .sb-icon { background: var(--col-local-bg);  border: 1px solid var(--col-local-border);  color: var(--col-local-primary); }
    .sb-entry[data-node-type="server"] .sb-icon { background: var(--col-server-bg); border: 1px solid var(--col-server-border); color: var(--col-server-primary); }
    .sb-entry[data-node-type="cloud"]  .sb-icon { background: var(--col-cloud-bg);  border: 1px solid var(--col-cloud-border);  color: var(--col-cloud-primary); }
    .sb-icon svg { width: 16px; height: 16px; }
    .sb-entry[data-status="online"] .sb-icon {
        animation: tk-pulse 2.4s ease infinite;
    }
    .sb-dot {
        position: absolute;
        right: -2px; bottom: -2px;
        width: 8px; height: 8px;
        border-radius: 50%;
        border: 2px solid rgba(13, 10, 31, 0.95);
    }
    .sb-entry[data-status="online"]  .sb-dot { background: var(--tk-online); }
    .sb-entry[data-status="offline"] .sb-dot { background: var(--tk-offline); }
    .sb-entry[data-status="busy"]    .sb-dot { background: var(--tk-busy); }
    .sb-meta {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
        opacity: 0;
        transition: opacity 180ms ease;
    }
    .sidebar:hover .sb-meta { opacity: 1; }
    .sb-name {
        font-size: 12px;
        font-weight: 500;
        color: var(--tk-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .sb-ip {
        font-size: 10px;
        color: var(--tk-text-dim);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .sb-pill {
        flex: 0 0 auto;
        font-size: 9px;
        font-weight: 500;
        padding: 2px 6px;
        border-radius: 999px;
        text-transform: capitalize;
        border: 1px solid;
        opacity: 0;
        transition: opacity 180ms ease;
    }
    .sidebar:hover .sb-pill { opacity: 1; }
    .sb-pill.status-online  { color: var(--tk-online);  background: rgba(16, 185, 129, 0.12);  border-color: rgba(16, 185, 129, 0.35); }
    .sb-pill.status-offline { color: var(--tk-offline); background: rgba(107, 114, 128, 0.12); border-color: rgba(107, 114, 128, 0.30); }
    .sb-pill.status-busy    { color: var(--tk-busy);    background: rgba(245, 158, 11, 0.12);  border-color: rgba(245, 158, 11, 0.32); }
    .sb-empty {
        font-size: 11px;
        color: var(--tk-text-dimer);
        padding: 8px 10px;
        opacity: 0;
        transition: opacity 180ms ease;
    }
    .sidebar:hover .sb-empty { opacity: 1; }

    .main-wrap {
        flex: 1 1 auto;
        min-width: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
    }
    .header {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--tk-glass-border);
        background: rgba(13, 10, 31, 0.6);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        z-index: 10;
    }
    .header h1 {
        flex: 0 0 auto;
        font-size: 13px;
        font-weight: 600;
        margin: 0;
        background: linear-gradient(135deg, var(--tk-purple-2), #fff 70%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        letter-spacing: 0.02em;
    }
    .badge-count {
        flex: 0 0 auto;
        font-size: 11px;
        color: var(--tk-text-dim);
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(123, 77, 255, 0.10);
        border: 1px solid var(--tk-glass-border);
    }
    .header-spacer { flex: 1 1 auto; }
    .header-btn {
        flex: 0 0 auto;
        font-size: 11px;
        color: var(--tk-text);
        background: var(--tk-glass);
        border: 1px solid var(--tk-glass-border);
        border-radius: 6px;
        padding: 4px 10px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        transition: background 120ms ease, border-color 120ms ease;
    }
    .header-btn:hover {
        background: rgba(123, 77, 255, 0.18);
        border-color: rgba(165, 132, 255, 0.42);
    }
    .header-btn svg { width: 12px; height: 12px; }

    .canvas-wrap {
        flex: 1 1 auto;
        position: relative;
        overflow: auto;
    }
    .canvas {
        position: relative;
        width: 100%;
        height: 100%;
        min-width: 100%;
        min-height: 100%;
        background-image:
            linear-gradient(rgba(123, 77, 255, 0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(123, 77, 255, 0.06) 1px, transparent 1px);
        background-size: 20px 20px;
    }
    .empty-state {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--tk-text-dim);
        gap: 10px;
        text-align: center;
        padding: 24px;
        pointer-events: none;
    }
    .empty-state svg { width: 36px; height: 36px; opacity: 0.5; }
    .empty-state .title { font-size: 13px; color: var(--tk-text); }
    .empty-state .sub { font-size: 11px; color: var(--tk-text-dimer); }

    .card {
        position: absolute;
        width: 280px;
        border-radius: 12px;
        background: linear-gradient(135deg, rgba(20, 20, 25, 0.96), rgba(30, 25, 50, 0.96));
        border: 1px solid var(--tk-glass-border);
        box-shadow: var(--tk-shadow);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        overflow: hidden;
        user-select: none;
        cursor: grab;
        transition: box-shadow 120ms ease, transform 120ms ease;
    }
    .card[data-node-type="local"]  { border-color: var(--col-local-border); box-shadow: var(--tk-shadow), 0 0 18px var(--col-local-bg); }
    .card[data-node-type="server"] { border-color: var(--col-server-border); box-shadow: var(--tk-shadow), 0 0 18px var(--col-server-bg); }
    .card[data-node-type="cloud"]  { border-color: var(--col-cloud-border); box-shadow: var(--tk-shadow), 0 0 18px var(--col-cloud-bg); }
    .card.dragging { cursor: grabbing; transform: scale(1.02); z-index: 1000; }

    .card-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--tk-glass-border);
    }
    .card-icon {
        width: 32px; height: 32px;
        flex: 0 0 32px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .card[data-node-type="local"]  .card-icon { background: var(--col-local-bg);  border: 1px solid var(--col-local-border);  color: var(--col-local-primary); }
    .card[data-node-type="server"] .card-icon { background: var(--col-server-bg); border: 1px solid var(--col-server-border); color: var(--col-server-primary); }
    .card[data-node-type="cloud"]  .card-icon { background: var(--col-cloud-bg);  border: 1px solid var(--col-cloud-border);  color: var(--col-cloud-primary); }
    .card-icon svg { width: 16px; height: 16px; }

    .card-title {
        flex: 1 1 auto;
        min-width: 0;
    }
    .card-title .name {
        font-size: 12px;
        font-weight: 600;
        color: var(--tk-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .card-title .ip {
        font-size: 10px;
        color: var(--tk-text-dim);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .status-pill {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 500;
        padding: 2px 8px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        text-transform: capitalize;
        border: 1px solid;
    }
    .status-dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: currentColor;
        box-shadow: 0 0 6px currentColor;
    }
    .status-online  { color: var(--tk-online);  background: rgba(16, 185, 129, 0.12);  border-color: rgba(16, 185, 129, 0.35); }
    .status-offline { color: var(--tk-offline); background: rgba(107, 114, 128, 0.12); border-color: rgba(107, 114, 128, 0.30); }
    .status-busy    { color: var(--tk-busy);    background: rgba(245, 158, 11, 0.12);  border-color: rgba(245, 158, 11, 0.32); }

    .card-body {
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .os-line {
        font-size: 10px;
        color: var(--tk-text-dim);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .meter {
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    .meter-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 10px;
        color: var(--tk-text-dim);
    }
    .meter-label { display: inline-flex; align-items: center; gap: 4px; }
    .meter-label svg { width: 10px; height: 10px; }
    .meter-val { color: var(--tk-text); font-weight: 500; }
    .meter-bar {
        height: 4px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        overflow: hidden;
    }
    .meter-fill {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--tk-purple), var(--tk-purple-2));
        width: 0%;
    }
    .disk-line {
        font-size: 10px;
        color: var(--tk-text-dimer);
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .disk-line svg { width: 10px; height: 10px; }

    .card-footer {
        display: flex;
        gap: 6px;
        padding: 8px 12px 10px;
        border-top: 1px solid var(--tk-glass-border);
    }
    .card-btn {
        flex: 1 1 auto;
        font-size: 10px;
        color: var(--tk-text);
        background: var(--tk-glass);
        border: 1px solid var(--tk-glass-border);
        border-radius: 6px;
        padding: 5px 8px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        transition: background 120ms ease, border-color 120ms ease;
    }
    .card-btn:hover { background: rgba(123, 77, 255, 0.18); border-color: rgba(165, 132, 255, 0.42); }
    .card-btn svg { width: 11px; height: 11px; }
    .card-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .card-btn:disabled:hover { background: var(--tk-glass); border-color: var(--tk-glass-border); }

    .error-toast {
        position: absolute;
        top: 56px;
        left: 14px;
        right: 14px;
        padding: 8px 10px;
        font-size: 11px;
        background: rgba(239, 68, 68, 0.12);
        border: 1px solid rgba(239, 68, 68, 0.35);
        color: #fecaca;
        border-radius: 8px;
        display: none;
        z-index: 20;
    }
    .error-toast.visible { display: block; }
</style>
</head>
<body>
<aside class="sidebar" id="sidebar" aria-label="Computers">
    <div class="sidebar-title">Computers</div>
    <div class="sidebar-list" id="sidebar-list">
        <div class="sb-empty" id="sb-empty">No computers</div>
    </div>
</aside>
<div class="main-wrap">
    <div class="header">
        <h1>Runner</h1>
        <span class="badge-count" id="badge-count">0 computers</span>
        <span class="header-spacer"></span>
        <button class="header-btn" id="btn-refresh" type="button" title="Refresh">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 5.5"/>
                <path d="M13.5 2.5v3h-3"/>
                <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10.5"/>
                <path d="M2.5 13.5v-3h3"/>
            </svg>
            Refresh
        </button>
    </div>
    <div id="error-toast" class="error-toast"></div>
    <div class="canvas-wrap">
        <div id="canvas" class="canvas">
            <div id="empty-state" class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="18" height="12" rx="2"/>
                    <path d="M8 20h8"/>
                    <path d="M12 16v4"/>
                </svg>
                <div class="title">No computers yet</div>
                <div class="sub">Register a runner from a sandbox or the CLI to see it here.</div>
            </div>
        </div>
    </div>
</div>
<script nonce="${nonce}">
(function () {
    'use strict';
    var vscode = acquireVsCodeApi();
    var canvas = document.getElementById('canvas');
    var emptyState = document.getElementById('empty-state');
    var badgeCount = document.getElementById('badge-count');
    var errorToast = document.getElementById('error-toast');
    var sidebarList = document.getElementById('sidebar-list');
    var sbEmpty = document.getElementById('sb-empty');
    document.getElementById('btn-refresh').addEventListener('click', function () {
        vscode.postMessage({ type: 'refresh' });
    });

    // ── positions persisted per machine_id ────────────────────────
    var POS_KEY = 'tachikoma.runner.positions.v1';
    function loadPositions() {
        try {
            var raw = localStorage.getItem(POS_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }
    function savePositions(p) {
        try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (e) { /* ignore quota */ }
    }
    var positions = loadPositions();

    // ── helpers ───────────────────────────────────────────────────
    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function classifyType(comp) {
        var nt = String(comp.node_type || 'local').toLowerCase();
        if (nt === 'cloud' || nt === 'server' || nt === 'local') return nt;
        return 'server';
    }
    function statusOf(comp) {
        var s = String(comp.state || 'offline').toLowerCase();
        if (s === 'online' || s === 'busy') return s;
        return 'offline';
    }
    function tailscaleIp(comp) {
        var ips = Array.isArray(comp.ip_addresses) ? comp.ip_addresses : [];
        // Prefer Tailscale CGNAT range 100.64.0.0/10 (100.64.0.0–100.127.255.255)
        for (var i = 0; i < ips.length; i++) {
            var ip = String(ips[i] || '');
            var parts = ip.split('.');
            if (parts.length === 4) {
                var a = parseInt(parts[0], 10);
                var b = parseInt(parts[1], 10);
                if (a === 100 && b >= 64 && b <= 127) { return ip; }
            }
        }
        return ips[0] || comp.hostname || '';
    }
    function pickIcon(type) {
        switch (type) {
            case 'local':
                return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="8" rx="1"/><path d="M5 14h6"/><path d="M8 11v3"/></svg>';
            case 'server':
                return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="5" rx="1"/><rect x="2" y="9" width="12" height="5" rx="1"/><circle cx="5" cy="4.5" r=".5" fill="currentColor"/><circle cx="5" cy="11.5" r=".5" fill="currentColor"/></svg>';
            case 'cloud':
                return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5h7.5a2.5 2.5 0 0 0 .3-4.98A4 4 0 0 0 4.05 8 2.75 2.75 0 0 0 4 12.5Z"/></svg>';
            default:
                return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/></svg>';
        }
    }
    var ICON_CPU  = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="8" height="8" rx="1"/><path d="M6 7h4v2H6z"/><path d="M2 6h2M2 10h2M12 6h2M12 10h2M6 2v2M10 2v2M6 12v2M10 12v2"/></svg>';
    var ICON_RAM  = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="5" width="13" height="6" rx="1"/><path d="M4 7v2M6 7v2M8 7v2M10 7v2M12 7v2"/></svg>';
    var ICON_DISK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1.5"/></svg>';
    var ICON_TERM = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="m5 7 2 1.5L5 10"/><path d="M8.5 10h2.5"/></svg>';
    var ICON_LINK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9a3 3 0 0 0 4.24 0l2.12-2.12a3 3 0 0 0-4.24-4.24L7.7 4"/><path d="M9 7a3 3 0 0 0-4.24 0L2.64 9.12a3 3 0 0 0 4.24 4.24L8.3 12"/></svg>';

    // Live metric placeholder. The backend doesn't yet stream cpu/ram/disk
    // per heartbeat — once it does, fold those fields into the ComputerResponse
    // payload and read them here. Until then we surface "—" so users know
    // the row exists but is unfilled rather than fabricated.
    function readMetric(comp, key) {
        if (comp && comp[key] != null) {
            var v = Number(comp[key]);
            if (!isNaN(v)) return v;
        }
        return null;
    }

    function buildCard(comp) {
        var type = classifyType(comp);
        var status = statusOf(comp);
        var ip = tailscaleIp(comp);
        var name = comp.name || comp.hostname || comp.machine_id;
        var os = (comp.os_type || 'unknown') + (comp.os_version ? (' ' + comp.os_version) : '');
        var arch = comp.arch || '';
        var cpu = readMetric(comp, 'cpu');
        var ram = readMetric(comp, 'memory');
        var disk = readMetric(comp, 'disk');

        var card = document.createElement('div');
        card.className = 'card';
        card.dataset.machineId = comp.machine_id;
        card.dataset.nodeType = type;

        var html = ''
            + '<div class="card-header">'
            +     '<div class="card-icon">' + pickIcon(type) + '</div>'
            +     '<div class="card-title">'
            +         '<div class="name">' + escHtml(name) + '</div>'
            +         '<div class="ip">' + escHtml(ip) + '</div>'
            +     '</div>'
            +     '<span class="status-pill status-' + status + '">'
            +         '<span class="status-dot"></span>'
            +         escHtml(status)
            +     '</span>'
            + '</div>'
            + '<div class="card-body">'
            +     '<div class="os-line">' + escHtml(os) + (arch ? (' &middot; ' + escHtml(arch)) : '') + '</div>'
            +     '<div class="meter">'
            +         '<div class="meter-row">'
            +             '<span class="meter-label">' + ICON_CPU + ' CPU</span>'
            +             '<span class="meter-val">' + (cpu == null ? '&mdash;' : (Math.round(cpu) + '%')) + '</span>'
            +         '</div>'
            +         '<div class="meter-bar"><div class="meter-fill" style="width:' + (cpu == null ? 0 : Math.max(0, Math.min(100, cpu))) + '%"></div></div>'
            +     '</div>'
            +     '<div class="meter">'
            +         '<div class="meter-row">'
            +             '<span class="meter-label">' + ICON_RAM + ' RAM</span>'
            +             '<span class="meter-val">' + (ram == null ? '&mdash;' : (Math.round(ram) + '%')) + '</span>'
            +         '</div>'
            +         '<div class="meter-bar"><div class="meter-fill" style="width:' + (ram == null ? 0 : Math.max(0, Math.min(100, ram))) + '%"></div></div>'
            +     '</div>'
            +     (disk == null
                    ? '<div class="disk-line">' + ICON_DISK + ' Disk &mdash;</div>'
                    : '<div class="disk-line">' + ICON_DISK + ' Disk ' + Math.round(disk) + '%</div>')
            + '</div>'
            + '<div class="card-footer">'
            +     '<button class="card-btn" data-action="openTerminal"' + (status === 'online' ? '' : ' disabled') + '>'
            +         ICON_TERM + ' Terminal'
            +     '</button>'
            +     '<button class="card-btn" data-action="attach">'
            +         ICON_LINK + ' Attach'
            +     '</button>'
            + '</div>';
        card.innerHTML = html;

        card.querySelectorAll('button[data-action]').forEach(function (btn) {
            btn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                if (btn.disabled) return;
                var action = btn.getAttribute('data-action');
                vscode.postMessage({ type: action, machineId: comp.machine_id });
            });
        });

        // ── drag ──────────────────────────────────────────────────
        var startX = 0, startY = 0;
        var origX = 0, origY = 0;
        var dragging = false;
        card.addEventListener('mousedown', function (e) {
            if (e.target.closest('button')) return;
            dragging = true;
            card.classList.add('dragging');
            startX = e.clientX;
            startY = e.clientY;
            origX = parseInt(card.style.left || '0', 10);
            origY = parseInt(card.style.top || '0', 10);
            e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            var nx = origX + (e.clientX - startX);
            var ny = origY + (e.clientY - startY);
            if (nx < 0) nx = 0;
            if (ny < 0) ny = 0;
            card.style.left = nx + 'px';
            card.style.top = ny + 'px';
        });
        document.addEventListener('mouseup', function () {
            if (!dragging) return;
            dragging = false;
            card.classList.remove('dragging');
            var nx = parseInt(card.style.left || '0', 10);
            var ny = parseInt(card.style.top || '0', 10);
            positions[comp.machine_id] = { x: nx, y: ny };
            savePositions(positions);
            vscode.postMessage({ type: 'dragEnd', machineId: comp.machine_id, x: nx, y: ny });
        });

        return card;
    }

    function autoLayout(index) {
        var col = index % 3;
        var row = Math.floor(index / 3);
        return { x: 24 + col * 300, y: 24 + row * 240 };
    }

    function buildSidebarEntry(comp) {
        var type = classifyType(comp);
        var status = statusOf(comp);
        var ip = tailscaleIp(comp);
        var name = comp.name || comp.hostname || comp.machine_id;

        var entry = document.createElement('div');
        entry.className = 'sb-entry';
        entry.dataset.machineId = comp.machine_id;
        entry.dataset.nodeType = type;
        entry.dataset.status = status;
        entry.title = name + ' (' + ip + ') - ' + status;

        entry.innerHTML = ''
            + '<div class="sb-icon">'
            +     pickIcon(type)
            +     '<span class="sb-dot"></span>'
            + '</div>'
            + '<div class="sb-meta">'
            +     '<span class="sb-name">' + escHtml(name) + '</span>'
            +     '<span class="sb-ip">' + escHtml(ip) + '</span>'
            + '</div>'
            + '<span class="sb-pill status-' + status + '">' + escHtml(status) + '</span>';

        entry.addEventListener('click', function () {
            var card = canvas.querySelector('.card[data-machine-id="' + comp.machine_id + '"]');
            if (card && typeof card.scrollIntoView === 'function') {
                card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }
        });

        return entry;
    }

    function renderSidebar(computers) {
        var oldEntries = sidebarList.querySelectorAll('.sb-entry');
        for (var i = 0; i < oldEntries.length; i++) {
            oldEntries[i].parentNode.removeChild(oldEntries[i]);
        }
        if (!computers || computers.length === 0) {
            sbEmpty.style.display = '';
            return;
        }
        sbEmpty.style.display = 'none';
        computers.forEach(function (comp) {
            sidebarList.appendChild(buildSidebarEntry(comp));
        });
    }

    function render(computers) {
        // Remove only the cards; keep the empty-state node intact.
        var oldCards = canvas.querySelectorAll('.card');
        for (var i = 0; i < oldCards.length; i++) {
            oldCards[i].parentNode.removeChild(oldCards[i]);
        }
        renderSidebar(computers);
        if (!computers || computers.length === 0) {
            emptyState.style.display = '';
            return;
        }
        emptyState.style.display = 'none';

        computers.forEach(function (comp, i) {
            var card = buildCard(comp);
            var pos = positions[comp.machine_id] || autoLayout(i);
            card.style.left = pos.x + 'px';
            card.style.top = pos.y + 'px';
            canvas.appendChild(card);
        });
    }

    function updateBadge(total, online) {
        var noun = total === 1 ? 'computer' : 'computers';
        badgeCount.textContent = total + ' ' + noun + (total > 0 ? (', ' + online + ' online') : '');
    }

    function showError(message) {
        errorToast.textContent = 'Runner: ' + message;
        errorToast.classList.add('visible');
        setTimeout(function () { errorToast.classList.remove('visible'); }, 6000);
    }

    window.addEventListener('message', function (event) {
        var msg = event.data;
        if (!msg || typeof msg !== 'object') return;
        switch (msg.type) {
            case 'computers':
                render(msg.payload || []);
                break;
            case 'summary':
                updateBadge(msg.payload.total || 0, msg.payload.online || 0);
                break;
            case 'error':
                showError(msg.message || 'unknown error');
                break;
        }
    });

    vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
    }
}

// ── protocol types ───────────────────────────────────────────────────

type OutgoingMessage =
    | { type: 'computers'; payload: ComputerResponse[] }
    | { type: 'summary'; payload: { total: number; online: number } }
    | { type: 'error'; message: string };

type IncomingMessage =
    | { type: 'ready' }
    | { type: 'refresh' }
    | { type: 'openTerminal'; machineId: string }
    | { type: 'attach'; machineId: string }
    | { type: 'dragEnd'; machineId: string; x: number; y: number };

// Avoid an unused-symbol warning when only the type signature is needed.
// `TachikomaClient` is imported for the side-effect of typing the
// AuthManager.getClient() return; explicitly export it so consumers
// (extension.ts) can keep referencing it without dragging in the value.
export type { TachikomaClient };

function makeNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
}
