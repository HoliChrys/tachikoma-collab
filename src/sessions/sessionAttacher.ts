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
 * Each WS connection gets its own PTY — resize is per-client.
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
 * Zellij sessions → iframe to the zellij web server (zweb).
 * Each context has its own zweb with its own token.
 * The session URL points to the specific session in the web UI.
 * Resize is handled by the zweb — no impact on other clients.
 */
export async function attachZellijSession(opts: {
    client: TachikomaClient;
    extensionUri: vscode.Uri;
    contextPath: string;
    sessionName: string;
}): Promise<vscode.WebviewPanel> {
    log(`Attach zellij: ${opts.sessionName} (ctx=${opts.contextPath})`);

    let webInfo: { available: boolean; url: string; session_url: string; token: string; ctx_id: string; port: number };
    try {
        webInfo = await opts.client.getSessionWebInfo(opts.contextPath);
    } catch (err) {
        logError('Failed to get zellij web info', err);
        throw err;
    }

    if (!webInfo.available) {
        vscode.window.showErrorMessage(`No zellij web server for context ${opts.contextPath}`);
        throw new Error('zweb not available');
    }

    // Build the zweb URL accessible from the user's laptop via Tailscale
    // The API returns url like "http://127.0.1.8:6080" (local to server)
    // We need to route through the API host (accessible via Tailscale)
    const apiHost = new URL(opts.client.baseUrl).hostname;
    const zwebUrl = `http://${apiHost}:${webInfo.port}`;

    const panel = vscode.window.createWebviewPanel(
        'tachikomaZellij',
        `zellij · ${opts.sessionName}`,
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        },
    );

    panel.webview.html = getZellijHtml({
        zwebUrl,
        token: webInfo.token,
        sessionName: opts.sessionName,
    });

    log(`Zellij panel opened: ${opts.sessionName} → ${zwebUrl}`);

    panel.onDidDispose(() => {
        log(`Zellij panel closed: ${opts.sessionName}`);
    });

    return panel;
}

function getZellijHtml(opts: { zwebUrl: string; token: string; sessionName: string }): string {
    const iframeUrl = `${opts.zwebUrl}/?token=${encodeURIComponent(opts.token)}&session=${encodeURIComponent(opts.sessionName)}`;
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
        iframe { width: 100%; height: 100%; border: none; }
        #error { display: none; color: #ccc; font: 14px monospace; padding: 20px; }
    </style>
</head>
<body>
    <div id="error"></div>
    <iframe
        id="zellij"
        src="${iframeUrl}"
        allow="clipboard-read; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    ></iframe>
    <script>
        const iframe = document.getElementById('zellij');
        iframe.onerror = () => {
            document.getElementById('error').style.display = 'block';
            document.getElementById('error').textContent = 'Failed to load zellij web server at ${opts.zwebUrl}';
        };
    </script>
</body>
</html>`;
}
