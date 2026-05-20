// VI-1c terminal.* RPC handlers.
//
// terminal.open    -> vscode.window.createTerminal()
// terminal.send_keys -> vscode.Terminal.sendText()
// terminal.read    -> stubbed (xterm buffer access requires workbench API)
// terminal.list    -> vscode.window.terminals
// terminal.close   -> vscode.Terminal.dispose()
//
// In the workbench-internal port (spec line 47) handlers wire to
// ITerminalService directly. Inside the extension host we only have the
// public vscode.Terminal API, so terminal.read returns a stub for now.
//
// Spec: .agents/specs/to_do/VI-1c-runner-rpc.md.
// ASCII only, 4-space indent.

import * as vscode from 'vscode';
import { log } from '../../log';
import { RpcDispatcher } from '../rpcDispatcher';

interface OpenParams {
    session_id?: string;
    layout?: string;
    multiplexer?: 'zellij' | 'tmux';
    name?: string;
    cwd?: string;
}

interface SendKeysParams {
    session_id: string;
    keys: string;
    raw?: boolean;
}

interface ReadParams {
    session_id: string;
    lines?: number;
    since?: string;
}

interface CloseParams {
    session_id: string;
}

// Track terminals the runner has created so we can look them up by
// session_id. Keyed by the runner-issued session id (also used as terminal
// name suffix so users can spot them in the UI).
const ownedTerminals = new Map<string, vscode.Terminal>();

function nameFor(sessionId: string): string {
    return `Tachikoma ${sessionId}`;
}

function newSessionId(): string {
    return `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function findTerminal(sessionId: string): vscode.Terminal | undefined {
    const owned = ownedTerminals.get(sessionId);
    if (owned) return owned;
    // Fallback: match by name in case the runner reconnected mid-session.
    return vscode.window.terminals.find(
        (t) => t.name === nameFor(sessionId),
    );
}

export function registerTerminalHandlers(disp: RpcDispatcher): void {
    disp.register('terminal.open', async (params: OpenParams) => {
        const sessionId = params.session_id ?? newSessionId();
        const multiplexer = params.multiplexer ?? 'zellij';

        // V1: spawn the user's default shell. Multiplexer wrapping (zellij /
        // tmux) is handled by VI-1g; we just hand back a sessionId.
        const term = vscode.window.createTerminal({
            name: params.name ?? nameFor(sessionId),
            cwd: params.cwd,
        });
        term.show(false);
        ownedTerminals.set(sessionId, term);
        log(`runner: terminal.open session=${sessionId} mux=${multiplexer}`);
        return { session_id: sessionId, pane_id: sessionId };
    });

    disp.register('terminal.send_keys', async (params: SendKeysParams) => {
        const term = findTerminal(params.session_id);
        if (!term) {
            throw new Error(`session ${params.session_id} not found`);
        }
        // raw=true means do not append a newline; sendText(text, false)
        // already skips the trailing newline.
        term.sendText(params.keys, !params.raw);
        return {};
    });

    disp.register('terminal.read', async (_params: ReadParams) => {
        // Public vscode API lacks buffer access; full impl ships in the
        // workbench-internal contrib (uses ITerminalInstance.xterm).
        return {
            output: '',
            cursor: '',
            note: 'terminal.read not implemented in extension-host runner',
        };
    });

    disp.register('terminal.list', async () => {
        const sessions = Array.from(ownedTerminals.entries()).map(
            ([id, t]) => ({
                id,
                name: t.name,
                pane_count: 1,
                last_active: Date.now(),
            }),
        );
        return { sessions };
    });

    disp.register('terminal.close', async (params: CloseParams) => {
        const term = findTerminal(params.session_id);
        if (term) {
            term.dispose();
            ownedTerminals.delete(params.session_id);
        }
        return {};
    });
}
