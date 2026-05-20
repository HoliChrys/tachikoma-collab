import * as vscode from 'vscode';
import { AuthManager } from '../auth/authManager';
import { ComposerPanel } from './composerPanel';
import { log } from '../log';

/**
 * Register the Cmd+I Composer.
 *
 * Wires the command `tachikoma.composer.open` (the Cmd+I keybinding
 * should be declared in package.json by the caller — this module does
 * not modify package.json or extension.ts).
 *
 * Returns a Disposable that disposes the underlying ComposerPanel and
 * the command registration. Push it onto `context.subscriptions`.
 */
export function registerComposer(
    context: vscode.ExtensionContext,
    authManager: AuthManager,
): vscode.Disposable {
    const composer = new ComposerPanel(authManager);

    const cmd = vscode.commands.registerCommand('tachikoma.composer.open', () => {
        log('Composer: open command invoked');
        composer.open();
    });

    const disposable: vscode.Disposable = {
        dispose: () => {
            cmd.dispose();
            composer.dispose();
        },
    };

    context.subscriptions.push(disposable);
    log('Composer: registered tachikoma.composer.open');
    return disposable;
}

export { ComposerPanel } from './composerPanel';
