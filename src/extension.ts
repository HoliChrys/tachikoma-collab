import * as vscode from 'vscode';
import { AuthManager } from './auth/authManager';
import { ContextTreeProvider } from './hierarchy/contextTreeProvider';
import { CollaborationManager } from './collaborative/collaborationManager';
import { CollaboratorsProvider } from './collaborative/collaboratorsProvider';

export async function activate(context: vscode.ExtensionContext) {
    const authManager = new AuthManager();
    const contextTree = new ContextTreeProvider();
    const collabManager = new CollaborationManager();
    const collaboratorsProvider = new CollaboratorsProvider();

    // Register tree views
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('tachikomaContextTree', contextTree),
        vscode.window.registerTreeDataProvider('tachikomaCollaborators', collaboratorsProvider),
    );

    // Wire auth events to downstream modules
    authManager.onDidConnect((client) => {
        contextTree.setClient(client);
        const userId = authManager.getUserId() ?? 'unknown';
        collabManager.connect(client, userId, userId);
        collaboratorsProvider.bind(collabManager);
    });

    authManager.onDidDisconnect(() => {
        contextTree.setClient(null);
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
    const config = vscode.workspace.getConfiguration('tachikoma');
    if (config.get<boolean>('autoConnect')) {
        void authManager.tryReconnect(context);
    }

    context.subscriptions.push(authManager, collabManager);
}

export function deactivate() {}
