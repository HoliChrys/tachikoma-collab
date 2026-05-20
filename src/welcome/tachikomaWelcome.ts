import * as vscode from 'vscode';
import { AuthManager } from '../auth/authManager';
import { log, logError } from '../log';
import { buildWelcomeHtml } from './welcomeContent.html';

/**
 * TachikomaWelcomeProvider — full webview-panel replacement for the
 * VS Code gettingStarted page.
 *
 * Patch 0005 only injects startEntries into the existing Welcome page,
 * which means the VS Code branding/layout still shows. This provider
 * renders a completely independent webview with the Tachikoma dashboard
 * styling (purple body, glass, grid+paper, firefly border).
 *
 * Activation:
 *   - Registered via the command `tachikoma.welcome.open`.
 *   - `registerTachikomaWelcome` (see ./index.ts) opens it once per
 *     install via `workspaceState['tachikoma.welcome.shown']`.
 *
 * Webview protocol:
 *   ext  -> view : { type: 'state', connected, user, host, contexts, buildSha }
 *   view -> ext  : { type: 'ready' }
 *                  { type: 'connect' }
 *                  { type: 'switchContext', path }
 *                  { type: 'openCommand', command, args? }
 *                  { type: 'dismiss' }
 */

interface WelcomeStateMessage {
    type: 'state';
    connected: boolean;
    user: string | null;
    host: string | null;
    contexts: string[];
    buildSha: string;
}

type IncomingMessage =
    | { type: 'ready' }
    | { type: 'connect' }
    | { type: 'switchContext'; path: string }
    | { type: 'openCommand'; command: string; args?: unknown }
    | { type: 'dismiss' };

export class TachikomaWelcomeProvider implements vscode.Disposable {
    public static readonly viewType = 'tachikomaWelcome';

    private panel: vscode.WebviewPanel | null = null;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly authManager: AuthManager,
        private readonly contextsProvider: () => string[],
    ) {
        // Refresh the webview when the connection state changes so the
        // status block flips between "Not connected" and "Connected as ...".
        this.disposables.push(
            this.authManager.onDidConnect(() => this.postState()),
            this.authManager.onDidDisconnect(() => this.postState()),
        );
    }

    /**
     * Reveal the welcome panel, creating it if needed.
     * Idempotent — calling it a second time just re-focuses the existing
     * webview instead of spawning a duplicate.
     */
    open(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Active, false);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            TachikomaWelcomeProvider.viewType,
            'Welcome to Tachikoma',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this.context.extensionUri],
            },
        );

        try {
            panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon-128.png');
        } catch {
            /* icon optional - silently skip if media path is missing */
        }

        panel.webview.html = buildWelcomeHtml({
            nonce: this.makeNonce(),
            cspSource: panel.webview.cspSource,
        });

        panel.webview.onDidReceiveMessage(
            (msg: IncomingMessage) => { void this.onMessage(msg); },
            undefined,
            this.disposables,
        );

        panel.onDidDispose(
            () => { this.panel = null; },
            null,
            this.disposables,
        );

        this.panel = panel;
        log('Welcome: panel created');
    }

    /**
     * Dispatch an inbound message from the webview. Errors are logged
     * and swallowed so a bad payload cannot crash the extension host.
     */
    private async onMessage(msg: IncomingMessage): Promise<void> {
        if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
        try {
            switch (msg.type) {
                case 'ready':
                    this.postState();
                    return;
                case 'connect':
                    await vscode.commands.executeCommand('tachikoma.connectWithToken');
                    return;
                case 'switchContext':
                    await this.handleSwitchContext(msg.path);
                    return;
                case 'openCommand':
                    await this.handleOpenCommand(msg.command, msg.args);
                    return;
                case 'dismiss':
                    if (this.panel) this.panel.dispose();
                    return;
                default:
                    log(`Welcome: ignored unknown message type ${(msg as { type?: string }).type ?? ''}`);
            }
        } catch (err) {
            logError(`Welcome: message ${msg.type} failed`, err);
        }
    }

    private async handleSwitchContext(path: string): Promise<void> {
        if (typeof path !== 'string' || path.length === 0) return;
        // Reveal the context tree so the user sees the change land,
        // then ask the same command the tree's row would invoke.
        await vscode.commands.executeCommand('tachikomaContextTree.focus');
        const candidates = [
            'tachikoma.openInWorkspace',
            'tachikoma.switchContext',
        ];
        for (const cmd of candidates) {
            try {
                await vscode.commands.executeCommand(cmd, path);
                return;
            } catch {
                /* try next candidate */
            }
        }
        log(`Welcome: no command available to switch to context ${path}`);
    }

    private async handleOpenCommand(command: string, args: unknown): Promise<void> {
        if (typeof command !== 'string' || command.length === 0) return;
        if (args === undefined) {
            await vscode.commands.executeCommand(command);
            return;
        }
        if (Array.isArray(args)) {
            await vscode.commands.executeCommand(command, ...args);
            return;
        }
        await vscode.commands.executeCommand(command, args);
    }

    /** Push the current connection + context snapshot to the webview. */
    private postState(): void {
        if (!this.panel) return;
        const payload: WelcomeStateMessage = {
            type: 'state',
            connected: this.authManager.isConnected(),
            user: this.authManager.getUserId(),
            host: this.shortHost(this.authManager.getHostUrl()),
            contexts: this.safeContexts(),
            buildSha: this.detectBuildSha(),
        };
        void this.panel.webview.postMessage(payload);
    }

    private safeContexts(): string[] {
        try {
            const all = this.contextsProvider() ?? [];
            // Keep it short — only the 6 most recent for the recent contexts list.
            return all.slice(0, 6);
        } catch (err) {
            logError('Welcome: contextsProvider threw', err);
            return [];
        }
    }

    private shortHost(host: string | null): string | null {
        if (!host) return null;
        try {
            const url = new URL(host);
            return url.hostname;
        } catch {
            return host;
        }
    }

    private detectBuildSha(): string {
        const pkg = this.context.extension?.packageJSON as { version?: string } | undefined;
        const version = typeof pkg?.version === 'string' ? pkg.version : 'dev';
        return version;
    }

    private makeNonce(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let out = '';
        for (let i = 0; i < 32; i++) {
            out += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return out;
    }

    dispose(): void {
        for (const d of this.disposables) {
            try { d.dispose(); } catch { /* ignore */ }
        }
        this.disposables.length = 0;
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }
}
