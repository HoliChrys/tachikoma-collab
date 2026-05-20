import * as vscode from 'vscode';
import { AuthManager } from '../auth/authManager';
import { log } from '../log';

/**
 * Composer — Cmd+I spotlight-style prompt for talking to the Tachikoma
 * agent without opening the chat panel.
 *
 * Implementation choice (V1):
 *   VS Code extensions cannot float a webview at an arbitrary screen
 *   position attached to `.monaco-workbench` — webview panels are always
 *   docked in editor groups and webview views live in side panels. The
 *   closest native primitive that "floats", supports ESC-to-close, and
 *   captures focus instantly is the QuickInput API (`createInputBox`).
 *
 *   The CSS file `composerStyle.css` documents the target visual design
 *   (rounded-full, glass smoke, gradient orb). A future V2 webview-based
 *   variant can render that style inside a non-editor webview-panel.
 *
 * Flow on Enter :
 *   1. Capture prompt + active editor URI + selection text.
 *   2. Call `client.sendChatMessage(prompt, contextPath)`.
 *   3. Subscribe to user chat SSE stream until `agent.response` /
 *      `agent.error` (or 60s timeout).
 *   4. Display the result via `vscode.window.showInformationMessage`
 *      (V1). Inline ghost-text in the editor is V2.
 */
export class ComposerPanel {
    private inputBox: vscode.InputBox | null = null;
    private busy = false;

    constructor(private readonly authManager: AuthManager) { }

    /** Show the composer. Called by the registered command. */
    open(): void {
        if (this.inputBox) {
            this.inputBox.show();
            return;
        }

        const input = vscode.window.createInputBox();
        input.title = 'Tachikoma Composer';
        input.placeholder = 'Talk to the agent... (Shift+Enter newline, Enter send, ESC close)';
        input.prompt = this.buildContextHint();
        input.ignoreFocusOut = false;
        input.busy = false;

        input.onDidAccept(() => {
            const text = input.value.trim();
            if (!text || this.busy) return;
            void this.send(text);
        });

        input.onDidHide(() => {
            input.dispose();
            this.inputBox = null;
            this.busy = false;
        });

        this.inputBox = input;
        input.show();
    }

    private buildContextHint(): string {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return 'No active file — prompt only';
        const fileName = editor.document.fileName.split('/').pop() ?? '';
        const sel = editor.selection;
        if (sel.isEmpty) {
            return `Context: ${fileName} (line ${sel.active.line + 1})`;
        }
        const lines = sel.end.line - sel.start.line + 1;
        return `Context: ${fileName} (${lines} line${lines === 1 ? '' : 's'} selected)`;
    }

    private async send(prompt: string): Promise<void> {
        if (!this.authManager.isConnected()) {
            vscode.window.showWarningMessage('Tachikoma not connected — run "Tachikoma: Connect" first.');
            return;
        }
        const client = this.authManager.getClient();
        const userId = this.authManager.getUserId();
        if (!client || !userId) {
            vscode.window.showWarningMessage('No user context — reconnect to Tachikoma.');
            return;
        }

        const editor = vscode.window.activeTextEditor;
        const selectionText = editor && !editor.selection.isEmpty
            ? editor.document.getText(editor.selection)
            : '';
        const filePath = editor ? editor.document.uri.fsPath : '';
        const enrichedPrompt = this.enrichPrompt(prompt, filePath, selectionText);

        this.busy = true;
        if (this.inputBox) {
            this.inputBox.busy = true;
            this.inputBox.enabled = false;
        }

        try {
            const ack = await client.sendChatMessage(enrichedPrompt, '');
            log(`Composer: ack ${ack.message_id} status=${ack.status}`);

            if (ack.status === 'completed' && ack.action) {
                vscode.window.showInformationMessage(`Tachikoma: action \`${ack.action}\` completed.`);
                this.dismiss();
                return;
            }
            if (ack.status === 'unknown_action') {
                vscode.window.showWarningMessage(`Tachikoma: unknown action \`${ack.action ?? ''}\`.`);
                this.dismiss();
                return;
            }

            await this.awaitResponse(client, userId, ack.message_id);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Tachikoma error: ${msg}`);
        } finally {
            this.busy = false;
            if (this.inputBox) {
                this.inputBox.busy = false;
                this.inputBox.enabled = true;
            }
        }
    }

    private enrichPrompt(prompt: string, filePath: string, selection: string): string {
        const parts: string[] = [prompt];
        if (filePath) {
            parts.push(`\n\n[file: ${filePath}]`);
        }
        if (selection) {
            const trimmed = selection.length > 2000 ? selection.slice(0, 2000) + '...' : selection;
            parts.push(`\n[selection]\n${trimmed}`);
        }
        return parts.join('');
    }

    private async awaitResponse(
        client: NonNullable<ReturnType<AuthManager['getClient']>>,
        userId: string,
        targetMessageId: string,
    ): Promise<void> {
        const collected: string[] = [];
        let errorText: string | null = null;
        let finished = false;
        let resolveEnd: () => void = () => { };
        const ended = new Promise<void>((r) => { resolveEnd = r; });

        const sub = client.subscribeUserChatSse(userId, (evt) => {
            const ty = String(evt.type ?? '');
            const evtMsgId = (evt as { message_id?: string }).message_id;
            if (evtMsgId && targetMessageId && evtMsgId !== targetMessageId) return;
            const content = String(evt.content ?? evt.message ?? '');
            if (ty === 'agent.message' && content) {
                collected.push(content);
            } else if (ty === 'agent.response') {
                if (content) collected.push(content);
                finished = true;
                resolveEnd();
            } else if (ty === 'agent.error') {
                errorText = String(evt.error ?? evt.content ?? 'unknown');
                finished = true;
                resolveEnd();
            }
        });

        const timeout = setTimeout(() => {
            if (!finished) {
                log('Composer: SSE wait timed out');
                resolveEnd();
            }
        }, 60_000);

        try {
            await ended;
        } finally {
            clearTimeout(timeout);
            sub.dispose();
        }

        if (errorText) {
            vscode.window.showErrorMessage(`Tachikoma: ${errorText}`);
        } else if (collected.length > 0) {
            const full = collected.join('\n\n');
            const preview = full.length > 200 ? full.slice(0, 200) + '...' : full;
            const choice = await vscode.window.showInformationMessage(
                `Tachikoma: ${preview}`,
                'Show full',
            );
            if (choice === 'Show full') {
                const doc = await vscode.workspace.openTextDocument({
                    content: full,
                    language: 'markdown',
                });
                await vscode.window.showTextDocument(doc, { preview: true });
            }
            this.dismiss();
        } else {
            vscode.window.showInformationMessage('Tachikoma: no response (timeout).');
        }
    }

    private dismiss(): void {
        if (this.inputBox) {
            this.inputBox.hide();
        }
    }

    dispose(): void {
        this.inputBox?.dispose();
        this.inputBox = null;
    }
}
