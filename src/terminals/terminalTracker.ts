import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import type { TrackedTerminal } from './terminalTypes';
import { log } from '../log';

/**
 * Tracks terminals opened by the Tachikoma extension.
 *
 * Maps `vscode.Terminal` instances → TrackedTerminal metadata.
 * Fires onDidChange whenever the list changes (register / unregister / update).
 *
 * Use `register(terminal, metadata)` from attach helpers (sessionAttacher,
 * remoteTerminal command) right after `createTerminal()`. The tracker watches
 * `onDidCloseTerminal` automatically to keep the list in sync.
 */
export class TerminalTracker implements vscode.Disposable {
    private terminals = new Map<vscode.Terminal, TrackedTerminal>();
    private byId = new Map<string, vscode.Terminal>();
    private disposables: vscode.Disposable[] = [];

    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    constructor() {
        this.disposables.push(
            vscode.window.onDidCloseTerminal((term) => this.handleClose(term)),
        );
    }

    /**
     * Register a freshly-created terminal for tracking.
     * @param terminal - the vscode.Terminal returned by createTerminal()
     * @param meta - metadata minus id/opened_at/last_active_at (filled in here)
     */
    register(
        terminal: vscode.Terminal,
        meta: Omit<TrackedTerminal, 'id' | 'opened_at' | 'last_active_at'>,
    ): TrackedTerminal {
        const now = new Date().toISOString();
        const tracked: TrackedTerminal = {
            ...meta,
            id: `t-${randomUUID().slice(0, 12)}`,
            opened_at: now,
            last_active_at: now,
        };
        this.terminals.set(terminal, tracked);
        this.byId.set(tracked.id, terminal);
        log(`TerminalTracker: registered ${tracked.kind} "${tracked.title}" id=${tracked.id}`);
        this._onDidChange.fire();
        return tracked;
    }

    /** Used by replay to restore a terminal with its existing id (server-side). */
    registerWithId(terminal: vscode.Terminal, full: TrackedTerminal): void {
        this.terminals.set(terminal, full);
        this.byId.set(full.id, terminal);
        log(`TerminalTracker: registered (replay) id=${full.id}`);
        this._onDidChange.fire();
    }

    /** Returns the snapshot — copy, safe to enumerate. */
    list(): TrackedTerminal[] {
        return [...this.terminals.values()];
    }

    has(id: string): boolean {
        return this.byId.has(id);
    }

    getTerminal(id: string): vscode.Terminal | undefined {
        return this.byId.get(id);
    }

    /** Touch last_active_at on a tracked terminal. */
    touch(id: string): void {
        const term = this.byId.get(id);
        if (!term) return;
        const t = this.terminals.get(term);
        if (t) {
            t.last_active_at = new Date().toISOString();
            this._onDidChange.fire();
        }
    }

    /** Programmatic unregister (without disposing the terminal). */
    unregister(id: string): TrackedTerminal | undefined {
        const term = this.byId.get(id);
        if (!term) return undefined;
        const t = this.terminals.get(term);
        this.terminals.delete(term);
        this.byId.delete(id);
        if (t) {
            log(`TerminalTracker: unregistered id=${id}`);
            this._onDidChange.fire();
        }
        return t;
    }

    /** Kill all tracked terminals (e.g. on user disconnect). */
    killAll(): void {
        const terms = [...this.terminals.keys()];
        this.terminals.clear();
        this.byId.clear();
        for (const t of terms) {
            try { t.dispose(); } catch { /* ignore */ }
        }
        log(`TerminalTracker: killed ${terms.length} tracked terminal(s)`);
        this._onDidChange.fire();
    }

    private handleClose(terminal: vscode.Terminal): void {
        const t = this.terminals.get(terminal);
        if (!t) return;
        this.terminals.delete(terminal);
        this.byId.delete(t.id);
        log(`TerminalTracker: terminal closed id=${t.id}`);
        this._onDidChange.fire();
    }

    dispose(): void {
        for (const d of this.disposables) d.dispose();
        this.disposables = [];
        this._onDidChange.dispose();
    }
}
