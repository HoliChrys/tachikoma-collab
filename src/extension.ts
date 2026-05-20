import * as vscode from 'vscode';
import * as os from 'os';
import { AuthManager } from './auth/authManager';
import { ConnectionStatusItem } from './auth/connectionStatusItem';
import { ContextStore } from './store/contextStore';
import { ContextTreeProvider } from './hierarchy/contextTreeProvider';
import { CacheManager } from './cache/cacheManager';
import { CollaborationManager } from './collaborative/collaborationManager';
import { CollaboratorsProvider } from './collaborative/collaboratorsProvider';
import { SessionsProvider, type SessionEntry, type ZellijEntry } from './sessions/sessionsProvider';
import { attachZellijSession, attachTmuxSession } from './sessions/sessionAttacher';
import { TerminalTracker } from './terminals/terminalTracker';
import { TerminalStateSync } from './terminals/terminalStateSync';
import { replayTerminals } from './terminals/terminalReplay';
import { log, getOutputChannel } from './log';
import { openLocalTerminalPanel } from './terminal/terminalPanel';
import { registerZellijProfileProvider } from './terminal/zellijProfile';
import { registerTachikomaChatParticipant } from './chat/chatParticipant';
import { initRunner } from './runner';
import { AgentsTreeProvider } from './agents/agentsView';
import { registerAgentCommands } from './agents/swarmCommands';
import { registerComposer } from './composer';
import { initFloatingPanes } from './floating';
import { registerInlineCompletions } from './inline';
import { NativeMcpSettingsProvider } from './copilot/nativeMcpSettings';
import { McpProfileStore } from './store/mcpProfileStore';
import { McpProfileSseBridge } from './store/mcpProfileSseBridge';
import { McpCopilotTreeProvider } from './copilot/treeProvider';
import { registerMcpStatusBar } from './copilot/statusbar';
import { CopilotWebviewProvider } from './copilot/webview';
import type { ContextNode } from './types';

export async function activate(context: vscode.ExtensionContext) {
    log('Tachikoma extension activating...');

    const authManager = new AuthManager();
    const connectionStatusItem = new ConnectionStatusItem(authManager);
    context.subscriptions.push(connectionStatusItem);
    const store = new ContextStore(context.globalState);
    const contextTree = new ContextTreeProvider();
    const collabManager = new CollaborationManager();
    const collaboratorsProvider = new CollaboratorsProvider();
    const sessionsProvider = new SessionsProvider();

    let cacheManager: CacheManager | null = null;

    // Terminal persistence — tracks vscode.Terminals opened by the extension
    const terminalTracker = new TerminalTracker();
    let terminalSync: TerminalStateSync | null = null;
    context.subscriptions.push(terminalTracker);

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

    // ── MCP Copilot wiring (E5+) ──────────────────────────────────────
    // Store + SSE bridge are created up-front but only start after
    // `tachikoma.connect`. The 3 surfaces (statusbar, tree, webview)
    // register here so they're visible immediately and react to the
    // store's `onDidChange` events.
    let mcpProfileStore: McpProfileStore | null = null;
    let mcpProfileSseBridge: McpProfileSseBridge | null = null;
    let mcpCopilotTree: McpCopilotTreeProvider | null = null;
    let copilotWebviewProvider: CopilotWebviewProvider | null = null;

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

    // Let authManager read the live active contexts at any time (token
    // refresh, status bar update, getMcpSession command) without taking a
    // hard dependency on the store.
    authManager.setActiveContextsProvider(() => store.getActiveContextPaths());

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

        // MCP Copilot — first connect creates the store + UI surfaces,
        // subsequent reconnects just refresh state in place.
        if (!mcpProfileStore) {
            mcpProfileStore = new McpProfileStore(client);
            mcpProfileSseBridge = new McpProfileSseBridge(client, mcpProfileStore);
            mcpCopilotTree = new McpCopilotTreeProvider(mcpProfileStore);
            copilotWebviewProvider = new CopilotWebviewProvider(
                context, client, mcpProfileStore,
            );
            context.subscriptions.push(
                vscode.window.registerTreeDataProvider(
                    'tachikomaMcpCopilot', mcpCopilotTree,
                ),
                vscode.window.registerWebviewViewProvider(
                    CopilotWebviewProvider.viewType, copilotWebviewProvider,
                ),
            );
            // VI-1e : native MCP settings webview (alternative to iframe fallback)
            try {
                const nativeMcpProvider = new NativeMcpSettingsProvider(context, client, mcpProfileStore);
                context.subscriptions.push(
                    vscode.window.registerWebviewViewProvider('tachikomaMcpSettings', nativeMcpProvider),
                );
            } catch (err) {
                log(`Native MCP settings registration failed: ${(err as Error).message}`);
            }
            registerMcpStatusBar(context, mcpProfileStore);
        }
        try {
            await mcpProfileStore.refresh(userId);
            mcpProfileSseBridge?.start();
        } catch (err) {
            log(`MCP profile init failed (non-blocking): ${err}`);
        }

        // Create cache manager — local mirror of the server monorepo
        cacheManager = new CacheManager(hostUrl, userId);
        cacheManager.connect(client);

        // Wire SSE file events to cache sync
        store.onFileEvent(async (evt) => {
            await cacheManager?.handleServerFileEvent(evt);
        });

        // Register computer + tag client with machine_id so every request
        // carries the X-Machine-Id header (origin policy on server side).
        try {
            await client.registerComputer({
                machine_id: machineId, hostname: os.hostname(),
                name: `${os.hostname()} (VS Code)`, node_type: 'local',
                os_type: os.platform(), os_version: os.release(),
            });
            client.setMachineId(machineId);
            log(`Computer registered: ${machineId}`);
        } catch (err) { log(`Computer register failed (non-blocking): ${err}`); }

        // Health check: ping every 30s, tolerate 2 failures before marking stale.
        // Avoids flapping participant_joined/left on transient network blips.
        let failureCount = 0;
        let serverWasDown = false;
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(async () => {
            try {
                await client.me();
                client.computerHeartbeat(machineId).catch(() => {});
                failureCount = 0;
                if (serverWasDown) {
                    serverWasDown = false;
                    log('Server back online — resyncing (collab kept alive)');
                    authManager.setSyncState('syncing');
                    await store.init(client, userId);
                    // Don't disconnect/reconnect collabManager — just re-broadcast
                    // participant_joined for open docs so we re-appear in collaborators.
                    if (config.get<boolean>('autoCollab', true)) {
                        for (const doc of vscode.workspace.textDocuments) {
                            const ctx = contextFromUri(doc.uri);
                            if (ctx) {
                                void collabManager.startCollaborating(doc).catch(() => {});
                            }
                        }
                    }
                    authManager.setSyncState('synced');
                }
            } catch {
                failureCount++;
                // Tolerate 2 failures (~60s) before marking stale to avoid flapping
                if (failureCount >= 2 && !serverWasDown) {
                    serverWasDown = true;
                    log(`Server unreachable after ${failureCount} pings — marking stale`);
                    authManager.setSyncState('stale');
                }
            }
        }, 30_000);

        void offerLocalDaemon(client);

        await store.init(client, userId);

        // Start watching local cache for changes → push to server
        cacheManager.startWatching();

        // Terminal persistence: sync + replay if config enabled
        if (config.get<boolean>('terminals.persist', true)) {
            // Sync local tracker state with backend (REST + SSE)
            const fileEventBus = new (await import('./collaborative/sseClient')).EventBus({
                token: client.getToken() ?? '', baseUrl: client.baseUrl,
            });
            terminalSync = new TerminalStateSync(terminalTracker, machineId);
            terminalSync.start(client, fileEventBus);

            // Replay previously-tracked terminals
            if (config.get<boolean>('terminals.autoReplayOnConnect', true)) {
                try {
                    const remote = await client.getTerminalsState();
                    if (remote.length > 0) {
                        const result = await replayTerminals(remote, terminalTracker, client, {
                            machineId,
                            crossMachine: config.get<boolean>('terminals.crossMachineReplay', false),
                        });
                        log(`Terminal replay: ${result.replayed} restored, ${result.skipped} skipped, ${result.failed} failed`);
                    }
                } catch (err) {
                    log(`Terminal replay skipped: ${err}`);
                }
            }
        }

        // Surface the Tachikoma activity bar and focus the Contexts tree
        // so the user immediately sees the monorepo after connecting.
        try {
            await vscode.commands.executeCommand(
                'workbench.view.extension.tachikomaExplorer',
            );
            await vscode.commands.executeCommand(
                'tachikomaContextTree.focus',
            );
        } catch (err) {
            log(`Auto-focus tachikomaContextTree failed (non-fatal): ${err}`);
        }
    });

    authManager.onDidDisconnect(() => {
        log('Auth disconnected — cleaning up');
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
        if (localDaemonTerminal) { localDaemonTerminal.dispose(); localDaemonTerminal = null; }
        // Stop terminal sync, optionally kill tracked terminals
        terminalSync?.stop();
        terminalSync = null;
        if (config.get<boolean>('terminals.killOnDisconnect', true)) {
            terminalTracker.killAll();
        }
        cacheManager?.disconnect();
        contextTree.setClient(null);
        sessionsProvider.setClient(null);
        collabManager.disconnect();
        mcpProfileSseBridge?.stop();
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('tachikoma.connect', () => authManager.connect(context)),
        vscode.commands.registerCommand('tachikoma.connectWithToken', async () => {
            const host = await vscode.window.showInputBox({
                prompt: 'Tachikoma monorepo endpoint',
                placeHolder: 'http://dev-005:8000 or https://tachikoma.sh',
                value: 'http://dev-005:8000',
                ignoreFocusOut: true,
            });
            if (!host) return;
            const token = await vscode.window.showInputBox({
                prompt: `Paste your Tachikoma API token for ${host}`,
                password: true,
                placeHolder: 'Token from the Tachikoma CLI or dashboard',
                ignoreFocusOut: true,
                validateInput: (v) => v.length < 16 ? 'Token too short' : null,
            });
            if (!token) return;
            await authManager.connectWithToken(context, host, token);
        }),
        vscode.commands.registerCommand('tachikoma.disconnect', () => authManager.disconnect(context)),
        vscode.commands.registerCommand('tachikoma.showOutput', () => getOutputChannel().show(true)),

        // ── MCP Copilot commands (E5+) ────────────────────────────
        vscode.commands.registerCommand('tachikoma.copilot.open', () => {
            vscode.commands.executeCommand(
                'workbench.view.extension.tachikomaExplorer',
            );
            vscode.commands.executeCommand('tachikomaCopilot.focus');
        }),
        vscode.commands.registerCommand('tachikoma.mcp.selectProfile', async () => {
            if (!mcpProfileStore) {
                vscode.window.showWarningMessage('Connect to tachikoma first');
                return;
            }
            const profiles = mcpProfileStore.getProfiles();
            const active = mcpProfileStore.getActiveProfileId();
            const items: vscode.QuickPickItem[] = [
                {
                    label: '$(circle-outline) (union — all granted)',
                    description: active ? '' : 'current',
                    detail: 'Use every capability the user holds across all granted profiles',
                },
                ...profiles.map(p => ({
                    label: `${p.icon || '$(symbol-method)'} ${p.display_name || p.profile_name}`,
                    description: p.id === active ? 'current' : '',
                    detail: `${p.capabilities?.length ?? 0} capabilities — ${p.description || p.profile_name}`,
                })),
            ];
            const pick = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select an MCP profile (current applies until you switch)',
            });
            if (!pick) return;
            const idx = items.indexOf(pick);
            const target = idx === 0 ? '' : profiles[idx - 1].id;
            try {
                await mcpProfileStore.setActive(target);
                vscode.window.showInformationMessage(
                    target
                        ? `MCP profile: ${profiles[idx - 1].display_name || profiles[idx - 1].profile_name}`
                        : 'MCP profile: union (cleared)',
                );
            } catch (err) {
                vscode.window.showErrorMessage(`Switch failed: ${err}`);
            }
        }),
        vscode.commands.registerCommand('tachikoma.mcp.clearActiveProfile', async () => {
            if (!mcpProfileStore) return;
            try {
                await mcpProfileStore.setActive('');
                vscode.window.showInformationMessage('MCP profile cleared (union mode)');
            } catch (err) {
                vscode.window.showErrorMessage(`Clear failed: ${err}`);
            }
        }),
        vscode.commands.registerCommand('tachikoma.mcp.refresh', async () => {
            if (!mcpProfileStore) return;
            const uid = authManager.getUserId();
            if (!uid) return;
            await mcpProfileStore.refresh(uid);
        }),
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
                await attachZellijSession({
                    client,
                    sessionId: node.sessionId,
                    sessionName: node.name,
                    isProtected: node.isProtected,
                    tracker: terminalTracker,
                    userId: authManager.getUserId() ?? 'unknown',
                    machineId,
                });
            } else if (node.kind === 'zellij') {
                // "Zellij Web" entry — attach a default session named after the context
                await attachZellijSession({ client, sessionId: node.parentCtxId, ctxId: node.parentCtxId });
            }
        }),
        vscode.commands.registerCommand('tachikoma.openZellij', async (node: ZellijEntry) => {
            const client = authManager.getClient();
            if (!client) return;
            await attachZellijSession({ client, sessionId: node.parentCtxId, ctxId: node.parentCtxId });
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
            terminalTracker.register(term, {
                kind: 'ssh-remote',
                machine_id: machineId,
                user_id: userId,
                context_path: ctxPath || 'global',
                title: ctxPath ? `ssh · ${ctxPath}` : 'ssh · tachikoma',
                shell_path: 'ssh',
                shell_args: ['-t', `${userId}@${host}`, `cd ${ctxDir} && exec $SHELL -l`],
                ssh_host: host,
                ssh_user: userId,
                ssh_cwd: ctxDir,
                auto_replay: true,
            });
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

    // VI-1g: Tachikoma (zellij) terminal profile -- spawns zellij attach
    // against the active context's zweb server. See src/terminal/zellijProfile.ts.
    registerZellijProfileProvider(context, authManager, store);

    // VI-1c : register runner contrib (WebTransport RPC for backend agent control)
    try {
        const runnerDisposable = initRunner(context, authManager);
        context.subscriptions.push(runnerDisposable);
    } catch (err) {
        log(`Runner registration failed: ${(err as Error).message}`);
    }

    // VI-1d : agents + swarms tree view + commands (404-tolerant)
    try {
        const agentsProvider = new AgentsTreeProvider(authManager);
        const agentsTreeView = vscode.window.createTreeView('tachikomaAgents', {
            treeDataProvider: agentsProvider,
        });
        const agentCommands = registerAgentCommands(authManager, () => agentsProvider.refresh());
        context.subscriptions.push(agentsTreeView, agentCommands, agentsProvider);
    } catch (err) {
        log(`Agents tree registration failed: ${(err as Error).message}`);
    }
    // VI-1d+ : Composer (Cmd+I)
    try {
        const composerDisposable = registerComposer(context, authManager);
        context.subscriptions.push(composerDisposable);
    } catch (err) {
        log(`Composer registration failed: ${(err as Error).message}`);
    }

    // VI-1f : floating panes IDE-side overlay (needs runner transport + computer_id)
    // Wired inside the auth flow because we need the active transport client and computerId.
    authManager.onDidConnect(async () => {
        try {
            // The runner contrib's transport is the source of truth for computer_id.
            // For now, derive computer_id from the same pattern : `vscode-${host}-${userId}`.
            const host = authManager.getHostUrl();
            const userId = authManager.getUserId();
            if (!host || !userId) return;
            const computerId = `vscode-${new URL(host).hostname}-${userId}`;
            // Lazy import the vendored transport to keep extension.ts free of direct dep.
            const { createTransport } = require('./runner/vendor/transport');
            const token = await context.secrets.get('tachikoma.token');
            if (!token) return;
            const transport = await createTransport({ baseUrl: host, token, autoReconnect: true });
            const disposable = await initFloatingPanes(transport, computerId, {
                emit: (action) => {
                    // Outbound bridge : POST the floating pane action to /api/runner/event
                    // (or whatever bridge the backend exposes - V2 wire-up).
                    log(`floating action ${action.type} pane=${action.pane_id}`);
                },
            });
            context.subscriptions.push(disposable);
        } catch (err) {
            log(`Floating panes init failed: ${(err as Error).message}`);
        }
    });

    // Always try to reconnect on activation if a session token is stored.
    // The token is valid for 24h and the refresh API extends it — session persists across reloads.
    log('Attempting to restore session from stored token...');
    // VI-1b Option C: register @tachikoma chat participant (VS Code 1.95+ chat API)
    try {
        const chatParticipant = registerTachikomaChatParticipant(context, authManager);
        context.subscriptions.push(chatParticipant);
    } catch (err) {
        log(`Chat participant registration failed: ${(err as Error).message}`);
    }

    void authManager.tryReconnect(context);

    context.subscriptions.push(authManager, store, collabManager, sessionsProvider, getOutputChannel());
    log('Tachikoma extension activated');
}

export function deactivate() {}
