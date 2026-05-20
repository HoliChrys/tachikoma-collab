import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AuthManager } from '../auth/authManager';
import { log } from '../log';
import { TachikomaWelcomeProvider } from './tachikomaWelcome';

/**
 * Legacy boolean flag kept as a soft hint for backwards compatibility with
 * older installs. The authoritative trigger is now WELCOME_LAST_BUILD_KEY.
 */
const WELCOME_SHOWN_KEY = 'tachikoma.welcome.shown';

/**
 * Stores the build SHA of the IDE for which the welcome panel was last
 * auto-opened. When the current build's SHA differs (fresh DMG install,
 * upgrade, downgrade), the welcome panel re-opens once.
 */
const WELCOME_LAST_BUILD_KEY = 'tachikoma.welcome.lastBuild';

/**
 * Lazily read the IDE build SHA from
 * `<appRoot>/extensions/tachikoma-updater/build-info.json`.
 *
 * Returns `null` in dev builds where the file is absent or unreadable, so
 * callers can fall back to the legacy globalState boolean check.
 */
function readBuildSha(): string | null {
    try {
        const p = path.join(
            vscode.env.appRoot,
            'extensions/tachikoma-updater/build-info.json',
        );
        if (!fs.existsSync(p)) {
            return null;
        }
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw) as { commit?: string; shortCommit?: string };
        const sha = parsed.commit || parsed.shortCommit || null;
        if (typeof sha === 'string' && sha.length > 0 && sha !== 'unknown') {
            return sha;
        }
        return null;
    } catch (err) {
        log(`Welcome: build-info read failed: ${(err as Error).message}`);
        return null;
    }
}

/**
 * Register the Tachikoma welcome webview.
 *
 * Wires :
 *   - command `tachikoma.welcome.open` -> reveals the panel.
 *   - auto-open : the panel re-opens whenever the IDE build SHA (read from
 *     `extensions/tachikoma-updater/build-info.json`) differs from the SHA
 *     stored in `globalState[WELCOME_LAST_BUILD_KEY]`. After opening, the
 *     current SHA is persisted so subsequent activations on the same build
 *     stay silent. In dev builds where `build-info.json` is missing, we
 *     fall back to the legacy `WELCOME_SHOWN_KEY` boolean: open once, then
 *     stay silent forever (same behaviour as before).
 *
 * Returns a Disposable that disposes the underlying provider plus the
 * command registration. Push it onto `context.subscriptions`.
 */
export function registerTachikomaWelcome(
    context: vscode.ExtensionContext,
    authManager: AuthManager,
    contextsProvider?: () => string[],
): vscode.Disposable {
    const provider = new TachikomaWelcomeProvider(
        context,
        authManager,
        contextsProvider ?? (() => []),
    );

    const cmd = vscode.commands.registerCommand('tachikoma.welcome.open', () => {
        log('Welcome: open command invoked');
        provider.open();
    });

    const disposable: vscode.Disposable = {
        dispose: () => {
            cmd.dispose();
            provider.dispose();
        },
    };

    context.subscriptions.push(disposable);

    // Auto-open decision. Scheduled via setTimeout so the rest of extension.ts
    // can finish wiring (status bar, tree views, etc.) before the panel
    // materializes -- otherwise the panel can steal focus from late-binding
    // views.
    const currentSha = readBuildSha();
    const lastSha = context.globalState.get<string | undefined>(WELCOME_LAST_BUILD_KEY, undefined);
    const legacyShown = context.globalState.get<boolean>(WELCOME_SHOWN_KEY, false);

    let shouldAutoOpen: boolean;
    let reason: string;
    if (currentSha !== null) {
        // Production / DMG build: SHA comparison is authoritative.
        shouldAutoOpen = currentSha !== lastSha;
        reason = shouldAutoOpen
            ? `build SHA changed (${lastSha ?? 'none'} -> ${currentSha})`
            : `build SHA unchanged (${currentSha})`;
    } else {
        // Dev build: no build-info.json -> fall back to legacy boolean.
        shouldAutoOpen = !legacyShown;
        reason = shouldAutoOpen
            ? 'dev build, legacy flag unset'
            : 'dev build, legacy flag already set';
    }

    if (shouldAutoOpen) {
        setTimeout(() => {
            // Persist both flags so we don't re-open on the next activation.
            void context.globalState.update(WELCOME_SHOWN_KEY, true);
            if (currentSha !== null) {
                void context.globalState.update(WELCOME_LAST_BUILD_KEY, currentSha);
            }
            try {
                provider.open();
            } catch (err) {
                log(`Welcome: auto-open failed: ${(err as Error).message}`);
            }
        }, 200);
    }

    log(`Welcome: registered tachikoma.welcome.open (autoOpen=${shouldAutoOpen}, ${reason})`);
    return disposable;
}

export { TachikomaWelcomeProvider } from './tachikomaWelcome';
