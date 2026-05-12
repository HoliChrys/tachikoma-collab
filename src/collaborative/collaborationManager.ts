import * as vscode from 'vscode';
import { EventBus, type MonorepoEvent } from './sseClient';
import { FileSession } from './fileSession';
import { AwarenessManager } from './awarenessManager';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { AwarenessState } from '../types';
import { USER_COLORS } from '../types';

export class CollaborationManager implements vscode.Disposable {
    private client: TachikomaClient | null = null;
    private eventBus: EventBus | null = null;
    private streamAbort: AbortController | null = null;
    private sessions = new Map<string, FileSession>();
    private fileSessions = new Map<string, string>(); // fsPath → componentId
    private awarenessManager: AwarenessManager | null = null;
    private sessionId = '';
    private userId = '';
    private disposables: vscode.Disposable[] = [];

    private readonly _onParticipantsChanged = new vscode.EventEmitter<string[]>();
    readonly onParticipantsChanged = this._onParticipantsChanged.event;

    private allParticipants = new Set<string>();

    connect(client: TachikomaClient, userId: string, userName: string): void {
        this.disconnect();
        this.client = client;
        this.userId = userId;
        this.sessionId = `vscode-${userId}-${Date.now()}`;

        const token = client.getToken();
        if (!token) return;

        this.eventBus = new EventBus({ token, baseUrl: client.baseUrl });

        const color = USER_COLORS[0];
        this.awarenessManager = new AwarenessManager(userId, userName, color);

        this.disposables.push(
            this.awarenessManager.onLocalAwarenessChanged(async (state) => {
                await this.broadcastAwareness(state);
            })
        );

        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                this.awarenessManager?.refreshDecorations();
            })
        );

        this.startEventStream();
    }

    private async startEventStream(): Promise<void> {
        if (!this.eventBus) return;

        const stream = this.eventBus.subscribe(
            {
                eventTypes: [
                    'component.updated',
                    'component.created',
                    'component.removed',
                    'component.participant_joined',
                    'component.participant_left',
                ],
            },
            (connected) => {
                if (connected) {
                    vscode.window.setStatusBarMessage('$(plug) Tachikoma stream connected', 3000);
                }
            },
        );

        try {
            for await (const event of stream) {
                this.handleEvent(event);
            }
        } catch {
            // stream closed
        }
    }

    private handleEvent(event: MonorepoEvent): void {
        switch (event.event_type) {
            case 'component.updated': {
                if (event.participant_id === this.userId) return;
                const session = this.sessions.get(event.component_id ?? '');
                if (!session) return;

                if (event.changes?.['_awareness']) {
                    this.awarenessManager?.applyRemoteAwareness(
                        event.participant_id ?? 'unknown',
                        event.changes['_awareness'] as AwarenessState,
                    );
                    return;
                }

                if (event.update) {
                    void session.applyRemoteUpdate(event.update as string);
                } else if (event.changes) {
                    void session.applyRemoteChanges(event.changes as Record<string, unknown>);
                }
                break;
            }

            case 'component.participant_joined':
                if (event.participant_id) {
                    this.allParticipants.add(event.participant_id);
                    this._onParticipantsChanged.fire([...this.allParticipants]);
                }
                break;

            case 'component.participant_left':
                if (event.participant_id) {
                    this.allParticipants.delete(event.participant_id);
                    this.awarenessManager?.removeRemoteUser(event.participant_id);
                    this._onParticipantsChanged.fire([...this.allParticipants]);
                }
                break;

            case 'component.removed': {
                const cid = event.component_id ?? '';
                const s = this.sessions.get(cid);
                if (s) {
                    s.dispose();
                    this.sessions.delete(cid);
                    for (const [path, id] of this.fileSessions) {
                        if (id === cid) { this.fileSessions.delete(path); break; }
                    }
                }
                break;
            }
        }
    }

    disconnect(): void {
        this.streamAbort?.abort();
        this.streamAbort = null;

        for (const session of this.sessions.values()) session.dispose();
        this.sessions.clear();
        this.fileSessions.clear();

        this.awarenessManager?.dispose();
        this.awarenessManager = null;
        this.eventBus = null;

        for (const d of this.disposables) d.dispose();
        this.disposables = [];
        this.allParticipants.clear();
    }

    async startCollaborating(document: vscode.TextDocument): Promise<void> {
        if (!this.client) {
            vscode.window.showWarningMessage('Not connected to Tachikoma');
            return;
        }

        const fsPath = document.uri.fsPath;
        if (this.fileSessions.has(fsPath)) {
            vscode.window.showInformationMessage('Already collaborating on this file');
            return;
        }

        try {
            const component = await this.client.createComponent(
                'file', this.sessionId, fsPath,
                { content: document.getText(), path: fsPath },
            );
            await this.client.joinComponent(component.id, this.sessionId);

            const session = new FileSession(document, component.id, this.sessionId, this.client);
            this.sessions.set(component.id, session);
            this.fileSessions.set(fsPath, component.id);

            vscode.window.showInformationMessage(`Collaborating on ${document.fileName}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to start collaboration: ${msg}`);
        }
    }

    async stopCollaborating(document: vscode.TextDocument): Promise<void> {
        const fsPath = document.uri.fsPath;
        const componentId = this.fileSessions.get(fsPath);
        if (!componentId) return;

        const session = this.sessions.get(componentId);
        if (session) {
            try { await this.client?.leaveComponent(componentId, this.sessionId); } catch { /* */ }
            session.dispose();
            this.sessions.delete(componentId);
        }
        this.fileSessions.delete(fsPath);
    }

    getParticipants(): string[] {
        return [...this.allParticipants];
    }

    private async broadcastAwareness(state: AwarenessState): Promise<void> {
        if (!this.client) return;
        const componentId = this.fileSessions.get(state.file);
        if (!componentId) return;
        try {
            await this.client.updateComponent(componentId, this.sessionId, { _awareness: state });
        } catch { /* best-effort */ }
    }

    dispose(): void {
        this.disconnect();
        this._onParticipantsChanged.dispose();
    }
}
