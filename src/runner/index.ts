// VI-1c runner entrypoint.
//
// initRunner() wires the dispatcher, registers every handler, configures
// the ACL with workspaceState + a user-id provider, and (once auth is
// ready) connects RunnerTransport to runner.{computerId}.commands. Returns
// a Disposable the extension activate() pushes onto context.subscriptions.
//
// extension.ts wiring is deferred (parallel agents own that change).
//
// Spec: .agents/specs/to_do/VI-1c-runner-rpc.md.
// ASCII only, 4-space indent.

import * as vscode from 'vscode';
import * as os from 'os';
import type { AuthManager } from '../auth/authManager';
import type { TachikomaClient } from '../api/tachikomaClient';
import { log, logError } from '../log';
import { RpcDispatcher } from './rpcDispatcher';
import { RunnerTransport } from './transport';
import { configureRunnerAcl } from './runnerAcl';
import { registerTerminalHandlers } from './handlers/terminalHandlers';
import { registerCommandHandlers } from './handlers/commandHandlers';
import { registerEditorHandlers } from './handlers/editorHandlers';
import { registerFileHandlers } from './handlers/fileHandlers';
import { registerScreenHandlers } from './handlers/screenHandlers';

function localComputerId(): string {
    return `vscode-${os.hostname()}-${os.userInfo().username}`;
}

export function initRunner(
    context: vscode.ExtensionContext,
    authManager: AuthManager,
): vscode.Disposable {
    const dispatcher = new RpcDispatcher();
    let transport: RunnerTransport | null = null;

    configureRunnerAcl({
        getLocalUserId: () => authManager.getUserId(),
        workspaceState: context.workspaceState,
    });

    registerTerminalHandlers(dispatcher);
    registerCommandHandlers(dispatcher);
    registerEditorHandlers(dispatcher);
    registerFileHandlers(dispatcher);
    registerScreenHandlers(dispatcher);
    log(`runner: handlers ready (${dispatcher.listMethods().length} methods)`);

    const onConnect = authManager.onDidConnect(async (client: TachikomaClient) => {
        try {
            transport?.disconnect();
            transport = new RunnerTransport({
                baseUrl: client.baseUrl,
                token: client.getToken() ?? '',
                computerId: localComputerId(),
                dispatcher,
            });
            await transport.connect();
        } catch (e) {
            logError('runner: transport connect failed', e);
        }
    });

    const onDisconnect = authManager.onDidDisconnect(() => {
        transport?.disconnect();
        transport = null;
    });

    return {
        dispose() {
            onConnect.dispose();
            onDisconnect.dispose();
            transport?.disconnect();
            transport = null;
        },
    };
}
