import * as vscode from 'vscode';
import { log } from '../log';
import { openTerminalPanel } from '../terminal/terminalPanel';

export function sshHostFromUrl(hostUrl: string): string {
    try {
        return new URL(hostUrl).hostname;
    } catch {
        return hostUrl;
    }
}

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
 * Open a terminal WebView connected to the remote PTY proxy via WebSocket.
 * The remote PTY stays at fixed size — no resize propagated to other clients.
 */
export function attachSession(opts: {
    extensionUri: vscode.Uri;
    hostUrl: string;
    token: string;
    sessionId: string;
    title: string;
}): vscode.WebviewPanel {
    const wsBase = wsBaseFromUrl(opts.hostUrl);
    const wsUrl = `${wsBase}/api/sessions/pty/${opts.sessionId}`;

    log(`Attach session: ${opts.title} → ${wsUrl}`);

    return openTerminalPanel({
        extensionUri: opts.extensionUri,
        title: opts.title,
        wsUrl,
        token: opts.token,
    });
}

/**
 * Attach a zellij session by name.
 * First resolves session_id from the sessions API, then connects via WebSocket PTY.
 * Falls back to SSH if no PTY session ID is available.
 */
export function attachZellijSession(opts: {
    extensionUri: vscode.Uri;
    hostUrl: string;
    token: string;
    sessionName: string;
    sessionId?: string;
}): vscode.WebviewPanel | vscode.Terminal {
    if (opts.sessionId) {
        return attachSession({
            extensionUri: opts.extensionUri,
            hostUrl: opts.hostUrl,
            token: opts.token,
            sessionId: opts.sessionId,
            title: `zellij · ${opts.sessionName}`,
        });
    }

    // Fallback: use the session name as ID (backend resolves it)
    return attachSession({
        extensionUri: opts.extensionUri,
        hostUrl: opts.hostUrl,
        token: opts.token,
        sessionId: opts.sessionName,
        title: `zellij · ${opts.sessionName}`,
    });
}

export function attachTmuxSession(opts: {
    extensionUri: vscode.Uri;
    hostUrl: string;
    token: string;
    sessionId: string;
    sessionName: string;
}): vscode.WebviewPanel {
    return attachSession({
        extensionUri: opts.extensionUri,
        hostUrl: opts.hostUrl,
        token: opts.token,
        sessionId: opts.sessionId,
        title: `tmux · ${opts.sessionName}`,
    });
}
