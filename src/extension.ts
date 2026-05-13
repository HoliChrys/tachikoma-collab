import * as vscode from 'vscode';
import { AuthManager } from './auth/authManager';
import { ContextStore } from './store/contextStore';
import { ContextTreeProvider } from './hierarchy/contextTreeProvider';
import { RemoteFileProvider, TACHIKOMA_SCHEME, buildFileUri } from './hierarchy/remoteFileProvider';
import { CollaborationManager } from './collaborative/collaborationManager';
import { CollaboratorsProvider } from './collaborative/collaboratorsProvider';
import { log, getOutputChannel } from './log';
import type { ContextNode } from './types';

export async function activate(context: vscode.ExtensionContext) {
    log('Tachikoma extension activating...');

    const authManager = new AuthManager();
    const store = new ContextStore();
    const contextTree = new ContextTreeProvider();
    const remoteFileProvider = new RemoteFileProvider();
    const collabManager = new CollaborationManager();
    const collaboratorsProvider = new CollaboratorsProvider();

    // Wire store to views
    contextTree.setStore(store);
    collaboratorsProvider.setStore(store);

    // Register tachikoma:// filesystem
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(TACHIKOMA_SCHEME, remoteFileProvider, {
            isCaseSensitive: true,
        }),
    );

    // Register tree views
    const contextTreeView = vscode.window.createTreeView('tachikomaContextTree', {
        treeDataProvider: contextTree,
    });
    context.subscriptions.push(
        contextTreeView,
        vscode.window.registerTreeDataProvider('tachikomaCollaborators', collaboratorsProvider),
    );

    // --- Buffer tracking: activate/deactivate contexts ---

    function contextFromUri(uri: vscode.Uri): string | undefined {
        if (uri.scheme !== TACHIKOMA_SCHEME) return undefined;
        return uri.authority; // e.g. "tachikoma.paralelle.sdk"
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

    // Wire auth events
    authManager.onDidConnect(async (client) => {
        log('Auth connected — initializing store');
        const userId = authManager.getUserId() ?? 'unknown';

        contextTree.setClient(client);
        remoteFileProvider.setClient(client);
        await store.init(client, userId);

        collabManager.connect(client, userId, userId);
    });

    authManager.onDidDisconnect(() => {
        log('Auth disconnected — cleaning up');
        contextTree.setClient(null);
        remoteFileProvider.setClient(null);
        collabManager.disconnect();
    });

    // Commands
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
    );

    if (config.get<boolean>('autoConnect')) {
        log('Auto-connect enabled, attempting reconnect...');
        void authManager.tryReconnect(context);
    }

    context.subscriptions.push(authManager, store, collabManager, getOutputChannel());
    log('Tachikoma extension activated');
}

export function deactivate() {}
