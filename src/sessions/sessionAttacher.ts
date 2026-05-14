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
    ctxId?: string;
}): Promise<void> {
    log(`Attach zellij: ${opts.sessionName}`);

    let ctxId = opts.ctxId;
    let zwToken: string;

    if (!ctxId) {
        // Session name given (e.g. "remote-sdk") → resolve ctx + token
        const webData = await opts.client.getSessionWeb(opts.sessionName);
        ctxId = webData.ctx_id;
        zwToken = webData.token;
    } else {
        // ctx_id given directly (e.g. from "Zellij Web" entry) → resolve via web-info
        const webInfo = await opts.client.getSessionWebInfo(ctxId);
        zwToken = webInfo.token;
    }

    const url = `https://session.zweb.${ctxId}.tachikoma.sh/${opts.sessionName}?auth_token=${encodeURIComponent(zwToken)}`;

    log(`Zellij open: ${opts.sessionName} → ${url}`);
    await vscode.commands.executeCommand('simpleBrowser.show', vscode.Uri.parse(url));
}
