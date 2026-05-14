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
 * Zellij sessions → iframe to /zweb/{ctx_id}/ on the API server.
 * Same origin as the API = no CORS, no cookie issues.
 * Server injects is_authenticated=true = no token prompt.
 */
export async function attachZellijSession(opts: {
    client: TachikomaClient;
    extensionUri: vscode.Uri;
    sessionName: string;
}): Promise<vscode.WebviewPanel> {
    log(`Attach zellij: ${opts.sessionName}`);

    const webData = await opts.client.getSessionWeb(opts.sessionName);
    const ctxId = webData.ctx_id;
    const iframeUrl = `${opts.client.baseUrl}/zweb/${ctxId}/`;

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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${opts.client.baseUrl} http://* https://*; style-src 'unsafe-inline';">
    <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
        iframe { width: 100%; height: 100%; border: none; }
    </style>
</head>
<body>
    <iframe src="${iframeUrl}" allow="clipboard-read; clipboard-write"></iframe>
</body>
</html>`;

    log(`Zellij panel: ${opts.sessionName} → ${iframeUrl}`);
    panel.onDidDispose(() => log(`Zellij panel closed: ${opts.sessionName}`));
    return panel;
}
