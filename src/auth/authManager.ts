import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { TachikomaClient } from '../api/tachikomaClient';
import { log, logError, showAndLog, getOutputChannel } from '../log';

export interface McpSession {
    host: string;
    token: string;
    userId: string;
    sseUrl: string;
    activeContexts: string[];
    updatedAt: string;
}

export class AuthManager implements vscode.Disposable {
    private client: TachikomaClient | null = null;
    private statusBarItem: vscode.StatusBarItem;
    private refreshTimer: ReturnType<typeof setInterval> | null = null;
    private userId: string | null = null;
    private hostUrl: string | null = null;
    private activeContextsProvider: (() => string[]) | null = null;
    private extContext: vscode.ExtensionContext | null = null;

    private readonly _onDidConnect = new vscode.EventEmitter<TachikomaClient>();
    readonly onDidConnect = this._onDidConnect.event;

    private readonly _onDidDisconnect = new vscode.EventEmitter<void>();
    readonly onDidDisconnect = this._onDidDisconnect.event;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'tachikoma.connect';
        this.updateStatusBar();
        this.statusBarItem.show();
    }

    isConnected(): boolean {
        return this.client !== null && this.client.getToken() !== null;
    }

    getClient(): TachikomaClient | null {
        return this.client;
    }

    getUserId(): string | null {
        return this.userId;
    }

    getHostUrl(): string | null {
        return this.hostUrl;
    }

    /** Late-binding hook so authManager can read the current active contexts
     * from the context store without taking a hard dependency on it. */
    setActiveContextsProvider(provider: () => string[]): void {
        this.activeContextsProvider = provider;
    }

    private currentActiveContexts(): string[] {
        try {
            return this.activeContextsProvider?.() ?? [];
        } catch {
            return [];
        }
    }

    async connect(context: vscode.ExtensionContext): Promise<TachikomaClient | null> {
        this.extContext = context;
        const channel = getOutputChannel();
        channel.show(true);

        showAndLog('─── Connection started ───');

        // Step 1: Get host
        const config = vscode.workspace.getConfiguration('tachikoma');
        let host = config.get<string>('host') || '';

        if (host) {
            log(`Host from settings: ${host}`);
        } else {
            host = await vscode.window.showInputBox({
                prompt: 'Tachikoma computer address (Tailscale hostname or IP)',
                placeHolder: 'http://dev-005:8000',
                value: 'http://dev-005:8000',
                ignoreFocusOut: true,
            }) ?? '';
        }
        if (!host) {
            log('Connection cancelled — no host provided');
            return null;
        }

        // Normalize URL
        if (!host.startsWith('http://') && !host.startsWith('https://')) {
            host = `http://${host}`;
        }
        if (!host.match(/:\d+$/)) {
            host = `${host}:8000`;
        }
        log(`Target: ${host}`);

        // Step 2: Ping server
        const client = new TachikomaClient(host);
        log('Testing connectivity...');
        this.updateStatusBar('connecting', host);

        const ping = await client.ping();
        if (!ping.ok) {
            showAndLog(`Cannot reach ${host} → ${ping.detail}`);
            vscode.window.showErrorMessage(
                `Cannot reach ${host}: ${ping.detail}. Check the address and make sure the tachikoma server is running.`,
                'Open Output',
            ).then((choice) => { if (choice) channel.show(); });
            this.updateStatusBar();
            return null;
        }
        log(`Server reachable (${ping.detail})`);

        // Step 3: Get credentials
        const username = await vscode.window.showInputBox({
            prompt: `Username for ${host}`,
            placeHolder: 'ubuntu',
            ignoreFocusOut: true,
        }) ?? '';
        if (!username) {
            log('Connection cancelled — no username');
            this.updateStatusBar();
            return null;
        }

        const password = await vscode.window.showInputBox({
            prompt: `Password for ${username}@${host}`,
            password: true,
            ignoreFocusOut: true,
        }) ?? '';
        if (!password) {
            log('Connection cancelled — no password');
            this.updateStatusBar();
            return null;
        }

        // Step 4: Authenticate
        log(`Logging in as "${username}"...`);
        try {
            const resp = await client.login(username, password);
            this.client = client;
            this.userId = resp.user_id;
            this.hostUrl = host;

            await context.secrets.store('tachikoma.token', resp.token);
            await context.secrets.store('tachikoma.host', host);
            await context.secrets.store('tachikoma.username', username);

            this.startTokenRefresh();
            this.updateStatusBar();
            this.writeMcpSession();
            this._onDidConnect.fire(client);

            showAndLog(`Connected to ${host} as ${resp.user_id} [${resp.roles.join(', ')}]`);
            vscode.window.showInformationMessage(`Tachikoma: Connected as ${resp.user_id} on ${host}`);
            return client;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showAndLog(`Login failed: ${msg}`);
            vscode.window.showErrorMessage(
                `Tachikoma login failed: ${msg}`,
                'Open Output',
            ).then((choice) => { if (choice) channel.show(); });
            this.updateStatusBar();
            return null;
        }
    }

    async tryReconnect(context: vscode.ExtensionContext): Promise<TachikomaClient | null> {
        this.extContext = context;
        const host = await context.secrets.get('tachikoma.host');
        const token = await context.secrets.get('tachikoma.token');
        if (!host || !token) {
            log('No saved session to reconnect');
            return null;
        }

        log(`Reconnecting to ${host}...`);
        const client = new TachikomaClient(host);
        client.setToken(token);
        try {
            const refreshed = await client.refreshToken();
            this.client = client;
            this.userId = refreshed.user_id;
            this.hostUrl = host;
            await context.secrets.store('tachikoma.token', refreshed.token);
            this.startTokenRefresh();
            this.updateStatusBar();
            this.writeMcpSession();
            this._onDidConnect.fire(client);
            log(`Reconnected as ${refreshed.user_id}`);
            return client;
        } catch (err) {
            logError('Reconnect failed — saved token expired', err);
            return null;
        }
    }

    async disconnect(context: vscode.ExtensionContext): Promise<void> {
        log('Disconnecting...');
        if (this.client) {
            try { await this.client.logout(); } catch { /* ignore */ }
        }
        this.client = null;
        this.userId = null;
        this.hostUrl = null;
        this.stopTokenRefresh();
        await context.secrets.delete('tachikoma.token');
        this.updateStatusBar();
        this.writeMcpSession();
        this._onDidDisconnect.fire();
        log('Disconnected');
    }

    private startTokenRefresh(): void {
        this.stopTokenRefresh();
        this.refreshTimer = setInterval(async () => {
            if (!this.client) return;
            try {
                const refreshed = await this.client.refreshToken();
                // Persist rotated token to secrets so it survives VS Code reloads
                if (this.extContext && refreshed?.token) {
                    await this.extContext.secrets.store('tachikoma.token', refreshed.token);
                }
                // Persist the rotated token to ~/.tachikoma/mcp-session.json
                // so the MCP bridge picks it up — otherwise the bridge would
                // keep retrying with an expired token until the next manual
                // reconnect.
                this.writeMcpSession();
            } catch (err) {
                logError('Token refresh failed', err);
                this.updateStatusBar();
            }
        }, 10 * 60 * 1000);
    }

    private stopTokenRefresh(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    private syncStateLabel: string = '';

    setSyncState(state: 'disconnected' | 'hydrating' | 'syncing' | 'synced' | 'stale'): void {
        const labels: Record<string, string> = {
            disconnected: '',
            hydrating: '$(loading~spin) hydrating',
            syncing: '$(sync~spin) syncing',
            synced: '$(check) synced',
            stale: '$(warning) stale',
        };
        this.syncStateLabel = labels[state] ?? '';
        this.updateStatusBar();
    }

    private updateStatusBar(state?: string, host?: string): void {
        if (state === 'connecting') {
            this.statusBarItem.text = '$(loading~spin) Tachikoma: Connecting...';
            this.statusBarItem.tooltip = `Connecting to ${host}`;
            return;
        }
        if (this.isConnected()) {
            const sync = this.syncStateLabel ? ` · ${this.syncStateLabel}` : '';
            const mcpFresh = this.isMcpSessionFresh();
            const mcp = mcpFresh ? ' · $(zap)' : '';
            this.statusBarItem.text = `$(plug) Tachikoma: ${this.userId}${mcp}${sync}`;
            const contexts = this.currentActiveContexts();
            const mcpLine = mcpFresh
                ? `\nMCP session: live (${contexts.length} active context${contexts.length === 1 ? '' : 's'})`
                : '';
            this.statusBarItem.tooltip =
                `Connected to ${this.hostUrl} as ${this.userId}${mcpLine}\nClick to reconnect`;
            this.statusBarItem.backgroundColor = undefined;
        } else {
            this.statusBarItem.text = '$(debug-disconnect) Tachikoma: Disconnected';
            this.statusBarItem.tooltip = 'Click to connect to a Tachikoma computer';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
    }

    /** Build the full MCP session — the same shape the bridge consumes. Used
     * both by the ``tachikoma.getMcpSession`` command (for the MCP extension
     * to read) and by writeMcpSession below. */
    getMcpSession(): McpSession | null {
        if (!this.isConnected() || !this.hostUrl || !this.client) return null;
        const token = this.client.getToken();
        if (!token) return null;
        return {
            host: this.hostUrl,
            token,
            userId: this.userId ?? '',
            sseUrl: `${this.hostUrl}/api/mcp/sse`,
            activeContexts: this.currentActiveContexts(),
            updatedAt: new Date().toISOString(),
        };
    }

    writeMcpSession(activeContexts?: string[]): void {
        const session = this.getMcpSession();
        const dir = path.join(os.homedir(), '.tachikoma');
        const file = path.join(dir, 'mcp-session.json');
        try {
            fs.mkdirSync(dir, { recursive: true });
            if (session) {
                // activeContexts override: callers can pass an explicit list
                // (used by store.onDidChange in the extension wiring).
                const final: McpSession = activeContexts !== undefined
                    ? { ...session, activeContexts }
                    : session;
                const tmp = `${file}.tmp`;
                fs.writeFileSync(tmp, JSON.stringify(final, null, 2), { mode: 0o600 });
                fs.renameSync(tmp, file);
                log(`MCP session written to ${file} (token=${final.token.slice(0, 8)}…, contexts=${final.activeContexts.length})`);
            } else {
                if (fs.existsSync(file)) fs.unlinkSync(file);
            }
            this.updateStatusBar();
        } catch (err) {
            logError('Failed to write MCP session file', err);
        }
    }

    /** Returns true if a session file exists and was refreshed in the last
     * 15 minutes (well under the 24h token TTL). Used to gate the `$(zap)`
     * MCP indicator on the status bar. */
    private isMcpSessionFresh(): boolean {
        const file = path.join(os.homedir(), '.tachikoma', 'mcp-session.json');
        try {
            const stat = fs.statSync(file);
            return Date.now() - stat.mtimeMs < 15 * 60 * 1000;
        } catch {
            return false;
        }
    }

    dispose(): void {
        this.stopTokenRefresh();
        this.statusBarItem.dispose();
        this._onDidConnect.dispose();
        this._onDidDisconnect.dispose();
    }
}
