import * as vscode from 'vscode';
import WebSocket from 'ws';
import { log, logError } from '../log';

/**
 * Opens a WebView panel with xterm.js connected to the remote PTY proxy.
 *
 * The PTY size is fixed at the WebSocket level (cols/rows sent once at open).
 * xterm.js adapts its viewport to the VS Code panel size locally — no resize
 * is propagated to the remote session. Other clients (Ghostty, etc.) are unaffected.
 */
export function openTerminalPanel(opts: {
    extensionUri: vscode.Uri;
    title: string;
    wsUrl: string;
    token: string;
    cols?: number;
    rows?: number;
}): vscode.WebviewPanel {
    const cols = opts.cols ?? 200;
    const rows = opts.rows ?? 50;

    const panel = vscode.window.createWebviewPanel(
        'tachikomaTerminal',
        opts.title,
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(opts.extensionUri, 'node_modules')],
        },
    );

    // Resolve xterm CSS/JS from node_modules
    const xtermCss = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(opts.extensionUri, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css')
    );
    const xtermJs = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(opts.extensionUri, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.js')
    );
    const fitJs = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(opts.extensionUri, 'node_modules', '@xterm', 'addon-fit', 'lib', 'addon-fit.js')
    );

    // Build WebSocket URL with token
    const wsUrlFull = `${opts.wsUrl}?token=${encodeURIComponent(opts.token)}&cols=${cols}&rows=${rows}`;

    panel.webview.html = getTerminalHtml({
        xtermCss: xtermCss.toString(),
        xtermJs: xtermJs.toString(),
        fitJs: fitJs.toString(),
        wsUrl: wsUrlFull,
        cols,
        rows,
    });

    log(`Terminal panel opened: ${opts.title} → ${opts.wsUrl}`);

    panel.onDidDispose(() => {
        log(`Terminal panel closed: ${opts.title}`);
    });

    return panel;
}

/**
 * Opens a local terminal panel connected to the tachikoma local daemon's
 * WebSocket PTY endpoint at ws://127.0.0.1:{port}/ws/pty/{sessionId}.
 */
export function openLocalTerminalPanel(opts: {
    extensionUri: vscode.Uri;
    title: string;
    sessionId: string;
    daemonPort?: number;
    cols?: number;
    rows?: number;
}): vscode.WebviewPanel {
    const port = opts.daemonPort ?? 9321;
    const wsUrl = `ws://127.0.0.1:${port}/ws/pty/${opts.sessionId}`;
    return openTerminalPanel({
        extensionUri: opts.extensionUri,
        title: opts.title,
        wsUrl,
        token: '',
        cols: opts.cols,
        rows: opts.rows,
    });
}

function getTerminalHtml(opts: {
    xtermCss: string;
    xtermJs: string;
    fitJs: string;
    wsUrl: string;
    cols: number;
    rows: number;
}): string {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="${opts.xtermCss}">
    <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
        #terminal { width: 100%; height: 100%; }
        #status { position: fixed; top: 4px; right: 8px; color: #888; font: 11px monospace; z-index: 10; }
    </style>
</head>
<body>
    <div id="status">connecting...</div>
    <div id="terminal"></div>
    <script src="${opts.xtermJs}"></script>
    <script src="${opts.fitJs}"></script>
    <script>
        const term = new Terminal({
            fontFamily: 'Menlo, Monaco, Consolas, monospace',
            fontSize: 13,
            theme: { background: '#1e1e1e' },
            cursorBlink: true,
            scrollback: 5000,
        });

        const fitAddon = new FitAddon.FitAddon();
        term.loadAddon(fitAddon);
        term.open(document.getElementById('terminal'));
        fitAddon.fit();

        const status = document.getElementById('status');
        let ws;

        function connect() {
            status.textContent = 'connecting...';
            ws = new WebSocket('${opts.wsUrl}');
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                status.textContent = 'connected';
                setTimeout(() => { status.textContent = ''; }, 2000);
            };

            ws.onmessage = (e) => {
                if (e.data instanceof ArrayBuffer) {
                    term.write(new Uint8Array(e.data));
                } else {
                    term.write(e.data);
                }
            };

            ws.onclose = () => {
                status.textContent = 'disconnected';
                term.write('\\r\\n[connection closed]\\r\\n');
            };

            ws.onerror = () => {
                status.textContent = 'error';
            };
        }

        // Input: keystrokes → WebSocket
        term.onData((data) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        });

        // Resize: fit to panel, but do NOT send resize to server
        // The remote PTY stays at fixed ${opts.cols}x${opts.rows}
        // xterm.js just scrolls/clips locally
        new ResizeObserver(() => {
            fitAddon.fit();
        }).observe(document.getElementById('terminal'));

        connect();
    </script>
</body>
</html>`;
}
