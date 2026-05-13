import * as vscode from 'vscode';
import { AuthManager } from './auth/authManager';
import { ContextTreeProvider } from './hierarchy/contextTreeProvider';
import { RemoteFileProvider, TACHIKOMA_SCHEME, buildFileUri } from './hierarchy/remoteFileProvider';
import { CollaborationManager } from './collaborative/collaborationManager';
import { CollaboratorsProvider } from './collaborative/collaboratorsProvider';
import { log, getOutputChannel } from './log';
import type { ContextNode } from './types';

export async function activate(context: vscode.ExtensionContext) {
    log('Tachikoma extension activating...');

    const authManager = new AuthManager();
    const contextTree = new ContextTreeProvider();
    const remoteFileProvider = new RemoteFileProvider();
    const collabManager = new CollaborationManager();
    const collaboratorsProvider = new CollaboratorsProvider();

    // Register tachikoma:// URI scheme for remote file viewing
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(TACHIKOMA_SCHEME, remoteFileProvider),
    );

    // Register tree views
    const contextTreeView = vscode.window.createTreeView('tachikomaContextTree', {
        treeDataProvider: contextTree,
    });
    context.subscriptions.push(
        contextTreeView,
        vscode.window.registerTreeDataProvider('tachikomaCollaborators', collaboratorsProvider),
    );

    // When user selects a context, update collaborators for that context
    contextTreeView.onDidChangeSelection((e) => {
        const selected = e.selection[0];
        if (selected && (selected.type === 'galaxy' || selected.type === 'system' || selected.type === 'space')) {
            collaboratorsProvider.setSelectedContext(selected);
        }
    });

    const config = vscode.workspace.getConfiguration('tachikoma');

    // Wire auth events to downstream modules
    authManager.onDidConnect((client) => {
        log('Auth connected — initializing context tree and collaboration');
        contextTree.setClient(client);
        remoteFileProvider.setClient(client);
        collaboratorsProvider.setClient(client);
        const userId = authManager.getUserId() ?? 'unknown';
        collabManager.connect(client, userId, userId);
        collaboratorsProvider.bind(collabManager);
    });

    authManager.onDidDisconnect(() => {
        log('Auth disconnected — cleaning up');
        contextTree.setClient(null);
        remoteFileProvider.setClient(null);
        collaboratorsProvider.setClient(null);
        collabManager.disconnect();
        collaboratorsProvider.unbind();
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

    // Auto-connect on startup if configured
    if (config.get<boolean>('autoConnect')) {
        log('Auto-connect enabled, attempting reconnect...');
        void authManager.tryReconnect(context);
    }

    context.subscriptions.push(authManager, collabManager, getOutputChannel());
    log('Tachikoma extension activated');
}

export function deactivate() {}
