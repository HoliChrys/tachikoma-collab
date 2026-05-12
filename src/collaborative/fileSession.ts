import * as vscode from 'vscode';
import { YDocBridge } from './ydocBridge';
import type { TachikomaClient } from '../api/tachikomaClient';

export class FileSession implements vscode.Disposable {
    private bridge: YDocBridge;
    private componentId: string;
    private sessionId: string;
    private client: TachikomaClient;
    private updateListener: vscode.Disposable;
    private isSendingUpdate = false;

    constructor(
        document: vscode.TextDocument,
        componentId: string,
        sessionId: string,
        client: TachikomaClient,
    ) {
        this.bridge = new YDocBridge(document);
        this.componentId = componentId;
        this.sessionId = sessionId;
        this.client = client;

        // When local Y.Doc produces an update, send it to server
        this.updateListener = this.bridge.onLocalUpdate(async (update) => {
            if (this.isSendingUpdate) return;
            this.isSendingUpdate = true;
            try {
                const b64 = Buffer.from(update).toString('base64');
                await this.client.updateComponent(this.componentId, this.sessionId, {
                    _crdt_update: b64,
                });
            } catch (err) {
                console.error('[Tachikoma] Failed to send update:', err);
            } finally {
                this.isSendingUpdate = false;
            }
        });
    }

    getComponentId(): string {
        return this.componentId;
    }

    async applyRemoteUpdate(base64Update: string): Promise<void> {
        const binary = Buffer.from(base64Update, 'base64');
        await this.bridge.applyRemoteUpdate(new Uint8Array(binary));
    }

    async applyRemoteChanges(changes: Record<string, unknown>): Promise<void> {
        // For field-level changes (non-CRDT), update the full content if 'content' changed
        if (typeof changes['content'] === 'string') {
            const update = new TextEncoder().encode(changes['content'] as string);
            // This path is for non-CRDT fallback — full content replacement
            const editor = vscode.window.visibleTextEditors.find(
                (e) => e.document === this.getDocument()
            );
            if (editor) {
                const doc = editor.document;
                const fullRange = new vscode.Range(
                    doc.positionAt(0),
                    doc.positionAt(doc.getText().length)
                );
                await editor.edit(
                    (eb) => eb.replace(fullRange, changes['content'] as string),
                    { undoStopBefore: false, undoStopAfter: false }
                );
            }
        }
    }

    getDocument(): vscode.TextDocument {
        return (this.bridge as unknown as { documentRef: vscode.TextDocument }).documentRef;
    }

    dispose(): void {
        this.updateListener.dispose();
        this.bridge.dispose();
    }
}
