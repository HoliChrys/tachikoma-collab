import * as vscode from 'vscode';

let _channel: vscode.OutputChannel | null = null;

export function getOutputChannel(): vscode.OutputChannel {
    if (!_channel) {
        _channel = vscode.window.createOutputChannel('Tachikoma');
    }
    return _channel;
}

export function log(msg: string): void {
    const ts = new Date().toISOString().slice(11, 23);
    getOutputChannel().appendLine(`[${ts}] ${msg}`);
}

export function logError(msg: string, err?: unknown): void {
    const detail = err instanceof Error
        ? `${err.message}${err.cause ? ` (cause: ${err.cause})` : ''}`
        : err !== undefined ? String(err) : '';
    log(`ERROR ${msg}${detail ? ': ' + detail : ''}`);
}

export function showAndLog(msg: string): void {
    log(msg);
    getOutputChannel().show(true);
}
