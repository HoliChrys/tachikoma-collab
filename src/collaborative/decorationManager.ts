import * as vscode from 'vscode';
import { USER_COLORS } from '../types';
import type { AwarenessState } from '../types';

interface UserDecorations {
    cursor: vscode.TextEditorDecorationType;
    selection: vscode.TextEditorDecorationType;
    color: string;
}

export class DecorationManager implements vscode.Disposable {
    private userDecorations = new Map<string, UserDecorations>();
    private colorIndex = 0;

    getOrCreateUserDecorations(userId: string, userName: string): UserDecorations {
        const existing = this.userDecorations.get(userId);
        if (existing) return existing;

        const color = USER_COLORS[this.colorIndex % USER_COLORS.length];
        this.colorIndex++;

        const cursor = vscode.window.createTextEditorDecorationType({
            borderStyle: 'solid',
            borderWidth: '0 0 0 2px',
            borderColor: color,
            after: {
                contentText: ` ${userName} `,
                color: '#ffffff',
                backgroundColor: color,
                margin: '0 0 0 4px',
                fontStyle: 'normal',
                fontWeight: 'bold',
                textDecoration: '; font-size: 10px; padding: 0 4px; border-radius: 2px;',
            },
        });

        const selection = vscode.window.createTextEditorDecorationType({
            backgroundColor: `${color}30`,
            borderStyle: 'solid',
            borderWidth: '1px',
            borderColor: `${color}60`,
        });

        const decs: UserDecorations = { cursor, selection, color };
        this.userDecorations.set(userId, decs);
        return decs;
    }

    updatePresence(editor: vscode.TextEditor, userId: string, userName: string, state: AwarenessState): void {
        const decs = this.getOrCreateUserDecorations(userId, userName);

        // Cursor decoration
        if (state.cursor) {
            const pos = new vscode.Position(state.cursor.line, state.cursor.character);
            const cursorRange = new vscode.Range(pos, pos);
            editor.setDecorations(decs.cursor, [cursorRange]);
        } else {
            editor.setDecorations(decs.cursor, []);
        }

        // Selection decorations
        if (state.selections && state.selections.length > 0) {
            const ranges = state.selections.map((sel) => {
                const anchor = new vscode.Position(sel.anchor.line, sel.anchor.character);
                const head = new vscode.Position(sel.head.line, sel.head.character);
                return new vscode.Range(anchor, head);
            });
            editor.setDecorations(decs.selection, ranges);
        } else {
            editor.setDecorations(decs.selection, []);
        }
    }

    clearUser(editor: vscode.TextEditor, userId: string): void {
        const decs = this.userDecorations.get(userId);
        if (!decs) return;
        editor.setDecorations(decs.cursor, []);
        editor.setDecorations(decs.selection, []);
    }

    removeUser(userId: string): void {
        const decs = this.userDecorations.get(userId);
        if (!decs) return;
        decs.cursor.dispose();
        decs.selection.dispose();
        this.userDecorations.delete(userId);
    }

    dispose(): void {
        for (const decs of this.userDecorations.values()) {
            decs.cursor.dispose();
            decs.selection.dispose();
        }
        this.userDecorations.clear();
    }
}
