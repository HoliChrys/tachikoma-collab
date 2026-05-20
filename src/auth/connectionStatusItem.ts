import * as vscode from 'vscode';
import type { AuthManager } from './authManager';

/**
 * A second, dedicated status bar item that surfaces the "connected to
 * Tachikoma" feeling in a glanceable way.
 *
 * The existing AuthManager status bar item shows the user id, sync state,
 * and MCP freshness. It is information dense and uses the warning
 * background when disconnected.
 *
 * This item complements it: a small dot + label on the left of the bar,
 * green when connected and muted when not, with a one click toggle to
 * connect with a token or disconnect.
 */
export class ConnectionStatusItem implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly authManager: AuthManager) {
        // Priority 99: sits immediately to the right of the AuthManager
        // item (priority 100, left aligned) so the two read as a pair.
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            99,
        );
        this.item.name = 'Tachikoma Connection';
        this.disposables.push(this.item);

        this.disposables.push(
            authManager.onDidConnect(() => this.render()),
            authManager.onDidDisconnect(() => this.render()),
        );

        this.render();
        this.item.show();
    }

    private render(): void {
        const connected = this.authManager.isConnected();
        if (connected) {
            const userId = this.authManager.getUserId() ?? 'tachikoma';
            const hostUrl = this.authManager.getHostUrl() ?? '';
            this.item.text = '$(circle-filled) Tachikoma: connected';
            this.item.color = new vscode.ThemeColor('charts.green');
            this.item.tooltip = new vscode.MarkdownString(
                `**Connected** as \`${userId}\`` +
                (hostUrl ? ` on \`${hostUrl}\`` : '') +
                '\n\nClick to disconnect.',
            );
            this.item.command = 'tachikoma.disconnect';
            this.item.backgroundColor = undefined;
        } else {
            this.item.text = '$(circle-outline) Tachikoma: disconnected';
            this.item.color = new vscode.ThemeColor(
                'descriptionForeground',
            );
            this.item.tooltip = new vscode.MarkdownString(
                '**Disconnected** from Tachikoma.\n\n' +
                'Click to connect with an API token.',
            );
            this.item.command = 'tachikoma.connectWithToken';
            this.item.backgroundColor = undefined;
        }
    }

    dispose(): void {
        for (const d of this.disposables) {
            try {
                d.dispose();
            } catch {
                // ignore
            }
        }
    }
}
