import * as vscode from 'vscode';
import type { AuthManager } from '../auth/authManager';
import type { ContextStore } from '../store/contextStore';
import { log, logError } from '../log';

/**
 * Title of the zellij terminal profile as declared in package.json
 * (`contributes.terminal.profiles[].title`). VS Code resolves the
 * `terminal.integrated.defaultProfile.<os>` setting against this exact
 * string, so it must stay in sync with package.json.
 */
export const ZELLIJ_PROFILE_TITLE = 'Tachikoma (zellij)';

/** workspaceState key that stores the previous default profile so we
 *  can restore it on disconnect / deactivate even across reloads. */
const PREV_DEFAULT_KEY = 'tachikoma.terminal.previousDefaultProfile';

interface PreviousDefaults {
    linux: string | undefined;
    osx: string | undefined;
    windows: string | undefined;
}

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

/**
 * VI-1g: force the Tachikoma (zellij) profile as the default terminal
 * profile for the current workspace, only when an actual workspace is open.
 *
 * Writes `terminal.integrated.defaultProfile.{linux,osx,windows}` at
 * `ConfigurationTarget.Workspace` — NEVER Global — so user-level settings
 * remain untouched. The previous workspace-scoped value is saved in
 * `workspaceState` so it survives reloads (we restore it on disconnect or
 * extension deactivation).
 *
 * Returns a Disposable that restores the previous default. Safe to call
 * multiple times: the snapshot is only captured once per workspace and we
 * skip re-snapshotting if our profile is already the default (avoids
 * persisting our own value as the "previous").
 *
 * Users keep full freedom to override: the workspace setting is just a
 * default — picking another profile via "Select Default Profile" still
 * works as expected.
 */
export async function setDefaultTerminalProfile(
    context: vscode.ExtensionContext,
): Promise<vscode.Disposable> {
    // Only meaningful when a folder/workspace is actually open — writing
    // to Workspace target without one silently fails (or worse, no-ops
    // and then we can't restore). Bail with a no-op disposable.
    const hasWorkspace =
        (vscode.workspace.workspaceFolders?.length ?? 0) > 0 ||
        vscode.workspace.workspaceFile !== undefined;
    if (!hasWorkspace) {
        log('zellijProfile: no workspace open, skipping defaultProfile override');
        return { dispose: () => {} };
    }

    const cfg = vscode.workspace.getConfiguration('terminal.integrated');

    // Read what's currently set at the WORKSPACE level (not effective value)
    // so we can distinguish "user-configured workspace default" from
    // "inherited from user/global settings".
    const current = cfg.inspect<string>('defaultProfile.linux');
    const currentOsx = cfg.inspect<string>('defaultProfile.osx');
    const currentWin = cfg.inspect<string>('defaultProfile.windows');

    // Snapshot only if (a) we haven't already snapshotted, and (b) the
    // workspace value isn't already ours (avoids overwriting a legitimate
    // previous after a partial-reload race).
    const existing = context.workspaceState.get<PreviousDefaults>(PREV_DEFAULT_KEY);
    if (!existing) {
        const snapshot: PreviousDefaults = {
            linux: current?.workspaceValue,
            osx: currentOsx?.workspaceValue,
            windows: currentWin?.workspaceValue,
        };
        // Only snapshot if the workspace value isn't already our profile,
        // otherwise we'd memoize ourselves as "previous" forever.
        if (snapshot.linux !== ZELLIJ_PROFILE_TITLE) {
            await context.workspaceState.update(PREV_DEFAULT_KEY, snapshot);
            log(`zellijProfile: snapshotted previous default profile: ${JSON.stringify(snapshot)}`);
        }
    }

    try {
        await cfg.update('defaultProfile.linux', ZELLIJ_PROFILE_TITLE, vscode.ConfigurationTarget.Workspace);
        await cfg.update('defaultProfile.osx', ZELLIJ_PROFILE_TITLE, vscode.ConfigurationTarget.Workspace);
        // We don't ship a windows shell wrapper for zellij yet; leave windows alone.
        log(`zellijProfile: defaultProfile -> "${ZELLIJ_PROFILE_TITLE}" (workspace)`);
    } catch (err) {
        logError('zellijProfile: failed to set default terminal profile', err);
    }

    return {
        dispose: () => {
            void restoreDefaultTerminalProfile(context).catch((err) =>
                logError('zellijProfile: restore on dispose failed', err),
            );
        },
    };
}

/**
 * Restore the workspace `defaultProfile.{linux,osx}` to whatever was
 * snapshotted in `workspaceState` before we forced our profile.
 *
 * Behaviour:
 *   - Only acts if a snapshot exists (i.e. we were the one who set it).
 *   - Only acts if the current workspace value is still our profile
 *     (don't clobber a manual user override done since).
 *   - Passing `undefined` to `cfg.update` removes the workspace-scoped
 *     entry, restoring inheritance from user/global settings.
 *   - Idempotent: clears the snapshot key after restoring.
 */
export async function restoreDefaultTerminalProfile(
    context: vscode.ExtensionContext,
): Promise<void> {
    const snapshot = context.workspaceState.get<PreviousDefaults>(PREV_DEFAULT_KEY);
    if (!snapshot) return;

    const cfg = vscode.workspace.getConfiguration('terminal.integrated');
    const currentLinux = cfg.inspect<string>('defaultProfile.linux')?.workspaceValue;
    const currentOsx = cfg.inspect<string>('defaultProfile.osx')?.workspaceValue;

    try {
        // Only restore if WE are still the active default; otherwise the user
        // changed it manually and we should leave their choice alone.
        if (currentLinux === ZELLIJ_PROFILE_TITLE) {
            await cfg.update('defaultProfile.linux', snapshot.linux, vscode.ConfigurationTarget.Workspace);
        }
        if (currentOsx === ZELLIJ_PROFILE_TITLE) {
            await cfg.update('defaultProfile.osx', snapshot.osx, vscode.ConfigurationTarget.Workspace);
        }
        log(`zellijProfile: restored default profile to ${JSON.stringify(snapshot)}`);
    } catch (err) {
        logError('zellijProfile: failed to restore default terminal profile', err);
    } finally {
        await context.workspaceState.update(PREV_DEFAULT_KEY, undefined);
    }
}
