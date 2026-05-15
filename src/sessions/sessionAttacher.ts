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
 * Zellij sessions → native VS Code terminal running:
 *   zellij attach https://session.zweb.{ctx}.tachikoma.sh/{session} --token {token} --remember
 *
 * Opens in the terminal panel (bottom of VS Code).
 * Direct zellij client connection — no SSH, no WebView, no iframe.
 */
export async function attachZellijSession(opts: {
    client: TachikomaClient;
    sessionName: string;
    ctxId?: string;
}): Promise<void> {
    log(`Attach zellij: ${opts.sessionName}`);

    let ctxId = opts.ctxId;
    let zwToken: string;

    if (!ctxId) {
        const webData = await opts.client.getSessionWeb(opts.sessionName);
        ctxId = webData.ctx_id;
        zwToken = webData.token;
    } else {
        const webInfo = await opts.client.getSessionWebInfo(ctxId);
        zwToken = webInfo.token;
    }

    const serverUrl = `https://session.zweb.${ctxId}.tachikoma.sh/${opts.sessionName}`;
    const cmd = `zellij attach ${serverUrl} --token ${zwToken} --remember`;

    log(`Zellij terminal: ${cmd}`);

    const term = vscode.window.createTerminal({
        name: `zellij · ${opts.sessionName}`,
        iconPath: new vscode.ThemeIcon('terminal'),
    });
    term.sendText(cmd);
    term.show();
}
