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
 *   zellij attach https://session.zweb.{ctx}.tachikoma.sh/{session_id} --token {token} --remember
 *
 * Uses the canonical session_id (without `session-` prefix) — not the display name.
 * If session is zellij_protected, prompts for password and calls /unlock first.
 */
export async function attachZellijSession(opts: {
    client: TachikomaClient;
    sessionId: string;
    sessionName?: string;
    ctxId?: string;
    isProtected?: boolean;
}): Promise<void> {
    const sessionId = opts.sessionId;
    const displayName = opts.sessionName ?? sessionId;
    log(`Attach zellij: ${sessionId}${opts.isProtected ? ' (protected)' : ''}`);

    // Unlock if protected
    if (opts.isProtected) {
        const password = await vscode.window.showInputBox({
            prompt: `Session "${displayName}" is password-protected — enter password`,
            password: true,
            ignoreFocusOut: true,
        });
        if (!password) {
            vscode.window.showWarningMessage('Attach cancelled — no password provided');
            return;
        }
        try {
            await opts.client.unlockSession(sessionId, password);
            log(`Session ${sessionId} unlocked`);
        } catch (err) {
            vscode.window.showErrorMessage(`Unlock failed: ${err}`);
            return;
        }
    }

    let ctxId = opts.ctxId;
    let zwToken: string;

    if (!ctxId) {
        const webData = await opts.client.getSessionWeb(sessionId);
        ctxId = webData.ctx_id;
        zwToken = webData.token;
    } else {
        const webInfo = await opts.client.getSessionWebInfo(ctxId);
        zwToken = webInfo.token;
    }

    const serverUrl = `https://session.zweb.${ctxId}.tachikoma.sh/${sessionId}`;
    const cmd = `zellij attach ${serverUrl} --token ${zwToken} --remember`;

    log(`Zellij terminal: ${cmd}`);

    const term = vscode.window.createTerminal({
        name: `zellij · ${displayName}`,
        iconPath: new vscode.ThemeIcon('terminal'),
    });
    term.sendText(cmd);
    term.show();
}
