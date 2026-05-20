import * as vscode from 'vscode';
import type { AuthManager } from '../auth/authManager';
import type { ContextStore } from '../store/contextStore';
import { log, logError } from '../log';
import { openContextSwitcher } from './contextSwitcher';

export const COMMAND_QUICK_SWITCH = 'tachikoma.context.quickSwitch';

/**
 * Register the Tachikoma context quick switcher with VS Code.
 *
 * Wires up `tachikoma.context.quickSwitch` to launch the QuickPick UI in
 * `./contextSwitcher.ts`. The caller (extension.ts) is responsible for
 * pushing the returned Disposable to its subscriptions so the command is
 * unregistered on deactivate.
 *
 * Keybinding: Cmd+Shift+H (mac) / Ctrl+Shift+H (linux+win). The binding
 * itself lives in package.json so it is gated by `tachikoma:connected`
 * without us needing to listen for connect/disconnect here.
 */
export function registerContextSwitcher(
    context: vscode.ExtensionContext,
    authManager: AuthManager,
    contextStore: ContextStore,
): vscode.Disposable {
    const disposable = vscode.commands.registerCommand(COMMAND_QUICK_SWITCH, async () => {
        try {
            await openContextSwitcher(context, authManager, contextStore);
        } catch (err) {
            logError('ContextSwitcher: command handler failed', err);
            vscode.window.showErrorMessage('Tachikoma: context switcher failed — see logs.');
        }
    });

    log('ContextSwitcher: registered tachikoma.context.quickSwitch');
    return disposable;
}

export { openContextSwitcher };
