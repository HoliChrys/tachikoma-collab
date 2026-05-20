// VI-1c screen.* RPC handlers.
//
// screen.observe -> snapshot of active file, visible files, selection.
//
// Spec: .agents/specs/to_do/VI-1c-runner-rpc.md.
// ASCII only, 4-space indent.

import * as vscode from 'vscode';
import { RpcDispatcher } from '../rpcDispatcher';

type What = 'active_file' | 'visible_files' | 'selection' | 'all';

interface ObserveParams {
    what?: What;
}

function selectionSnapshot(editor: vscode.TextEditor) {
    const sel = editor.selection;
    return {
        uri: editor.document.uri.toString(),
        anchor: { line: sel.anchor.line, column: sel.anchor.character },
        active: { line: sel.active.line, column: sel.active.character },
        isEmpty: sel.isEmpty,
    };
}

export function registerScreenHandlers(disp: RpcDispatcher): void {
    disp.register('screen.observe', async (params: ObserveParams = {}) => {
        const what: What = params.what ?? 'all';
        const active = vscode.window.activeTextEditor;
        const snapshot: Record<string, unknown> = {};

        if (what === 'active_file' || what === 'all') {
            snapshot.active_file = active
                ? {
                      uri: active.document.uri.toString(),
                      language: active.document.languageId,
                      isDirty: active.document.isDirty,
                      lineCount: active.document.lineCount,
                  }
                : null;
        }

        if (what === 'visible_files' || what === 'all') {
            snapshot.visible_files = vscode.window.visibleTextEditors.map(
                (e) => ({
                    uri: e.document.uri.toString(),
                    language: e.document.languageId,
                    viewColumn: e.viewColumn ?? null,
                }),
            );
        }

        if (what === 'selection' || what === 'all') {
            snapshot.selection = active ? selectionSnapshot(active) : null;
        }

        return { snapshot };
    });
}
