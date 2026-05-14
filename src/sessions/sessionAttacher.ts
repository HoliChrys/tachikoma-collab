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
    const sessionUrl = webData.session_url ?? webData.iframe_url;
    const zwToken = webData.token;
    const baseUrl = sessionUrl.split('?')[0];

    const panel = vscode.window.createWebviewPanel(
        'tachikomaZellij',
        `zellij · ${opts.sessionName}`,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
    );

    // Submit a hidden form POST to /command/login INSIDE the iframe.
    // This sets the cookie in the iframe's browsing context (not the WebView's).
    // The server responds with a redirect to / where is_authenticated=true.
    panel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https://*.tachikoma.sh http://*; form-action https://*.tachikoma.sh http://*; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
        iframe { width: 100%; height: 100%; border: none; }
    </style>
</head>
<body>
    <iframe id="zframe" name="zframe" allow="clipboard-read; clipboard-write"></iframe>
    <form id="loginForm" method="POST" action="${baseUrl}/command/login" target="zframe" style="display:none">
        <input type="hidden" name="auth_token" value="${zwToken}">
        <input type="hidden" name="remember_me" value="true">
    </form>
    <script>document.getElementById('loginForm').submit();</script>
</body>
</html>`;

    log(`Zellij panel: ${opts.sessionName} → ${baseUrl}`);
    panel.onDidDispose(() => log(`Zellij panel closed: ${opts.sessionName}`));
    return panel;
}
