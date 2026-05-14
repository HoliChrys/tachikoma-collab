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
 * Zellij sessions → iframe to zweb.
 * Uses GET /api/sessions/{name}/web which returns the iframe_url directly.
 */
export async function attachZellijSession(opts: {
    client: TachikomaClient;
    extensionUri: vscode.Uri;
    sessionName: string;
}): Promise<vscode.WebviewPanel> {
    log(`Attach zellij: ${opts.sessionName}`);

    const webData = await opts.client.getSessionWeb(opts.sessionName);

    // Use session_url — routed via Tailscale DNS + Traefik HTTPS proxy
    // e.g. https://session.tachikoma.paralelle.sdk.tachikoma.sh?token=...
    const iframeUrl = webData.session_url ?? webData.iframe_url;

    const panel = vscode.window.createWebviewPanel(
        'tachikomaZellij',
        `zellij · ${opts.sessionName}`,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
    );

    panel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https://*.tachikoma.sh https://* http://*; style-src 'unsafe-inline';">
    <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
        iframe { width: 100%; height: 100%; border: none; }
        #loading { color: #888; font: 13px monospace; padding: 20px; }
    </style>
</head>
<body>
    <div id="loading">Loading ${opts.sessionName}...</div>
    <iframe id="zframe" src="${iframeUrl}" allow="clipboard-read; clipboard-write"
        onload="document.getElementById('loading').style.display='none'"></iframe>
</body>
</html>`;

    log(`Zellij panel: ${opts.sessionName} → ${iframeUrl}`);
    panel.onDidDispose(() => log(`Zellij panel closed: ${opts.sessionName}`));
    return panel;
}
