import * as vscode from 'vscode';
import { TachikomaClient } from '../api/tachikomaClient';

export class AuthManager implements vscode.Disposable {
    private client: TachikomaClient | null = null;
    private statusBarItem: vscode.StatusBarItem;
    private refreshTimer: ReturnType<typeof setInterval> | null = null;
    private userId: string | null = null;

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

    async connect(context: vscode.ExtensionContext): Promise<TachikomaClient | null> {
        const config = vscode.workspace.getConfiguration('tachikoma');
        let host = config.get<string>('host') || '';

        if (!host) {
            host = await vscode.window.showInputBox({
                prompt: 'Tachikoma computer address',
                placeHolder: 'http://localhost:8000',
                value: 'http://localhost:8000',
            }) ?? '';
        }
        if (!host) return null;

        const username = await vscode.window.showInputBox({ prompt: 'Username' }) ?? '';
        if (!username) return null;

        const password = await vscode.window.showInputBox({ prompt: 'Password', password: true }) ?? '';
        if (!password) return null;

        const client = new TachikomaClient(host);
        try {
            const resp = await client.login(username, password);
            this.client = client;
            this.userId = resp.user_id;

            await context.secrets.store('tachikoma.token', resp.token);
            await context.secrets.store('tachikoma.host', host);

            this.startTokenRefresh();
            this.updateStatusBar();
            this._onDidConnect.fire(client);

            vscode.window.showInformationMessage(`Connected to ${host} as ${resp.user_id}`);
            return client;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Connection failed: ${msg}`);
            return null;
        }
    }

    async tryReconnect(context: vscode.ExtensionContext): Promise<TachikomaClient | null> {
        const host = await context.secrets.get('tachikoma.host');
        const token = await context.secrets.get('tachikoma.token');
        if (!host || !token) return null;

        const client = new TachikomaClient(host);
        client.setToken(token);
        try {
            const refreshed = await client.refreshToken();
            this.client = client;
            this.userId = refreshed.user_id;
            await context.secrets.store('tachikoma.token', refreshed.token);
            this.startTokenRefresh();
            this.updateStatusBar();
            this._onDidConnect.fire(client);
            return client;
        } catch {
            return null;
        }
    }

    async disconnect(context: vscode.ExtensionContext): Promise<void> {
        if (this.client) {
            try { await this.client.logout(); } catch { /* ignore */ }
        }
        this.client = null;
        this.userId = null;
        this.stopTokenRefresh();
        await context.secrets.delete('tachikoma.token');
        this.updateStatusBar();
        this._onDidDisconnect.fire();
    }

    private startTokenRefresh(): void {
        this.stopTokenRefresh();
        // Refresh every 10 minutes
        this.refreshTimer = setInterval(async () => {
            if (!this.client) return;
            try {
                await this.client.refreshToken();
            } catch {
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

    private updateStatusBar(): void {
        if (this.isConnected()) {
            this.statusBarItem.text = `$(plug) Tachikoma: ${this.userId}`;
            this.statusBarItem.tooltip = 'Connected — click to reconnect';
        } else {
            this.statusBarItem.text = '$(debug-disconnect) Tachikoma: Disconnected';
            this.statusBarItem.tooltip = 'Click to connect';
        }
    }

    dispose(): void {
        this.stopTokenRefresh();
        this.statusBarItem.dispose();
        this._onDidConnect.dispose();
        this._onDidDisconnect.dispose();
    }
}
