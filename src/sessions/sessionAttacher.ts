import * as vscode from 'vscode';
import { log } from '../log';
import type { ZellijWebInfo } from './sessionTypes';

/**
 * Extract SSH-able hostname from the tachikoma host URL.
 *   "http://dev-005:8000"  → "dev-005"
 *   "https://100.112.177.51:8000" → "100.112.177.51"
 */
export function sshHostFromUrl(hostUrl: string): string {
    try {
        const u = new URL(hostUrl);
        return u.hostname;
    } catch {
        return hostUrl;
    }
}

/**
 * Open a VS Code terminal that SSHes into the tachikoma computer
 * and attaches to a tmux session bound to a context.
 */
export function attachTmux(opts: {
    hostUrl: string;
    sshUser: string;
    ctxId: string;
    tmuxTarget: string;
    tmuxSocket?: string;
}): vscode.Terminal {
    const host = sshHostFromUrl(opts.hostUrl);
    const socket = opts.tmuxSocket || `/tmp/tmux-ctx/${opts.ctxId}/srv`;
    const sshTarget = opts.sshUser ? `${opts.sshUser}@${host}` : host;

    const term = vscode.window.createTerminal({
        name: `tmux · ${opts.ctxId} · ${opts.tmuxTarget}`,
        iconPath: new vscode.ThemeIcon('terminal'),
    });

    const cmd = `ssh -t ${sshTarget} 'bash -lc "tmux -S ${socket} attach-session -t ${opts.tmuxTarget}"'`;
    log(`Attaching: ${cmd}`);
    term.sendText(cmd);
    term.show();
    return term;
}

/**
 * Open a VS Code terminal that SSHes and attaches to a zellij session.
 */
export function attachZellijTerminal(opts: {
    hostUrl: string;
    sshUser: string;
    sessionName: string;
}): vscode.Terminal {
    const host = sshHostFromUrl(opts.hostUrl);
    const sshTarget = opts.sshUser ? `${opts.sshUser}@${host}` : host;

    const term = vscode.window.createTerminal({
        name: `zellij · ${opts.sessionName}`,
        iconPath: new vscode.ThemeIcon('terminal'),
    });

    const cmd = `ssh -t ${sshTarget} 'bash -lc "zellij attach ${opts.sessionName}"'`;
    log(`Attaching zellij: ${cmd}`);
    term.sendText(cmd);
    term.show();
    return term;
}

/**
 * Open the Zellij web UI for a context in the external browser.
 */
export async function openZellij(webInfo: ZellijWebInfo): Promise<void> {
    if (!webInfo.available) {
        vscode.window.showWarningMessage(`No Zellij server for ${webInfo.ctx_id}`);
        return;
    }
    const url = webInfo.session_url || webInfo.url;
    log(`Opening Zellij: ${url}`);
    await vscode.env.openExternal(vscode.Uri.parse(url));
}
