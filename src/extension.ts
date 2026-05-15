import * as vscode from 'vscode';
import * as os from 'os';
import { AuthManager } from './auth/authManager';
import { ContextStore } from './store/contextStore';
import { ContextTreeProvider } from './hierarchy/contextTreeProvider';
import { CacheManager } from './cache/cacheManager';
import { CollaborationManager } from './collaborative/collaborationManager';
import { CollaboratorsProvider } from './collaborative/collaboratorsProvider';
import { SessionsProvider, type SessionEntry, type ZellijEntry } from './sessions/sessionsProvider';
import { attachZellijSession, attachTmuxSession } from './sessions/sessionAttacher';
import { log, getOutputChannel } from './log';
import { openLocalTerminalPanel } from './terminal/terminalPanel';
import type { ContextNode } from './types';

export async function activate(context: vscode.ExtensionContext) {
    log('Tachikoma extension activating...');

    const authManager = new AuthManager();
    const store = new ContextStore(context.globalState);
    const contextTree = new ContextTreeProvider();
    const collabManager = new CollaborationManager();
    const collaboratorsProvider = new CollaboratorsProvider();
    const sessionsProvider = new SessionsProvider();

    let cacheManager: CacheManager | null = null;

    contextTree.setStore(store);
    collaboratorsProvider.setStore(store);
    sessionsProvider.setStore(store);

    store.onSyncStateChanged((s) => authManager.setSyncState(s));

    const contextTreeView = vscode.window.createTreeView('tachikomaContextTree', {
        treeDataProvider: contextTree,
    });
    context.subscriptions.push(
        contextTreeView,
        vscode.window.registerTreeDataProvider('tachikomaCollaborators', collaboratorsProvider),
        vscode.window.registerTreeDataProvider('tachikomaSessions', sessionsProvider),
    );

    function contextFromUri(uri: vscode.Uri): string | undefined {
        if (uri.scheme === 'file' && cacheManager) {
            return cacheManager.localPathToContext(uri.fsPath)?.contextPath;
        }
        return undefined;
    }

    const config = vscode.workspace.getConfiguration('tachikoma');

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc) => {
            const ctx = contextFromUri(doc.uri);
            if (ctx) {
                store.activateContext(ctx);
                log(`Context activated: ${ctx}`);
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

    store.onDidChange(() => {
        authManager.writeMcpSession(store.getActiveContextPaths());
    });

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let localDaemonTerminal: vscode.Terminal | null = null;
    const machineId = `vscode-${os.hostname()}-${os.userInfo().username}`;
    const LOCAL_DAEMON_PORT = 9321;

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
        } catch { return false; }
    }

    async function startLocalDaemon(client: import('./api/tachikomaClient').TachikomaClient): Promise<void> {
        if (await checkLocalDaemon()) { log('Local daemon already running'); updateDaemonStatusBar(true); return; }
        const token = client.getToken() ?? '';
        const serverUrl = client.baseUrl;
        localDaemonTerminal = vscode.window.createTerminal({ name: 'Tachikoma Agent', hideFromUser: false });
        const repo = '~/sandbox/tachikoma';
        const cmds = [
            `if [ ! -d ${repo} ]; then`, `  git clone https://github.com/HoliChrys/tachikoma.git ${repo}`, `fi`,
            `cd ${repo} && git pull -q && pip install -e . -q 2>&1 | tail -3`,
            `python -m tachikoma.local --server '${serverUrl}' --token '${token}' --port ${LOCAL_DAEMON_PORT}`,
        ];
        for (const cmd of cmds) localDaemonTerminal.sendText(cmd);
        localDaemonTerminal.show(false);
        log('Local daemon: install check + start');
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 1000));
            if (await checkLocalDaemon()) { updateDaemonStatusBar(true); vscode.window.showInformationMessage('Tachikoma local agent started'); return; }
        }
        updateDaemonStatusBar(false);
    }

    async function stopLocalDaemon(): Promise<void> {
        if (localDaemonTerminal) { localDaemonTerminal.dispose(); localDaemonTerminal = null; }
        try { await fetch(`http://127.0.0.1:${LOCAL_DAEMON_PORT}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) }); } catch { /* ignore */ }
        updateDaemonStatusBar(false);
        log('Local daemon stopped');
    }

    async function offerLocalDaemon(client: import('./api/tachikomaClient').TachikomaClient): Promise<void> {
        const daemonUp = await checkLocalDaemon();
        updateDaemonStatusBar(daemonUp);
        if (daemonUp) { log('Local daemon detected on :' + LOCAL_DAEMON_PORT); return; }
        const answer = await vscode.window.showInformationMessage('Tachikoma local agent is not running. Start it?', 'Start agent', 'Skip');
        if (answer === 'Start agent') await startLocalDaemon(client);
    }

    authManager.onDidConnect(async (client) => {
        log('Auth connected — initializing store');
        const userId = authManager.getUserId() ?? 'unknown';
        const hostUrl = authManager.getHostUrl() ?? client.baseUrl;

        contextTree.setClient(client);
        sessionsProvider.setClient(client);
        collabManager.connect(client, userId, userId);

        // Create cache manager — local mirror of the server monorepo
        cacheManager = new CacheManager(hostUrl, userId);
        cacheManager.connect(client);

        // Wire SSE file events to cache sync
        store.onFileEvent(async (evt) => {
            await cacheManager?.handleServerFileEvent(evt);
        });

        // Register computer
        try {
            await client.registerComputer({
                machine_id: machineId, hostname: os.hostname(),
                name: `${os.hostname()} (VS Code)`, node_type: 'local',
                os_type: os.platform(), os_version: os.release(),
            });
            log(`Computer registered: ${machineId}`);
        } catch (err) { log(`Computer register failed (non-blocking): ${err}`); }

        // Health check: ping server every 30s, auto-resync on reconnect
        let serverWasDown = false;
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(async () => {
            try {
                await client.me();
                client.computerHeartbeat(machineId).catch(() => {});
                if (serverWasDown) {
                    serverWasDown = false;
                    log('Server back online — resyncing');
                    authManager.setSyncState('syncing');
                    await store.init(client, userId);
                    authManager.setSyncState('synced');
                }
            } catch {
                if (!serverWasDown) {
                    serverWasDown = true;
                    log('Server unreachable — marking stale');
                    authManager.setSyncState('stale');
                }
            }
        }, 30_000);

        void offerLocalDaemon(client);

        await store.init(client, userId);

        // Start watching local cache for changes → push to server
        cacheManager.startWatching();
    });

    authManager.onDidDisconnect(() => {
        log('Auth disconnected — cleaning up');
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
        if (localDaemonTerminal) { localDaemonTerminal.dispose(); localDaemonTerminal = null; }
        cacheManager?.disconnect();
        contextTree.setClient(null);
        sessionsProvider.setClient(null);
        collabManager.disconnect();
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('tachikoma.connect', () => authManager.connect(context)),
        vscode.commands.registerCommand('tachikoma.disconnect', () => authManager.disconnect(context)),
        vscode.commands.registerCommand('tachikoma.showOutput', () => getOutputChannel().show(true)),
        vscode.commands.registerCommand('tachikoma.getMcpSession', () => {
            const session = authManager.getMcpSession();
            if (!session) return null;
            return {
                ...session,
                sseUrl: `${session.host}/api/mcp/sse`,
                activeContexts: store.getActiveContextPaths(),
            };
        }),
        vscode.commands.registerCommand('tachikoma.toggleDaemon', async () => {
            const running = await checkLocalDaemon();
            if (running) { await stopLocalDaemon(); vscode.window.showInformationMessage('Tachikoma local agent stopped'); }
            else {
                const client = authManager.getClient();
                if (client) await startLocalDaemon(client);
                else vscode.window.showWarningMessage('Connect to tachikoma first');
            }
        }),
        vscode.commands.registerCommand('tachikoma.openLocalTerminal', async () => {
            const daemonUp = await checkLocalDaemon();
            if (!daemonUp) {
                vscode.window.showWarningMessage('Local agent not running. Start it first.');
                return;
            }
            const sessionId = `local-${Date.now().toString(36)}`;
            openLocalTerminalPanel({
                extensionUri: context.extensionUri,
                title: `Local Terminal`,
                sessionId,
            });
        }),

        // Open file from context tree → sync to cache then open local file
        vscode.commands.registerCommand('tachikoma.openRemoteFile', async (node: ContextNode) => {
            if (!node.contextPath || !node.fsPath || !cacheManager) return;
            await cacheManager.syncFile(node.contextPath, node.fsPath);
            const localPath = cacheManager.contextToLocalPath(node.contextPath, node.fsPath);
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(localPath));
            await vscode.window.showTextDocument(doc, { preview: true });
        }),

        vscode.commands.registerCommand('tachikoma.startCollaborating', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
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
            if (!client || !hostUrl || !token) { vscode.window.showErrorMessage('Not connected'); return; }
            if (node.kind === 'session' && node.sessionType === 'tmux') {
                attachTmuxSession({ extensionUri: context.extensionUri, hostUrl, token, sessionId: node.sessionId, sessionName: node.name });
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
        vscode.commands.registerCommand('tachikoma.refreshSessions', () => sessionsProvider.refresh()),

        // Open context as workspace folder → sync then add local cache dir
        vscode.commands.registerCommand('tachikoma.openInWorkspace', async (node?: ContextNode) => {
            if (!node?.path || !cacheManager) return;
            const ctxPath = node.contextPath ?? node.path;
            await cacheManager.syncContext(ctxPath);
            const localDir = cacheManager.contextToLocalPath(ctxPath);
            const uri = vscode.Uri.file(localDir);
            const name = `tachikoma: ${ctxPath}`;
            const existing = (vscode.workspace.workspaceFolders ?? []).find((f) => f.uri.fsPath === localDir);
            if (!existing) {
                vscode.workspace.updateWorkspaceFolders((vscode.workspace.workspaceFolders ?? []).length, 0, { uri, name });
            }
            store.activateContext(ctxPath);
        }),

        // SSH terminal to server
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

        // New file → create via API, sync to cache, open local
        vscode.commands.registerCommand('tachikoma.newFile', async (node?: ContextNode) => {
            const client = authManager.getClient();
            if (!client || !cacheManager) { vscode.window.showErrorMessage('Not connected'); return; }
            const ctxPath = node?.contextPath ?? node?.path;
            if (!ctxPath) { vscode.window.showWarningMessage('Select a context or folder first'); return; }
            const name = await vscode.window.showInputBox({ prompt: 'File name', placeHolder: 'example.ts' });
            if (!name) return;
            const parent = node?.type === 'folder' ? (node.subpath ?? '') : '';
            const fullPath = parent ? `${parent}/${name}` : name;
            try {
                await client.createFile(ctxPath, fullPath);
                await cacheManager.syncFile(ctxPath, fullPath);
                contextTree.refresh();
                const localPath = cacheManager.contextToLocalPath(ctxPath, fullPath);
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(localPath));
                await vscode.window.showTextDocument(doc);
            } catch (err) { vscode.window.showErrorMessage(`Failed to create file: ${err}`); }
        }),

        // New folder → create via API, create local dir
        vscode.commands.registerCommand('tachikoma.newFolder', async (node?: ContextNode) => {
            const client = authManager.getClient();
            if (!client || !cacheManager) { vscode.window.showErrorMessage('Not connected'); return; }
            const ctxPath = node?.contextPath ?? node?.path;
            if (!ctxPath) { vscode.window.showWarningMessage('Select a context or folder first'); return; }
            const name = await vscode.window.showInputBox({ prompt: 'Folder name', placeHolder: 'src' });
            if (!name) return;
            const parent = node?.type === 'folder' ? (node.subpath ?? '') : '';
            const fullPath = parent ? `${parent}/${name}` : name;
            try {
                await client.createDir(ctxPath, fullPath);
                const localDir = cacheManager.contextToLocalPath(ctxPath, fullPath);
                const fs = await import('fs');
                fs.mkdirSync(localDir, { recursive: true });
                contextTree.refresh();
            } catch (err) { vscode.window.showErrorMessage(`Failed to create folder: ${err}`); }
        }),

        // Delete → delete via API, delete local cache
        vscode.commands.registerCommand('tachikoma.deleteEntry', async (node?: ContextNode) => {
            const client = authManager.getClient();
            if (!client || !cacheManager) { vscode.window.showErrorMessage('Not connected'); return; }
            if (!node?.contextPath || !node.fsPath) return;
            const confirm = await vscode.window.showWarningMessage(`Delete "${node.name}"?`, { modal: true }, 'Delete');
            if (confirm !== 'Delete') return;
            try {
                await client.deleteEntry(node.contextPath, node.fsPath);
                const localPath = cacheManager.contextToLocalPath(node.contextPath, node.fsPath);
                const fs = await import('fs');
                if (fs.existsSync(localPath)) {
                    const stat = fs.statSync(localPath);
                    if (stat.isDirectory()) fs.rmSync(localPath, { recursive: true });
                    else fs.unlinkSync(localPath);
                }
                contextTree.refresh();
            } catch (err) { vscode.window.showErrorMessage(`Failed to delete: ${err}`); }
        }),

        vscode.commands.registerCommand('tachikoma.invalidateCache', async () => {
            await store.invalidateCache();
            vscode.window.showInformationMessage('Tachikoma cache invalidated and resynced');
        }),

        // Copy with reference — detect cache files and generate deep links
        vscode.commands.registerCommand('tachikoma.copyWithReference', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const doc = editor.document;
            const sel = editor.selection;
            const selectedText = doc.getText(sel);
            if (!selectedText) { vscode.window.showWarningMessage('No text selected'); return; }

            const uri = doc.uri;
            let filePath: string;
            let vsCodeLink: string;

            const cached = cacheManager?.localPathToContext(uri.fsPath);
            if (cached) {
                filePath = `${cached.contextPath}/${cached.filePath}`;
                const linkParams = new URLSearchParams({
                    ctx: cached.contextPath, path: cached.filePath,
                    line: String(sel.start.line + 1), col: String(sel.start.character + 1),
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
            const quoted = selectedText.split('\n').map((l) => `> ${l}`).join('\n');
            const ref = `${filePath}:${lineRef}\n${quoted}\n${vsCodeLink}`;
            await vscode.env.clipboard.writeText(ref);
            vscode.window.showInformationMessage(`Copied reference: ${filePath}:${lineRef}`);
        }),
    );

    // URI handler: deep links sync file to cache then open locally
    context.subscriptions.push(
        vscode.window.registerUriHandler({
            async handleUri(uri: vscode.Uri) {
                if (uri.path !== '/open') return;
                const params = new URLSearchParams(uri.query);
                const ctx = params.get('ctx');
                const fpath = params.get('path');
                if (!ctx || !fpath) return;

                log(`URI handler: open ${ctx}/${fpath}`);
                if (cacheManager) {
                    await cacheManager.syncFile(ctx, fpath);
                    const localPath = cacheManager.contextToLocalPath(ctx, fpath);
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(localPath));
                    const editor = await vscode.window.showTextDocument(doc);
                    const line = parseInt(params.get('line') ?? '1', 10) - 1;
                    const col = parseInt(params.get('col') ?? '1', 10) - 1;
                    const endLine = parseInt(params.get('endLine') ?? String(line + 1), 10) - 1;
                    const endCol = parseInt(params.get('endCol') ?? String(col + 1), 10) - 1;
                    const selection = new vscode.Selection(line, col, endLine, endCol);
                    editor.selection = selection;
                    editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
                }
            },
        }),
    );

    // SSH terminal profile — kept as an explicit option for remote shell access
    context.subscriptions.push(
        vscode.window.registerTerminalProfileProvider('tachikoma.remoteShell', {
            provideTerminalProfile(): vscode.ProviderResult<vscode.TerminalProfile> {
                const hostUrl = authManager.getHostUrl() ?? '';
                const userId = authManager.getUserId() ?? 'ubuntu';
                const host = hostUrl ? new URL(hostUrl).hostname : 'localhost';
                return new vscode.TerminalProfile({
                    name: 'Tachikoma Remote',
                    shellPath: 'ssh',
                    shellArgs: ['-t', `${userId}@${host}`, `cd /home/${userId}/tachikoma_monorepo && exec $SHELL -l`],
                    iconPath: new vscode.ThemeIcon('remote'),
                });
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
