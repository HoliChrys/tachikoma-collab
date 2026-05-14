import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from '../log';

export function sshHostFromUrl(hostUrl: string): string {
    try {
        return new URL(hostUrl).hostname;
    } catch {
        return hostUrl;
    }
}

/**
 * Create a temporary askpass script that echoes the ACL token.
 * SSH calls this script instead of prompting for a password.
 * The token is validated server-side by pam_script → /api/auth/me.
 */
function createAskpass(token: string): string {
    const dir = path.join(os.tmpdir(), 'tachikoma-vscode');
    fs.mkdirSync(dir, { recursive: true });
    const askpath = path.join(dir, `askpass-${process.pid}.sh`);
    fs.writeFileSync(askpath, `#!/bin/sh\necho '${token.replace(/'/g, "'\\''")}'`, { mode: 0o700 });
    return askpath;
}

/**
 * Create a VS Code terminal that SSHes to the tachikoma computer
 * using the ACL token for auth (via SSH_ASKPASS + PAM).
 */
function sshTerminal(opts: {
    name: string;
    hostUrl: string;
    sshUser: string;
    token: string;
    remoteCommand: string;
}): vscode.Terminal {
    const host = sshHostFromUrl(opts.hostUrl);
    const sshTarget = opts.sshUser ? `${opts.sshUser}@${host}` : host;
    const askpass = createAskpass(opts.token);

    const term = vscode.window.createTerminal({
        name: opts.name,
        iconPath: new vscode.ThemeIcon('terminal'),
        env: {
            SSH_ASKPASS: askpass,
            SSH_ASKPASS_REQUIRE: 'force',
            DISPLAY: ':0',
        },
    });

    const cmd = `ssh -t -o StrictHostKeyChecking=accept-new ${sshTarget} '${opts.remoteCommand}'`;
    log(`SSH attach: ${cmd}`);
    term.sendText(cmd);
    term.show();
    return term;
}

export function attachTmux(opts: {
    hostUrl: string;
    sshUser: string;
    token: string;
    ctxId: string;
    tmuxTarget: string;
    tmuxSocket?: string;
}): vscode.Terminal {
    const socket = opts.tmuxSocket || `/tmp/tmux-ctx/${opts.ctxId}/srv`;
    return sshTerminal({
        name: `tmux · ${opts.ctxId} · ${opts.tmuxTarget}`,
        hostUrl: opts.hostUrl,
        sshUser: opts.sshUser,
        token: opts.token,
        remoteCommand: `bash -lc "tmux -S ${socket} attach-session -t ${opts.tmuxTarget}"`,
    });
}

export function attachZellijTerminal(opts: {
    hostUrl: string;
    sshUser: string;
    token: string;
    sessionName: string;
}): vscode.Terminal {
    return sshTerminal({
        name: `zellij · ${opts.sessionName}`,
        hostUrl: opts.hostUrl,
        sshUser: opts.sshUser,
        token: opts.token,
        remoteCommand: `bash -lc "zellij attach ${opts.sessionName}"`,
    });
}
