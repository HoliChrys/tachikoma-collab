import * as vscode from 'vscode';
import type { AuthManager } from '../auth/authManager';
import { log, logError } from '../log';

/**
 * Phase 5 — Tab autocomplete (inline completions) backed by Tachikoma agents.
 *
 * The provider:
 *   - Reads `tachikoma.inlineCompletion.engine` ('tachikoma' | 'copilot' | 'off')
 *   - 'tachikoma' (default): POSTs the current line + 50 lines of context above
 *     to `/api/agent/completion`. If the endpoint 404s (not deployed yet) the
 *     provider returns null so VS Code doesn't show stale ghost text.
 *   - 'copilot' (V2): delegates to the GitHub Copilot inline completion command.
 *   - 'off': returns null immediately.
 *
 * The request is debounced 300 ms (key: doc.uri + position) so rapid typing
 * doesn't spam the backend, and cancellable via the provider token.
 */

type Engine = 'tachikoma' | 'copilot' | 'off';

interface CompletionResponse {
    /** The text to insert at the cursor. */
    text?: string;
    /** Optional model/agent identifier, surfaced in logs only. */
    model?: string;
}

const DEBOUNCE_MS = 300;
const CONTEXT_LINES_ABOVE = 50;
const REQUEST_TIMEOUT_MS = 5_000;

export class TachikomaInlineCompletionProvider
    implements vscode.InlineCompletionItemProvider {

    /** Set to false after a 404 so we stop hitting a non-existent endpoint
     * until the user reloads the window. Keeps the editor responsive. */
    private endpointAvailable: boolean = true;

    /** Tracks the latest pending request so debounced calls can supersede
     * earlier ones (per-document key). */
    private readonly pending: Map<string, { timer: ReturnType<typeof setTimeout>; abort: AbortController }> = new Map();

    constructor(private readonly authManager: AuthManager) {}

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[] | null> {
        const cfg = vscode.workspace.getConfiguration('tachikoma');
        const engine = (cfg.get<string>('inlineCompletion.engine') ?? 'tachikoma') as Engine;

        if (engine === 'off') {
            return null;
        }

        if (engine === 'copilot') {
            // V2 — let Copilot drive its own inline completion. Returning null
            // here lets the Copilot provider win the next request cycle.
            try {
                await vscode.commands.executeCommand('github.copilot.inlineCompletion');
            } catch (err) {
                logError('Copilot delegation failed', err);
            }
            return null;
        }

        // engine === 'tachikoma'
        if (!this.endpointAvailable) {
            return null;
        }
        if (!this.authManager.isConnected()) {
            return null;
        }

        const text = await this.debouncedFetch(document, position, token);
        if (!text || token.isCancellationRequested) {
            return null;
        }

        const range = new vscode.Range(position, position);
        return [new vscode.InlineCompletionItem(text, range)];
    }

    /** Debounce per (uri + line) so a fresh keystroke supersedes the in-flight
     * timer/request. Resolves to null when superseded or cancelled. */
    private debouncedFetch(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<string | null> {
        const key = `${document.uri.toString()}::${position.line}`;
        const existing = this.pending.get(key);
        if (existing) {
            clearTimeout(existing.timer);
            existing.abort.abort();
            this.pending.delete(key);
        }

        return new Promise<string | null>((resolve) => {
            const abort = new AbortController();
            const tokenSub = token.onCancellationRequested(() => {
                abort.abort();
                clearTimeout(timer);
                this.pending.delete(key);
                resolve(null);
            });

            const timer = setTimeout(async () => {
                this.pending.delete(key);
                try {
                    const text = await this.requestCompletion(document, position, abort.signal);
                    resolve(text);
                } catch (err) {
                    logError('inline completion request failed', err);
                    resolve(null);
                } finally {
                    tokenSub.dispose();
                }
            }, DEBOUNCE_MS);

            this.pending.set(key, { timer, abort });
        });
    }

    private async requestCompletion(
        document: vscode.TextDocument,
        position: vscode.Position,
        signal: AbortSignal,
    ): Promise<string | null> {
        const client = this.authManager.getClient();
        const host = this.authManager.getHostUrl();
        const token = client?.getToken();
        if (!client || !host || !token) {
            return null;
        }

        const startLine = Math.max(0, position.line - CONTEXT_LINES_ABOVE);
        const contextRange = new vscode.Range(startLine, 0, position.line, position.character);
        const contextText = document.getText(contextRange);
        const currentLine = document.lineAt(position.line).text;

        const payload = {
            context: contextText,
            current_line: currentLine,
            cursor_offset: position.character,
            language: document.languageId,
            uri: document.uri.toString(),
        };

        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        // Combine provider cancellation with our own timeout. AbortSignal.any
        // is available in modern Node — VS Code 1.75+ runs Node >= 18.
        const combined = AbortSignal.any([signal, timeout]);

        let resp: Response;
        try {
            resp = await fetch(`${host}/api/agent/completion`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
                signal: combined,
            });
        } catch (err) {
            // Network error or aborted — silent fallback to null.
            if ((err as { name?: string }).name !== 'AbortError') {
                logError('inline completion network error', err);
            }
            return null;
        }

        if (resp.status === 404) {
            log('inline completion: /api/agent/completion not deployed (404) — disabling until reload');
            this.endpointAvailable = false;
            return null;
        }
        if (!resp.ok) {
            log(`inline completion: ${resp.status} ${resp.statusText}`);
            return null;
        }

        let data: CompletionResponse;
        try {
            data = await resp.json() as CompletionResponse;
        } catch {
            return null;
        }

        const text = (data.text ?? '').trim();
        if (!text) {
            return null;
        }
        if (data.model) {
            log(`inline completion: ${text.length} chars from ${data.model}`);
        }
        return text;
    }

    /** Re-enable the endpoint — called when the user toggles engine or
     * reconnects, in case the backend has been deployed since. */
    resetEndpointAvailability(): void {
        this.endpointAvailable = true;
    }

    dispose(): void {
        for (const { timer, abort } of this.pending.values()) {
            clearTimeout(timer);
            abort.abort();
        }
        this.pending.clear();
    }
}
