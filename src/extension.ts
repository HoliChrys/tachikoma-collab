import * as vscode from 'vscode';
import { AuthManager } from './auth/authManager';
import { ContextStore } from './store/contextStore';
import { ContextTreeProvider } from './hierarchy/contextTreeProvider';
import { RemoteFileProvider, TACHIKOMA_SCHEME, buildFileUri } from './hierarchy/remoteFileProvider';
import { CollaborationManager } from './collaborative/collaborationManager';
import { CollaboratorsProvider } from './collaborative/collaboratorsProvider';
import { SessionsProvider, type SessionEntry, type ZellijEntry } from './sessions/sessionsProvider';
import { attachSession, attachZellijSession, attachTmuxSession } from './sessions/sessionAttacher';
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
        const params = new URLSearchParams(uri.query);
        return params.get('ctx') || uri.authority;
    }

    const config = vscode.workspace.getConfiguration('tachikoma');

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc) => {
            const ctx = contextFromUri(doc.uri);
            if (ctx) {
                store.activateContext(ctx);
                log(`Context activated: ${ctx}`);
                // Auto-start live collaboration for tachikoma:// files
                if (config.get<boolean>('autoCollab', true)) {
                    void collabManager.startCollaborating(doc).catch((err) => {
                        log(`Auto-collab failed for ${doc.uri.toString()}: ${err}`);
                    });
                }
            }
        }),
        vscode.workspace.onDidCloseTextDocument((doc) => {
            const ctx = contextFromUri(doc.uri);
            if (ctx) {
                store.deactivateContext(ctx);
                log(`Context deactivated: ${ctx}`);
                if (config.get<boolean>('autoCollab', true)) {
                    void collabManager.stopCollaborating(doc).catch(() => {});
                }
            }
        }),
    );

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
            const hostUrl = authManager.getHostUrl() ?? config.get<string>('host') ?? '';
            const token = authManager.getClient()?.getToken() ?? '';
            if (!hostUrl || !token) {
                vscode.window.showErrorMessage('Not connected — run "Tachikoma: Connect" first');
                return;
            }

            if (node.kind === 'session' && node.sessionType === 'tmux') {
                attachTmuxSession({
                    extensionUri: context.extensionUri,
                    hostUrl, token,
                    sessionId: node.sessionId,
                    sessionName: node.name,
                });
            } else if (node.kind === 'session' && node.sessionType === 'zellij') {
                attachZellijSession({
                    extensionUri: context.extensionUri,
                    hostUrl, token,
                    sessionName: node.name,
                    sessionId: node.sessionId,
                });
            } else if (node.kind === 'zellij') {
                attachZellijSession({
                    extensionUri: context.extensionUri,
                    hostUrl, token,
                    sessionName: node.contextPath || node.parentCtxId,
                });
            }
        }),
        vscode.commands.registerCommand('tachikoma.openZellij', async (node: ZellijEntry) => {
            const hostUrl = authManager.getHostUrl() ?? config.get<string>('host') ?? '';
            const token = authManager.getClient()?.getToken() ?? '';
            attachZellijSession({
                extensionUri: context.extensionUri,
                hostUrl, token,
                sessionName: node.contextPath || node.parentCtxId,
            });
        }),
        vscode.commands.registerCommand('tachikoma.refreshSessions', () => {
            sessionsProvider.refresh();
        }),
        vscode.commands.registerCommand('tachikoma.invalidateCache', async () => {
            await store.invalidateCache();
            vscode.window.showInformationMessage('Tachikoma cache invalidated and resynced');
        }),

        vscode.commands.registerCommand('tachikoma.copyWithReference', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const doc = editor.document;
            const sel = editor.selection;
            const selectedText = doc.getText(sel);
            if (!selectedText) {
                vscode.window.showWarningMessage('No text selected');
                return;
            }

            // Build file reference
            const uri = doc.uri;
            let filePath: string;
            let vsCodeLink: string;

            if (uri.scheme === TACHIKOMA_SCHEME) {
                const params = new URLSearchParams(uri.query);
                const ctx = params.get('ctx') || uri.authority;
                const fpath = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
                filePath = `${ctx}/${fpath}`;
                const linkParams = new URLSearchParams({
                    ctx, path: fpath,
                    line: String(sel.start.line + 1),
                    col: String(sel.start.character + 1),
                });
                if (sel.start.line !== sel.end.line || sel.start.character !== sel.end.character) {
                    linkParams.set('endLine', String(sel.end.line + 1));
                    linkParams.set('endCol', String(sel.end.character + 1));
                }
                vsCodeLink = `vscode://Tachikoma.tachikoma-collab/open?${linkParams.toString()}`;
            } else {
                filePath = vscode.workspace.asRelativePath(uri);
                vsCodeLink = `vscode://file${uri.fsPath}:${sel.start.line + 1}:${sel.start.character + 1}`;
            }

            const startLine = sel.start.line + 1;
            const endLine = sel.end.line + 1;
            const lineRef = startLine === endLine
                ? `L${startLine}:${sel.start.character + 1}-${sel.end.character + 1}`
                : `L${startLine}-${endLine}`;

            // Indent selected text with >
            const quoted = selectedText.split('\n').map((l) => `> ${l}`).join('\n');

            const ref = `${filePath}:${lineRef}\n${quoted}\n${vsCodeLink}`;

            await vscode.env.clipboard.writeText(ref);
            vscode.window.showInformationMessage(`Copied reference: ${filePath}:${lineRef}`);
        }),
    );

    // URI handler: vscode://Tachikoma.tachikoma-collab/open?ctx=...&path=...&line=...&col=...
    context.subscriptions.push(
        vscode.window.registerUriHandler({
            async handleUri(uri: vscode.Uri) {
                if (uri.path !== '/open') return;
                const params = new URLSearchParams(uri.query);
                const ctx = params.get('ctx');
                const fpath = params.get('path');
                if (!ctx || !fpath) return;

                log(`URI handler: open ${ctx}/${fpath}`);
                const fileUri = buildFileUri(ctx, fpath);
                const doc = await vscode.workspace.openTextDocument(fileUri);
                const editor = await vscode.window.showTextDocument(doc);

                const line = parseInt(params.get('line') ?? '1', 10) - 1;
                const col = parseInt(params.get('col') ?? '1', 10) - 1;
                const endLine = parseInt(params.get('endLine') ?? String(line + 1), 10) - 1;
                const endCol = parseInt(params.get('endCol') ?? String(col + 1), 10) - 1;

                const selection = new vscode.Selection(line, col, endLine, endCol);
                editor.selection = selection;
                editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
            },
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
