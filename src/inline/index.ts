import * as vscode from 'vscode';
import type { AuthManager } from '../auth/authManager';
import { TachikomaInlineCompletionProvider } from './tachikomaInlineProvider';
import { log } from '../log';

/**
 * Phase 5 — registers the Tachikoma inline completion provider for every
 * document (selector `{ pattern: '**' }`) and reacts to runtime changes of
 * `tachikoma.inlineCompletion.engine`.
 *
 * Returned Disposable disposes the provider, the config listener, and the
 * VS Code registration.
 *
 * IMPORTANT — wiring is the responsibility of `src/extension.ts`. This module
 * only exposes the entry-point; no side effects at import time.
 */
export function registerInlineCompletions(
    context: vscode.ExtensionContext,
    authManager: AuthManager,
): vscode.Disposable {
    const provider = new TachikomaInlineCompletionProvider(authManager);

    const registration = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        provider,
    );

    // When the user flips the engine setting (e.g. 'off' -> 'tachikoma'), give
    // the provider a chance to retry the endpoint even if a previous 404
    // disabled it for this session.
    const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('tachikoma.inlineCompletion.engine')) {
            const engine = vscode.workspace
                .getConfiguration('tachikoma')
                .get<string>('inlineCompletion.engine') ?? 'tachikoma';
            log(`inlineCompletion.engine -> ${engine}`);
            provider.resetEndpointAvailability();
        }
    });

    // Also reset when (re)connecting — backend may have been deployed since
    // the last 404.
    const connSub = authManager.onDidConnect(() => {
        provider.resetEndpointAvailability();
    });

    const composite = vscode.Disposable.from(registration, cfgSub, connSub, provider);
    context.subscriptions.push(composite);
    log('Tachikoma inline completions registered for **');
    return composite;
}
