// VI-1c file.* RPC handlers.
//
// file.open -> vscode.commands.executeCommand('vscode.open', uri)
// file.save -> activeTextEditor.document.save() (or specific uri)
//
// Spec: .agents/specs/to_do/VI-1c-runner-rpc.md.
// ASCII only, 4-space indent.

import * as vscode from 'vscode';
import { RpcDispatcher } from '../rpcDispatcher';

interface OpenParams {
    uri: string;
    preview?: boolean;
    viewColumn?: number;
}

interface SaveParams {
    uri?: string;          // if absent, saves the active editor's document
}

export function registerFileHandlers(disp: RpcDispatcher): void {
    disp.register('file.open', async (params: OpenParams) => {
        if (!params?.uri) throw new Error('uri required');
        const uri = vscode.Uri.parse(params.uri);
        await vscode.commands.executeCommand('vscode.open', uri, {
            preview: params.preview ?? false,
            viewColumn: params.viewColumn,
        });
        return { opened: true };
    });

    disp.register('file.save', async (params: SaveParams = {}) => {
        let doc: vscode.TextDocument | undefined;
        if (params.uri) {
            doc = vscode.workspace.textDocuments.find(
                (d) => d.uri.toString() === params.uri,
            );
            if (!doc) {
                doc = await vscode.workspace.openTextDocument(
                    vscode.Uri.parse(params.uri),
                );
            }
        } else {
            doc = vscode.window.activeTextEditor?.document;
        }
        if (!doc) throw new Error('no document to save');
        const saved = await doc.save();
        return { saved };
    });
}
