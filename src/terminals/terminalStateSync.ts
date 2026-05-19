import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { EventBus } from '../collaborative/sseClient';
import type { TerminalTracker } from './terminalTracker';
import type { TrackedTerminal, UserTerminalsEvent } from './terminalTypes';
import { log, logError } from '../log';

const PUSH_DEBOUNCE_MS = 500;

/**
 * Syncs the local TerminalTracker state with the backend:
 *   - tracker change → debounce → PUT /api/terminals/state (full snapshot)
 *   - SSE user.terminals.* events from other machines (same user) → log (no auto replay by default)
 *
 * Anti-feedback-loop: events with our own machine_id are ignored.
 */
export class TerminalStateSync implements vscode.Disposable {
    private client: TachikomaClient | null = null;
    private eventBus: EventBus | null = null;
    private tracker: TerminalTracker;
    private machineId: string;
    private pushTimer: ReturnType<typeof setTimeout> | null = null;
    private disposables: vscode.Disposable[] = [];
    private sseStream: { close(): void } | null = null;
    private remoteSessions = new Map<string, TrackedTerminal>(); // by id, from other machines

    private _onRemoteChange = new vscode.EventEmitter<TrackedTerminal[]>();
    readonly onRemoteChange = this._onRemoteChange.event;

    constructor(tracker: TerminalTracker, machineId: string) {
        this.tracker = tracker;
        this.machineId = machineId;
    }

    start(client: TachikomaClient, eventBus: EventBus): void {
        this.client = client;
        this.eventBus = eventBus;

        // Push on tracker changes (debounced)
        this.disposables.push(
            this.tracker.onDidChange(() => this.schedulePush()),
        );

        // Subscribe to SSE for cross-machine events
        const stream = eventBus.subscribe({
            eventTypes: [
                'user.terminals.opened',
                'user.terminals.closed',
                'user.terminals.updated',
                'user.terminals.snapshot',
            ],
        });
        this.sseStream = stream;
        void (async () => {
            try {
                for await (const event of stream) {
                    this.handleSseEvent(event as unknown as UserTerminalsEvent & { event_type: string });
                }
            } catch {
                log('TerminalStateSync: SSE stream ended');
            }
        })();

        log('TerminalStateSync started');
    }

    /** Force an immediate push (skip debounce). */
    async forceSync(): Promise<void> {
        if (this.pushTimer) {
            clearTimeout(this.pushTimer);
            this.pushTimer = null;
        }
        await this.push();
    }

    /** Last-known remote sessions opened on OTHER machines for the same user. */
    getRemoteSessions(): TrackedTerminal[] {
        return [...this.remoteSessions.values()];
    }

    stop(): void {
        if (this.pushTimer) {
            clearTimeout(this.pushTimer);
            this.pushTimer = null;
        }
        for (const d of this.disposables) d.dispose();
        this.disposables = [];
        if (this.sseStream) {
            try { this.sseStream.close(); } catch { /* ignore */ }
            this.sseStream = null;
        }
        this.client = null;
        this.eventBus = null;
        this.remoteSessions.clear();
    }

    dispose(): void {
        this.stop();
        this._onRemoteChange.dispose();
    }

    // --- private ---

    private schedulePush(): void {
        if (this.pushTimer) clearTimeout(this.pushTimer);
        this.pushTimer = setTimeout(() => {
            this.pushTimer = null;
            void this.push();
        }, PUSH_DEBOUNCE_MS);
    }

    private async push(): Promise<void> {
        if (!this.client) return;
        const sessions = this.tracker.list();
        try {
            await this.client.putTerminalsState(sessions);
            log(`TerminalStateSync: pushed ${sessions.length} terminal(s) to backend`);
        } catch (err) {
            // Endpoint likely missing on backend yet — silent fail, retry next change
            logError('TerminalStateSync: push failed (backend endpoint likely missing)', err);
        }
    }

    private handleSseEvent(event: UserTerminalsEvent & { event_type: string }): void {
        // Ignore our own events (anti-feedback-loop)
        if (event.machine_id && event.machine_id === this.machineId) return;

        switch (event.event_type) {
            case 'user.terminals.opened':
            case 'user.terminals.updated':
                if (event.terminal) {
                    this.remoteSessions.set(event.terminal.id, event.terminal);
                    log(`TerminalStateSync: remote terminal ${event.event_type} from ${event.machine_id} id=${event.terminal.id}`);
                }
                break;
            case 'user.terminals.closed':
                if (event.terminal_id) {
                    this.remoteSessions.delete(event.terminal_id);
                    log(`TerminalStateSync: remote terminal closed from ${event.machine_id} id=${event.terminal_id}`);
                }
                break;
            case 'user.terminals.snapshot':
                if (event.sessions) {
                    this.remoteSessions.clear();
                    for (const t of event.sessions) {
                        if (t.machine_id !== this.machineId) this.remoteSessions.set(t.id, t);
                    }
                    log(`TerminalStateSync: snapshot ${event.sessions.length} session(s), ${this.remoteSessions.size} remote`);
                }
                break;
        }
        this._onRemoteChange.fire(this.getRemoteSessions());
    }
}
