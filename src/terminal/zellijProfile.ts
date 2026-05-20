import * as vscode from 'vscode';
import type { AuthManager } from '../auth/authManager';
import type { ContextStore } from '../store/contextStore';
import { log, logError } from '../log';

/**
 * VI-1g: register the "Tachikoma (zellij)" terminal profile.
 *
 * Each new terminal opened via this profile spawns a zsh login shell that
 * runs `zellij attach https://session.zweb.{ctx}.tachikoma.sh/{session_id} --token {tok} --remember`
 * against the active context's zweb server (mirroring sessionAttacher.ts).
 *
 * Profile lookup logic:
 *   1. Find the deepest active context via ContextStore.getActiveContextPaths().
 *      If none, fall back to "global".
 *   2. Fetch web-info (port, token, url) for that context.
 *   3. Use the context id as the default session name so VS Code "+" creates
 *      a single zellij session per ctx (zellij --remember reattaches).
 *   4. Inject TACHIKOMA_* env vars into the spawned terminal so any tooling
 *      running inside the terminal can read context/user/token without
 *      re-prompting auth.
 *
 * If the user is not connected when the profile is invoked, we surface a
 * clear error via vscode.window.showErrorMessage and bail. We do NOT throw
 * from provideTerminalProfile because that yields an opaque "profile failed"
 * message in the VS Code UI.
 */
export function registerZellijProfileProvider(
    context: vscode.ExtensionContext,
    authManager: AuthManager,
    contextStore: ContextStore,
): void {
    context.subscriptions.push(
        vscode.window.registerTerminalProfileProvider('tachikoma.zellijSession', {
            async provideTerminalProfile(): Promise<vscode.TerminalProfile | undefined> {
                const client = authManager.getClient();
                if (!client) {
                    vscode.window.showErrorMessage(
                        'Tachikoma (zellij) terminal requires connection to a monorepo. Sign in first.',
                    );
                    return undefined;
                }

                // Pick the deepest currently active context, else fall back to "global".
                const active = contextStore.getActiveContextPaths();
                const ctxId = active.length > 0
                    ? active.slice().sort((a, b) => b.split('.').length - a.split('.').length)[0]
                    : 'global';

                const userId = authManager.getUserId() ?? 'unknown';
                const apiToken = client.getToken() ?? '';

                let zwToken = '';
                let serverUrl = '';
                try {
                    const webInfo = await client.getSessionWebInfo(ctxId);
                    zwToken = webInfo.token;
                    // Prefer the host's session_url when present (already canonicalized
                    // by backend); otherwise fall back to the conventional pattern.
                    const sessionName = ctxId.split('.').pop() || ctxId;
                    serverUrl = webInfo.session_url
                        ? `${webInfo.session_url.replace(/\/$/, '')}/${sessionName}`
                        : `https://session.zweb.${ctxId}.tachikoma.sh/${sessionName}`;
                } catch (err) {
                    logError(`zellijProfile: web-info fetch failed for ${ctxId}`, err);
                    vscode.window.showErrorMessage(
                        `Tachikoma (zellij): cannot reach zweb server for ${ctxId}. Is the session manager running?`,
                    );
                    return undefined;
                }

                const cmd = `zellij attach ${serverUrl} --token ${zwToken} --remember`;
                log(`zellijProfile: spawn ${cmd} (ctx=${ctxId}, user=${userId})`);

                return new vscode.TerminalProfile({
                    name: `Tachikoma (zellij) - ${ctxId}`,
                    shellPath: '/bin/zsh',
                    shellArgs: ['-l', '-c', cmd],
                    iconPath: new vscode.ThemeIcon('terminal'),
                    env: {
                        ZELLIJ_SOCKET_DIR: `/tmp/zellij-ctx/${ctxId}`,
                        TACHIKOMA_CTX: ctxId,
                        TACHIKOMA_USER_ID: userId,
                        TACHIKOMA_TOKEN: apiToken,
                    },
                });
            },
        }),
    );

    log('zellijProfile: registered tachikoma.zellijSession provider');
}
