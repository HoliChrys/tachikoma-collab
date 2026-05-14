import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import { log, logError } from '../log';
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

/**
 * Tmux sessions → xterm.js + WebSocket PTY proxy.
 */
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
 * Zellij sessions → pre-auth via POST /command/login then iframe to zweb.
 *
 * Flow (same as dashboard ZellijTerminalView):
 * 1. GET /api/sessions/{name}/web → get session_url + token
 * 2. POST {session_url}/command/login with auth_token → sets cookie
 * 3. Load iframe at session_url → cookie skips the token prompt
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

    const panel = vscode.window.createWebviewPanel(
        'tachikomaZellij',
        `zellij · ${opts.sessionName}`,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
    );

    // The WebView does the pre-auth POST then loads the iframe
    panel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https://*.tachikoma.sh https://* http://*; connect-src https://*.tachikoma.sh https://* http://*; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
        iframe { width: 100%; height: 100%; border: none; display: none; }
        #status { color: #888; font: 13px monospace; padding: 20px; }
    </style>
</head>
<body>
    <div id="status">Authenticating with zellij web server...</div>
    <iframe id="zframe" allow="clipboard-read; clipboard-write"></iframe>
    <script>
        const sessionUrl = ${JSON.stringify(sessionUrl)};
        const zwToken = ${JSON.stringify(zwToken)};
        const status = document.getElementById('status');
        const iframe = document.getElementById('zframe');

        async function connect() {
            // Step 1: Pre-authenticate via POST /command/login (sets session cookie)
            try {
                status.textContent = 'Authenticating...';
                const loginUrl = sessionUrl.split('?')[0] + '/command/login';
                const resp = await fetch(loginUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ auth_token: zwToken, remember_me: true }),
                    credentials: 'include',
                });
                if (resp.ok) {
                    status.textContent = 'Authenticated, loading terminal...';
                } else {
                    status.textContent = 'Auth failed (' + resp.status + '), loading anyway...';
                }
            } catch (e) {
                status.textContent = 'Auth error: ' + e.message + ', loading anyway...';
            }

            // Step 2: Load iframe — cookie is set, zellij skips token prompt
            iframe.src = sessionUrl;
            iframe.style.display = 'block';
            iframe.onload = () => { status.style.display = 'none'; };
        }

        connect();
    </script>
</body>
</html>`;

    log(`Zellij panel: ${opts.sessionName} → ${sessionUrl}`);
    panel.onDidDispose(() => log(`Zellij panel closed: ${opts.sessionName}`));
    return panel;
}
