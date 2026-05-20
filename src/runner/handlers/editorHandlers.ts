// VI-1c editor.* RPC handlers.
//
// editor.set_selection -> vscode.TextEditor.selection (+ revealRange)
// editor.insert_text   -> vscode.TextEditorEdit.insert
// editor.replace_range -> vscode.TextEditorEdit.replace
//
// Spec: .agents/specs/to_do/VI-1c-runner-rpc.md.
// ASCII only, 4-space indent.

import * as vscode from 'vscode';
import { RpcDispatcher } from '../rpcDispatcher';

interface RangePayload {
    startLine: number;     // 0-based
    startCol: number;
    endLine: number;
    endCol: number;
}

interface PositionPayload {
    line: number;          // 0-based
    column: number;
}

interface SetSelectionParams {
    uri?: string;          // optional; defaults to active editor
    range: RangePayload;
}

interface InsertTextParams {
    uri?: string;
    position: PositionPayload;
    text: string;
}

interface ReplaceRangeParams {
    uri?: string;
    range: RangePayload;
    text: string;
}

async function resolveEditor(
    uri?: string,
): Promise<vscode.TextEditor> {
    if (uri) {
        const doc = await vscode.workspace.openTextDocument(
            vscode.Uri.parse(uri),
        );
        return vscode.window.showTextDocument(doc, { preserveFocus: true });
    }
    const active = vscode.window.activeTextEditor;
    if (!active) throw new Error('no active editor');
    return active;
}

function toRange(r: RangePayload): vscode.Range {
    return new vscode.Range(r.startLine, r.startCol, r.endLine, r.endCol);
}

export function registerEditorHandlers(disp: RpcDispatcher): void {
    disp.register('editor.set_selection', async (params: SetSelectionParams) => {
        const editor = await resolveEditor(params.uri);
        const r = toRange(params.range);
        editor.selection = new vscode.Selection(r.start, r.end);
        editor.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        return {};
    });

    disp.register('editor.insert_text', async (params: InsertTextParams) => {
        const editor = await resolveEditor(params.uri);
        const pos = new vscode.Position(
            params.position.line,
            params.position.column,
        );
        const ok = await editor.edit((edit) => edit.insert(pos, params.text));
        if (!ok) throw new Error('insert failed');
        return {};
    });

    disp.register('editor.replace_range', async (params: ReplaceRangeParams) => {
        const editor = await resolveEditor(params.uri);
        const ok = await editor.edit((edit) =>
            edit.replace(toRange(params.range), params.text),
        );
        if (!ok) throw new Error('replace failed');
        return {};
    });
}
