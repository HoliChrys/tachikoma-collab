import * as vscode from 'vscode';
import * as os from 'os';
import { AuthManager } from './auth/authManager';
import { ContextStore } from './store/contextStore';
import { ContextTreeProvider } from './hierarchy/contextTreeProvider';
import { RemoteFileProvider, TACHIKOMA_SCHEME, buildFileUri } from './hierarchy/remoteFileProvider';
import { EventBus } from './collaborative/sseClient';
import { CollaborationManager } from './collaborative/collaborationManager';
import { CollaboratorsProvider } from './collaborative/collaboratorsProvider';
import { SessionsProvider, type SessionEntry, type ZellijEntry } from './sessions/sessionsProvider';
import { attachZellijSession, attachTmuxSession } from './sessions/sessionAttacher';
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

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let localDaemonTerminal: vscode.Terminal | null = null;
    const machineId = `vscode-${os.hostname()}-${os.userInfo().username}`;
    const LOCAL_DAEMON_PORT = 9321;

    // Status bar toggle button
    const daemonStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    daemonStatusBar.command = 'tachikoma.toggleDaemon';
    daemonStatusBar.tooltip = 'Toggle Tachikoma local agent';
    context.subscriptions.push(daemonStatusBar);

    function updateDaemonStatusBar(running: boolean) {
        if (running) {
            daemonStatusBar.text = '$(vm-active) Agent';
            daemonStatusBar.backgroundColor = undefined;
        } else {
            daemonStatusBar.text = '$(vm-outline) Agent';
            daemonStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        daemonStatusBar.show();
    }

    async function checkLocalDaemon(): Promise<boolean> {
        try {
            const resp = await fetch(`http://127.0.0.1:${LOCAL_DAEMON_PORT}/health`, { signal: AbortSignal.timeout(2000) });
            return resp.ok;
        } catch {
            return false;
        }
    }

    async function startLocalDaemon(client: import('./api/tachikomaClient').TachikomaClient): Promise<void> {
        if (await checkLocalDaemon()) {
            log('Local daemon already running');
            updateDaemonStatusBar(true);
            return;
        }

        const token = client.getToken() ?? '';
        const serverUrl = client.baseUrl;
        localDaemonTerminal = vscode.window.createTerminal({
            name: 'Tachikoma Agent',
            hideFromUser: false,
        });

        // Auto-install if needed, then run — zsh compatible
        const repo = '~/sandbox/tachikoma';
        const cmds = [
            // Step 1: check if module exists
            `if ! python -m tachikoma.local --help > /dev/null 2>&1; then`,
            `  echo "📦 Installing tachikoma agent..."`,
            `  if [ -d ${repo} ]; then`,
            `    cd ${repo} && git pull`,
            `  else`,
            `    git clone https://github.com/HoliChrys/tachikoma.git ${repo}`,
            `  fi`,
            `  cd ${repo} && pip install -e . 2>&1 | tail -5`,
            `  echo "✅ Installed"`,
            `fi`,
            // Step 2: run
            `python -m tachikoma.local --server '${serverUrl}' --token '${token}' --port ${LOCAL_DAEMON_PORT}`,
        ];

        for (const cmd of cmds) {
            localDaemonTerminal.sendText(cmd);
        }
        localDaemonTerminal.show(false);
        log('Local daemon: install check + start');

        // Poll until it's up
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 1000));
            if (await checkLocalDaemon()) {
                updateDaemonStatusBar(true);
                vscode.window.showInformationMessage('Tachikoma local agent started');
                return;
            }
        }
        updateDaemonStatusBar(false);
    }

    async function stopLocalDaemon(): Promise<void> {
        if (localDaemonTerminal) {
            localDaemonTerminal.dispose();
            localDaemonTerminal = null;
        }
        // Also try HTTP shutdown
        try {
            await fetch(`http://127.0.0.1:${LOCAL_DAEMON_PORT}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) });
        } catch { /* ignore */ }
        updateDaemonStatusBar(false);
        log('Local daemon stopped');
    }

    async function offerLocalDaemon(client: import('./api/tachikomaClient').TachikomaClient): Promise<void> {
        const daemonUp = await checkLocalDaemon();
        updateDaemonStatusBar(daemonUp);
        if (daemonUp) {
            log('Local daemon detected on :' + LOCAL_DAEMON_PORT);
            return;
        }

        const answer = await vscode.window.showInformationMessage(
            'Tachikoma local agent is not running. Start it?',
            'Start agent', 'Skip',
        );
        if (answer === 'Start agent') {
            await startLocalDaemon(client);
        }
    }

    authManager.onDidConnect(async (client) => {
        log('Auth connected — initializing store');
        const userId = authManager.getUserId() ?? 'unknown';

        contextTree.setClient(client);
        remoteFileProvider.setClient(client);
        sessionsProvider.setClient(client);
        collabManager.connect(client, userId, userId);

        // Wire file watching SSE for bidirectional sync
        const fileEventBus = new EventBus({ token: client.getToken() ?? '', baseUrl: client.baseUrl });
        remoteFileProvider.setEventBus(fileEventBus);
        remoteFileProvider.startWatching();

        // Register this VS Code instance as a local computer
        try {
            await client.registerComputer({
                machine_id: machineId,
                hostname: os.hostname(),
                name: `${os.hostname()} (VS Code)`,
                node_type: 'local',
                os_type: os.platform(),
                os_version: os.release(),
            });
            log(`Computer registered: ${machineId}`);

            // Heartbeat every 2 minutes
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            heartbeatInterval = setInterval(() => {
                client.computerHeartbeat(machineId).catch(() => {});
            }, 120_000);
        } catch (err) {
            log(`Computer register failed (non-blocking): ${err}`);
        }

        // Offer to start local daemon if not running
        void offerLocalDaemon(client);

        await store.init(client, userId);
    });

    authManager.onDidDisconnect(() => {
        log('Auth disconnected — cleaning up');
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
        if (localDaemonTerminal) { localDaemonTerminal.dispose(); localDaemonTerminal = null; }
        remoteFileProvider.setEventBus(null);
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
        vscode.commands.registerCommand('tachikoma.toggleDaemon', async () => {
            const running = await checkLocalDaemon();
            if (running) {
                await stopLocalDaemon();
                vscode.window.showInformationMessage('Tachikoma local agent stopped');
            } else {
                const client = authManager.getClient();
                if (client) {
                    await startLocalDaemon(client);
                } else {
                    vscode.window.showWarningMessage('Connect to tachikoma first');
                }
            }
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
            const client = authManager.getClient();
            const hostUrl = authManager.getHostUrl() ?? '';
            const token = client?.getToken() ?? '';
            if (!client || !hostUrl || !token) {
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
                await attachZellijSession({ client, sessionName: node.name });
            } else if (node.kind === 'zellij') {
                await attachZellijSession({ client, sessionName: node.parentCtxId, ctxId: node.parentCtxId });
            }
        }),
        vscode.commands.registerCommand('tachikoma.openZellij', async (node: ZellijEntry) => {
            const client = authManager.getClient();
            if (!client) return;
            await attachZellijSession({ client, sessionName: node.parentCtxId, ctxId: node.parentCtxId });
        }),
        vscode.commands.registerCommand('tachikoma.refreshSessions', () => {
            sessionsProvider.refresh();
        }),
        vscode.commands.registerCommand('tachikoma.openInWorkspace', async (node?: ContextNode) => {
            if (!node?.path) return;
            const ctxPath = node.contextPath ?? node.path;
            const uri = vscode.Uri.parse(`${TACHIKOMA_SCHEME}://tachikoma/?ctx=${encodeURIComponent(ctxPath)}`);
            const name = `tachikoma: ${ctxPath}`;
            const existing = (vscode.workspace.workspaceFolders ?? []).find(
                (f) => f.uri.scheme === TACHIKOMA_SCHEME && f.uri.query.includes(ctxPath),
            );
            if (!existing) {
                vscode.workspace.updateWorkspaceFolders(
                    (vscode.workspace.workspaceFolders ?? []).length, 0,
                    { uri, name },
                );
            }
            store.activateContext(ctxPath);
        }),
        vscode.commands.registerCommand('tachikoma.remoteTerminal', async (node?: ContextNode) => {
            const client = authManager.getClient();
            if (!client) { vscode.window.showErrorMessage('Not connected'); return; }
            const ctxPath = node?.contextPath ?? node?.path ?? '';
            const hostUrl = authManager.getHostUrl() ?? '';
            const host = hostUrl ? new URL(hostUrl).hostname : 'localhost';
            const userId = authManager.getUserId() ?? 'ubuntu';
            const ctxDir = ctxPath
                ? `/home/${userId}/tachikoma_monorepo/${ctxPath.replace(/\./g, '/')}`
                : `/home/${userId}/tachikoma_monorepo`;
            const term = vscode.window.createTerminal({
                name: ctxPath ? `ssh · ${ctxPath}` : 'ssh · tachikoma',
                shellPath: 'ssh',
                shellArgs: ['-t', `${userId}@${host}`, `cd ${ctxDir} && exec $SHELL -l`],
            });
            term.show();
        }),
        vscode.commands.registerCommand('tachikoma.newFile', async (node?: ContextNode) => {
            const client = authManager.getClient();
            if (!client) { vscode.window.showErrorMessage('Not connected'); return; }
            const ctxPath = node?.contextPath ?? node?.path;
            if (!ctxPath) { vscode.window.showWarningMessage('Select a context or folder first'); return; }
            const name = await vscode.window.showInputBox({ prompt: 'File name', placeHolder: 'example.ts' });
            if (!name) return;
            const parent = node?.type === 'folder' ? (node.subpath ?? '') : '';
            const fullPath = parent ? `${parent}/${name}` : name;
            try {
                await client.createFile(ctxPath, fullPath);
                contextTree.refresh();
                const uri = buildFileUri(ctxPath, fullPath);
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to create file: ${err}`);
            }
        }),
        vscode.commands.registerCommand('tachikoma.newFolder', async (node?: ContextNode) => {
            const client = authManager.getClient();
            if (!client) { vscode.window.showErrorMessage('Not connected'); return; }
            const ctxPath = node?.contextPath ?? node?.path;
            if (!ctxPath) { vscode.window.showWarningMessage('Select a context or folder first'); return; }
            const name = await vscode.window.showInputBox({ prompt: 'Folder name', placeHolder: 'src' });
            if (!name) return;
            const parent = node?.type === 'folder' ? (node.subpath ?? '') : '';
            const fullPath = parent ? `${parent}/${name}` : name;
            try {
                await client.createDir(ctxPath, fullPath);
                contextTree.refresh();
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to create folder: ${err}`);
            }
        }),
        vscode.commands.registerCommand('tachikoma.deleteEntry', async (node?: ContextNode) => {
            const client = authManager.getClient();
            if (!client) { vscode.window.showErrorMessage('Not connected'); return; }
            if (!node?.contextPath || !node.fsPath) return;
            const confirm = await vscode.window.showWarningMessage(
                `Delete "${node.name}"?`, { modal: true }, 'Delete',
            );
            if (confirm !== 'Delete') return;
            try {
                await client.deleteEntry(node.contextPath, node.fsPath);
                contextTree.refresh();
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to delete: ${err}`);
            }
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
