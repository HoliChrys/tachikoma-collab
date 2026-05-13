import * as vscode from 'vscode';
import { AuthManager } from './auth/authManager';
import { ContextStore } from './store/contextStore';
import { ContextTreeProvider } from './hierarchy/contextTreeProvider';
import { RemoteFileProvider, TACHIKOMA_SCHEME, buildFileUri } from './hierarchy/remoteFileProvider';
import { CollaborationManager } from './collaborative/collaborationManager';
import { CollaboratorsProvider } from './collaborative/collaboratorsProvider';
import { SessionsProvider, type SessionEntry, type ZellijEntry } from './sessions/sessionsProvider';
import { attachTmux, openZellij } from './sessions/sessionAttacher';
import { log, getOutputChannel } from './log';
import type { ContextNode } from './types';

export async function activate(context: vscode.ExtensionContext) {
    log('Tachikoma extension activating...');

    const authManager = new AuthManager();
    const store = new ContextStore(context.globalState);
    const contextTree = new ContextTreeProvider();
    const remoteFileProvider = new RemoteFileProvider();
    const collabManager = new CollaborationManager();
    const collaboratorsProvider = new CollaboratorsProvider();
    const sessionsProvider = new SessionsProvider();

    contextTree.setStore(store);
    collaboratorsProvider.setStore(store);
    sessionsProvider.setStore(store);

    // Reflect store sync state in the status bar
    store.onSyncStateChanged((s) => authManager.setSyncState(s));

    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(TACHIKOMA_SCHEME, remoteFileProvider, {
            isCaseSensitive: true,
        }),
    );

    const contextTreeView = vscode.window.createTreeView('tachikomaContextTree', {
        treeDataProvider: contextTree,
    });
    context.subscriptions.push(
        contextTreeView,
        vscode.window.registerTreeDataProvider('tachikomaCollaborators', collaboratorsProvider),
        vscode.window.registerTreeDataProvider('tachikomaSessions', sessionsProvider),
    );

    function contextFromUri(uri: vscode.Uri): string | undefined {
        if (uri.scheme !== TACHIKOMA_SCHEME) return undefined;
        return uri.authority;
    }

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc) => {
            const ctx = contextFromUri(doc.uri);
            if (ctx) {
                store.activateContext(ctx);
                log(`Context activated: ${ctx}`);
            }
        }),
        vscode.workspace.onDidCloseTextDocument((doc) => {
            const ctx = contextFromUri(doc.uri);
            if (ctx) {
                store.deactivateContext(ctx);
                log(`Context deactivated: ${ctx}`);
            }
        }),
    );

    const config = vscode.workspace.getConfiguration('tachikoma');

    authManager.onDidConnect(async (client) => {
        log('Auth connected — initializing store');
        const userId = authManager.getUserId() ?? 'unknown';

        contextTree.setClient(client);
        remoteFileProvider.setClient(client);
        sessionsProvider.setClient(client);
        collabManager.connect(client, userId, userId);

        await store.init(client, userId);
    });

    authManager.onDidDisconnect(() => {
        log('Auth disconnected — cleaning up');
        contextTree.setClient(null);
        remoteFileProvider.setClient(null);
        sessionsProvider.setClient(null);
        collabManager.disconnect();
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('tachikoma.connect', () => {
            return authManager.connect(context);
        }),
        vscode.commands.registerCommand('tachikoma.disconnect', () => {
            return authManager.disconnect(context);
        }),
        vscode.commands.registerCommand('tachikoma.showOutput', () => {
            getOutputChannel().show(true);
        }),
        vscode.commands.registerCommand('tachikoma.openRemoteFile', async (node: ContextNode) => {
            if (!node.contextPath || !node.fsPath) return;
            const uri = buildFileUri(node.contextPath, node.fsPath);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: true });
        }),
        vscode.commands.registerCommand('tachikoma.startCollaborating', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }
            return collabManager.startCollaborating(editor.document);
        }),
        vscode.commands.registerCommand('tachikoma.stopCollaborating', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            return collabManager.stopCollaborating(editor.document);
        }),
        vscode.commands.registerCommand('tachikoma.attachSession', async (node: SessionEntry | ZellijEntry) => {
            const hostUrl = config.get<string>('host') ?? '';
            if (!hostUrl) {
                vscode.window.showErrorMessage('tachikoma.host setting not configured');
                return;
            }
            const sshUser = authManager.getUserId() ?? 'ubuntu';

            if (node.kind === 'session' && node.sessionType === 'tmux' && node.tmuxTarget) {
                attachTmux({
                    hostUrl,
                    sshUser,
                    ctxId: node.parentCtxId,
                    tmuxTarget: node.tmuxTarget,
                    tmuxSocket: node.tmuxSocket,
                });
            } else if (node.kind === 'zellij') {
                const client = authManager.getClient();
                if (!client) return;
                try {
                    const info = await client.getSessionWebInfo(node.contextPath || node.parentCtxId);
                    await openZellij(info);
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to open Zellij: ${err}`);
                }
            } else if (node.kind === 'session' && node.sessionType === 'zellij') {
                const client = authManager.getClient();
                if (!client) return;
                try {
                    const info = await client.getSessionWebInfo(node.parentCtxId);
                    await openZellij(info);
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to open Zellij: ${err}`);
                }
            }
        }),
        vscode.commands.registerCommand('tachikoma.openZellij', async (node: ZellijEntry) => {
            const client = authManager.getClient();
            if (!client) return;
            try {
                const info = await client.getSessionWebInfo(node.contextPath || node.parentCtxId);
                await openZellij(info);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to open Zellij: ${err}`);
            }
        }),
        vscode.commands.registerCommand('tachikoma.refreshSessions', () => {
            sessionsProvider.refresh();
        }),
        vscode.commands.registerCommand('tachikoma.invalidateCache', async () => {
            await store.invalidateCache();
            vscode.window.showInformationMessage('Tachikoma cache invalidated and resynced');
        }),
    );

    if (config.get<boolean>('autoConnect')) {
        log('Auto-connect enabled, attempting reconnect...');
        void authManager.tryReconnect(context);
    }

    context.subscriptions.push(authManager, store, collabManager, sessionsProvider, getOutputChannel());
    log('Tachikoma extension activated');
}

export function deactivate() {}
