import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import { log } from '../log';
import { openTerminalPanel } from '../terminal/terminalPanel';

function wsBaseFromUrl(hostUrl: string): string {
    try {
        const u = new URL(hostUrl);
        const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${u.host}`;
    } catch {
        return hostUrl.replace(/^http/, 'ws');
    }
}

export function attachTmuxSession(opts: {
    extensionUri: vscode.Uri;
    hostUrl: string;
    token: string;
    sessionId: string;
    sessionName: string;
}): vscode.WebviewPanel {
    const wsBase = wsBaseFromUrl(opts.hostUrl);
    const wsUrl = `${wsBase}/api/sessions/pty/${opts.sessionId}`;
    log(`Attach tmux: ${opts.sessionName} → ${wsUrl}`);
    return openTerminalPanel({
        extensionUri: opts.extensionUri,
        title: `tmux · ${opts.sessionName}`,
        wsUrl,
        token: opts.token,
    });
}

/**
 * Zellij sessions → POST /command/login for auth, then load session_url.
 *
 * Uses the HTTPS subdomain (session.{ctx_id}.tachikoma.sh) served by
 * Traefik. Assets at /assets/* work natively since it's the domain root.
 * Auth is done via POST /command/login which sets a cookie, then the
 * page loads with is_authenticated=true.
 */
export async function attachZellijSession(opts: {
    client: TachikomaClient;
    extensionUri: vscode.Uri;
    sessionName: string;
}): Promise<vscode.WebviewPanel> {
    log(`Attach zellij: ${opts.sessionName}`);

    const webData = await opts.client.getSessionWeb(opts.sessionName);
    const ctxId = webData.ctx_id;
    const zwToken = webData.token;
    const url = `https://session.zweb.${ctxId}.tachikoma.sh/?auth_token=${encodeURIComponent(zwToken)}`;

    log(`Zellij open: ${opts.sessionName} → ${url}`);

    // Use VS Code's built-in Simple Browser to display the page in a tab
    await vscode.commands.executeCommand('simpleBrowser.show', vscode.Uri.parse(url));

    return undefined as unknown as vscode.WebviewPanel;
}
