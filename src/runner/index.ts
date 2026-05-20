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
import {
    RunnerTransport,
    type RunnerStateSnapshot,
} from './transport';
import { configureRunnerAcl } from './runnerAcl';
import { registerTerminalHandlers } from './handlers/terminalHandlers';
import { registerCommandHandlers } from './handlers/commandHandlers';
import { registerEditorHandlers } from './handlers/editorHandlers';
import { registerFileHandlers } from './handlers/fileHandlers';
import { registerScreenHandlers } from './handlers/screenHandlers';

function localComputerId(): string {
    return `vscode-${os.hostname()}-${os.userInfo().username}`;
}

/**
 * A small read-only handle exposed by initRunner so other modules
 * (status bar, audit views) can observe runner transport state without
 * reaching into the module's private state. The current snapshot is
 * always available via getState(); subscribers receive every change via
 * onDidChangeState.
 */
export interface RunnerStateProvider {
    getState(): RunnerStateSnapshot;
    onDidChangeState: vscode.Event<RunnerStateSnapshot>;
}

export function initRunner(
    context: vscode.ExtensionContext,
    authManager: AuthManager,
): vscode.Disposable & { state: RunnerStateProvider } {
    const dispatcher = new RpcDispatcher();
    let transport: RunnerTransport | null = null;
    let transportStateSub: vscode.Disposable | null = null;

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

    // Idle baseline shown to subscribers before a transport exists.
    let currentSnapshot: RunnerStateSnapshot = {
        state: 'idle',
        mode: null,
        computerId: localComputerId(),
        lastMethod: null,
        lastAt: null,
        lastError: null,
    };
    const stateEmitter = new vscode.EventEmitter<RunnerStateSnapshot>();
    const state: RunnerStateProvider = {
        getState: () => ({ ...currentSnapshot }),
        onDidChangeState: stateEmitter.event,
    };

    const onConnect = authManager.onDidConnect(async (client: TachikomaClient) => {
        try {
            transportStateSub?.dispose();
            transport?.disconnect();
            transport = new RunnerTransport({
                baseUrl: client.baseUrl,
                token: client.getToken() ?? '',
                computerId: localComputerId(),
                dispatcher,
            });
            transportStateSub = transport.onDidChangeState((s) => {
                currentSnapshot = s;
                stateEmitter.fire(s);
            });
            // Push the freshly-created snapshot so subscribers see "idle"
            // (with the right computer_id) before connect() starts.
            currentSnapshot = transport.getState();
            stateEmitter.fire(currentSnapshot);
            await transport.connect();
        } catch (e) {
            logError('runner: transport connect failed', e);
        }
    });

    const onDisconnect = authManager.onDidDisconnect(() => {
        transportStateSub?.dispose();
        transportStateSub = null;
        transport?.disconnect();
        transport = null;
        currentSnapshot = {
            state: 'idle',
            mode: null,
            computerId: localComputerId(),
            lastMethod: null,
            lastAt: null,
            lastError: null,
        };
        stateEmitter.fire(currentSnapshot);
    });

    return {
        state,
        dispose() {
            onConnect.dispose();
            onDisconnect.dispose();
            transportStateSub?.dispose();
            transportStateSub = null;
            transport?.disconnect();
            transport = null;
            stateEmitter.dispose();
        },
    };
}
