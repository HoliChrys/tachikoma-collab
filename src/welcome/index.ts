import * as vscode from 'vscode';
import { AuthManager } from '../auth/authManager';
import { log } from '../log';
import { TachikomaWelcomeProvider } from './tachikomaWelcome';

/** Stable workspaceState key gating the auto-open on first activation. */
const WELCOME_SHOWN_KEY = 'tachikoma.welcome.shown';

/**
 * Register the Tachikoma welcome webview.
 *
 * Wires :
 *   - command `tachikoma.welcome.open` -> reveals the panel.
 *   - first-activation auto-open : if `workspaceState[WELCOME_SHOWN_KEY]`
 *     is not set, the panel is opened on the next event-loop tick and
 *     the flag is flipped so subsequent activations stay silent.
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

    // First-activation auto-open. Scheduled via setTimeout so the rest of
    // extension.ts can finish wiring (status bar, tree views, etc.) before
    // the panel materializes — otherwise the panel can steal focus from
    // late-binding views.
    const alreadyShown = context.globalState.get<boolean>(WELCOME_SHOWN_KEY, false);
    if (!alreadyShown) {
        setTimeout(() => {
            void context.globalState.update(WELCOME_SHOWN_KEY, true);
            try {
                provider.open();
            } catch (err) {
                log(`Welcome: auto-open failed: ${(err as Error).message}`);
            }
        }, 200);
    }

    log(`Welcome: registered tachikoma.welcome.open (autoOpen=${!alreadyShown})`);
    return disposable;
}

export { TachikomaWelcomeProvider } from './tachikomaWelcome';
