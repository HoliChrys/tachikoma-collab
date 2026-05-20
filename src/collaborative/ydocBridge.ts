import type * as Y from 'yjs';
import * as vscode from 'vscode';
import { loadYjs } from './yjsLoader';

/**
 * Bridges a VS Code TextDocument with the server's RealtimeInstance Y.Doc.
 *
 * Server schema (RealtimeInstance):
 *   Y.Doc
 *   ├── _data   (Y.Map)    ← field values; "content" key is a Y.Text
 *   ├── _events (Y.Array)  ← event log
 *   └── _meta   (Y.Map)    ← metadata (guid, entity_type, ...)
 *
 * We must mirror this structure exactly, otherwise the CRDT deltas
 * coming from the server target shared types we don't have locally,
 * and the Y.Text on our side never updates.
 *
 * Yjs itself is lazy-loaded via `loadYjs()` so the ~75 KB of CRDT runtime
 * stays out of the extension's cold-start bundle until the user actually
 * opens a file for live collaboration.
 */
export class YDocBridge implements vscode.Disposable {
    readonly doc: Y.Doc;
    readonly dataMap: Y.Map<unknown>;
    readonly ytext: Y.Text;

    private readonly Y: typeof Y;
    private isApplyingRemote = false;
    private documentRef: vscode.TextDocument;
    private changeListener: vscode.Disposable;

    private readonly _onLocalUpdate = new vscode.EventEmitter<Uint8Array>();
    readonly onLocalUpdate = this._onLocalUpdate.event;

    constructor(document: vscode.TextDocument) {
        this.documentRef = document;
        this.Y = loadYjs();
        this.doc = new this.Y.Doc({ gc: true });

        // Mirror server schema: _data is the field map, content is a Y.Text inside it
        this.dataMap = this.doc.getMap('_data');

        let text = this.dataMap.get('content') as Y.Text | undefined;
        if (!(text instanceof this.Y.Text)) {
            text = new this.Y.Text();
            this.dataMap.set('content', text);
            this.doc.transact(() => {
                text!.insert(0, document.getText());
            });
        }
        this.ytext = text;

        // Local edits in VS Code → apply to Y.Text
        this.changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document !== this.documentRef) return;
            if (this.isApplyingRemote) return;

            this.doc.transact(() => {
                for (const change of e.contentChanges) {
                    const offset = e.document.offsetAt(change.range.start);
                    if (change.rangeLength > 0) {
                        this.ytext.delete(offset, change.rangeLength);
                    }
                    if (change.text.length > 0) {
                        this.ytext.insert(offset, change.text);
                    }
                }
            });
        });

        // Y.Doc update produced (local edits) → emit for network send
        this.doc.on('update', (update: Uint8Array) => {
            if (this.isApplyingRemote) return;
            this._onLocalUpdate.fire(update);
        });
    }

    async applyRemoteUpdate(update: Uint8Array): Promise<void> {
        this.isApplyingRemote = true;
        try {
            const contentBefore = this.ytext.toString();
            this.Y.applyUpdate(this.doc, update);

            // Re-read the Y.Text reference in case the Map slot was replaced
            const t = this.dataMap.get('content');
            const contentAfter = (t instanceof this.Y.Text) ? t.toString() : String(t ?? '');

            if (contentBefore === contentAfter) return;

            const editor = vscode.window.visibleTextEditors.find(
                (e) => e.document === this.documentRef
            );
            if (!editor) return;

            const fullRange = new vscode.Range(
                this.documentRef.positionAt(0),
                this.documentRef.positionAt(this.documentRef.getText().length)
            );
            await editor.edit(
                (editBuilder) => {
                    editBuilder.replace(fullRange, contentAfter);
                },
                { undoStopBefore: false, undoStopAfter: false }
            );
        } finally {
            this.isApplyingRemote = false;
        }
    }

    getUpdate(stateVector?: Uint8Array): Uint8Array {
        if (stateVector) {
            return this.Y.encodeStateAsUpdate(this.doc, stateVector);
        }
        return this.Y.encodeStateAsUpdate(this.doc);
    }

    getStateVector(): Uint8Array {
        return this.Y.encodeStateVector(this.doc);
    }

    dispose(): void {
        this.changeListener.dispose();
        this._onLocalUpdate.dispose();
        this.doc.destroy();
    }
}
