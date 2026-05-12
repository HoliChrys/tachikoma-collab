import * as vscode from 'vscode';
import type { AwarenessState } from '../types';
import { DecorationManager } from './decorationManager';

export class AwarenessManager implements vscode.Disposable {
    private decorationManager = new DecorationManager();
    private remoteStates = new Map<string, AwarenessState>();
    private broadcastThrottle: ReturnType<typeof setTimeout> | null = null;
    private selectionListener: vscode.Disposable;
    private localUserId: string;
    private localUserName: string;
    private localColor: string;

    private readonly _onLocalAwarenessChanged = new vscode.EventEmitter<AwarenessState>();
    readonly onLocalAwarenessChanged = this._onLocalAwarenessChanged.event;

    constructor(userId: string, userName: string, color: string) {
        this.localUserId = userId;
        this.localUserName = userName;
        this.localColor = color;

        this.selectionListener = vscode.window.onDidChangeTextEditorSelection((e) => {
            this.throttleBroadcast(e.textEditor);
        });
    }

    private throttleBroadcast(editor: vscode.TextEditor): void {
        if (this.broadcastThrottle) {
            clearTimeout(this.broadcastThrottle);
        }
        this.broadcastThrottle = setTimeout(() => {
            this.broadcastLocal(editor);
        }, 50);
    }

    private broadcastLocal(editor: vscode.TextEditor): void {
        const doc = editor.document;
        const primary = editor.selection;

        const state: AwarenessState = {
            user: {
                id: this.localUserId,
                name: this.localUserName,
                color: this.localColor,
            },
            cursor: {
                line: primary.active.line,
                character: primary.active.character,
            },
            selections: editor.selections.map((sel) => ({
                anchor: { line: sel.anchor.line, character: sel.anchor.character },
                head: { line: sel.active.line, character: sel.active.character },
            })),
            file: doc.uri.fsPath,
        };

        this._onLocalAwarenessChanged.fire(state);
    }

    applyRemoteAwareness(userId: string, state: AwarenessState): void {
        if (userId === this.localUserId) return;
        this.remoteStates.set(userId, state);
        this.renderRemotePresence(userId, state);
    }

    removeRemoteUser(userId: string): void {
        this.remoteStates.delete(userId);
        this.decorationManager.removeUser(userId);
    }

    private renderRemotePresence(userId: string, state: AwarenessState): void {
        // Find the editor showing the same file
        const editor = vscode.window.visibleTextEditors.find(
            (e) => e.document.uri.fsPath === state.file
        );
        if (!editor) return;

        this.decorationManager.updatePresence(
            editor,
            userId,
            state.user.name,
            state
        );
    }

    refreshDecorations(): void {
        for (const [userId, state] of this.remoteStates) {
            this.renderRemotePresence(userId, state);
        }
    }

    dispose(): void {
        if (this.broadcastThrottle) clearTimeout(this.broadcastThrottle);
        this.selectionListener.dispose();
        this.decorationManager.dispose();
        this._onLocalAwarenessChanged.dispose();
    }
}
