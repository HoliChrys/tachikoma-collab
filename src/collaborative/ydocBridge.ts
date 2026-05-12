import * as Y from 'yjs';
import * as vscode from 'vscode';

export class YDocBridge implements vscode.Disposable {
    readonly doc: Y.Doc;
    readonly ytext: Y.Text;

    private isApplyingRemote = false;
    private isApplyingLocal = false;
    private documentRef: vscode.TextDocument;
    private changeListener: vscode.Disposable;
    private ydocObserver: () => void;

    private readonly _onLocalUpdate = new vscode.EventEmitter<Uint8Array>();
    readonly onLocalUpdate = this._onLocalUpdate.event;

    constructor(document: vscode.TextDocument) {
        this.documentRef = document;
        this.doc = new Y.Doc({ gc: true });
        this.ytext = this.doc.getText('content');

        // Seed Y.Text with the current document content
        this.doc.transact(() => {
            this.ytext.insert(0, document.getText());
        });

        // Listen for local VS Code edits → apply to Y.Text
        this.changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document !== this.documentRef) return;
            if (this.isApplyingRemote) return;

            this.isApplyingLocal = true;
            try {
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
            } finally {
                this.isApplyingLocal = false;
            }
        });

        // Listen for Y.Doc updates (from local edits) → emit for network send
        this.ydocObserver = () => {};
        this.doc.on('update', (update: Uint8Array, origin: unknown) => {
            if (this.isApplyingRemote) return;
            this._onLocalUpdate.fire(update);
        });
    }

    async applyRemoteUpdate(update: Uint8Array): Promise<void> {
        this.isApplyingRemote = true;
        try {
            const contentBefore = this.ytext.toString();
            Y.applyUpdate(this.doc, update);
            const contentAfter = this.ytext.toString();

            if (contentBefore === contentAfter) return;

            // Find the editor for this document and apply the diff
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
            return Y.encodeStateAsUpdate(this.doc, stateVector);
        }
        return Y.encodeStateAsUpdate(this.doc);
    }

    getStateVector(): Uint8Array {
        return Y.encodeStateVector(this.doc);
    }

    dispose(): void {
        this.changeListener.dispose();
        this._onLocalUpdate.dispose();
        this.doc.destroy();
    }
}
