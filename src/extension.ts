import * as vscode from 'vscode';
import { AuthManager } from './auth/authManager';
import { ContextTreeProvider } from './hierarchy/contextTreeProvider';
import { CollaborationManager } from './collaborative/collaborationManager';
import { CollaboratorsProvider } from './collaborative/collaboratorsProvider';
import { log, getOutputChannel } from './log';

export async function activate(context: vscode.ExtensionContext) {
    log('Tachikoma extension activating...');

    const authManager = new AuthManager();
    const contextTree = new ContextTreeProvider();
    const collabManager = new CollaborationManager();
    const collaboratorsProvider = new CollaboratorsProvider();

    // Register tree views
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('tachikomaContextTree', contextTree),
        vscode.window.registerTreeDataProvider('tachikomaCollaborators', collaboratorsProvider),
    );

    // Set monorepo root from config or workspace
    const config = vscode.workspace.getConfiguration('tachikoma');
    const monorepoRoot = config.get<string>('monorepoRoot')
        || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        || '';
    if (monorepoRoot) {
        contextTree.setMonorepoRoot(monorepoRoot);
        log(`Monorepo root: ${monorepoRoot}`);
    }

    // Wire auth events to downstream modules
    authManager.onDidConnect((client) => {
        log('Auth connected — initializing context tree and collaboration');
        contextTree.setClient(client);
        const userId = authManager.getUserId() ?? 'unknown';
        collabManager.connect(client, userId, userId);
        collaboratorsProvider.bind(collabManager);
    });

    authManager.onDidDisconnect(() => {
        log('Auth disconnected — cleaning up');
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

        vscode.commands.registerCommand('tachikoma.showOutput', () => {
            getOutputChannel().show(true);
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
