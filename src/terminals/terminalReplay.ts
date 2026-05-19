import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { TerminalTracker } from './terminalTracker';
import type { TrackedTerminal } from './terminalTypes';
import { log, logError } from '../log';

const MAX_AUTO_REPLAY = 5; // prompt user if more than this

export interface ReplayOptions {
    /** Restrict replay to terminals from this machine (default: this machine + cross-machine if configured). */
    machineId?: string;
    /** Replay terminals opened on OTHER machines too. Default: false (opt-in). */
    crossMachine?: boolean;
}

/**
 * Replay a list of TrackedTerminal entries — i.e. recreate vscode.Terminal
 * instances that match.
 *
 * Tokens (zweb, ssh) are refetched at replay time — never reused from the
 * persisted snapshot.
 *
 * Idempotent: skips entries whose id is already tracked.
 */
export async function replayTerminals(
    sessions: TrackedTerminal[],
    tracker: TerminalTracker,
    client: TachikomaClient,
    options: ReplayOptions = {},
): Promise<{ replayed: number; skipped: number; failed: number }> {
    let replayed = 0;
    let skipped = 0;
    let failed = 0;

    // Filter
    const candidates = sessions.filter((t) => {
        if (!t.auto_replay) { skipped++; return false; }
        if (tracker.has(t.id)) { skipped++; return false; }
        if (options.machineId && t.machine_id !== options.machineId && !options.crossMachine) {
            skipped++;
            return false;
        }
        return true;
    });

    if (candidates.length === 0) {
        log(`TerminalReplay: nothing to replay (${skipped} skipped)`);
        return { replayed, skipped, failed };
    }

    // Soft cap with user prompt
    if (candidates.length > MAX_AUTO_REPLAY) {
        const choice = await vscode.window.showInformationMessage(
            `Restore ${candidates.length} terminal sessions from previous session?`,
            { modal: false },
            'Restore all', 'Skip',
        );
        if (choice !== 'Restore all') {
            log(`TerminalReplay: user declined to restore ${candidates.length} terminals`);
            return { replayed: 0, skipped: candidates.length, failed: 0 };
        }
    }

    for (const t of candidates) {
        try {
            const term = await spawnTerminal(t, client);
            if (term) {
                tracker.registerWithId(term, { ...t, last_active_at: new Date().toISOString() });
                replayed++;
            } else {
                failed++;
            }
        } catch (err) {
            logError(`TerminalReplay: failed to replay ${t.id} (${t.kind})`, err);
            failed++;
        }
    }

    log(`TerminalReplay: ${replayed} replayed, ${skipped} skipped, ${failed} failed`);
    return { replayed, skipped, failed };
}

async function spawnTerminal(t: TrackedTerminal, client: TachikomaClient): Promise<vscode.Terminal | null> {
    switch (t.kind) {
        case 'zellij':
            return spawnZellij(t, client);
        case 'ssh-remote':
            return spawnSshRemote(t);
        case 'local-pty':
            return spawnLocal(t);
        case 'tmux':
            // tmux uses a WebView panel, not a vscode.Terminal — skip in this path
            log(`TerminalReplay: tmux replay not yet supported (id=${t.id})`);
            return null;
        default:
            log(`TerminalReplay: unknown kind ${(t as TrackedTerminal).kind}`);
            return null;
    }
}

async function spawnZellij(t: TrackedTerminal, client: TachikomaClient): Promise<vscode.Terminal | null> {
    if (!t.zellij_session_id) return null;
    // Refetch fresh token — never reuse the persisted one
    let zwToken: string;
    let serverBase: string;
    try {
        const webData = await client.getSessionWeb(t.zellij_session_id);
        zwToken = webData.token;
        serverBase = `https://session.zweb.${webData.ctx_id}.tachikoma.sh`;
    } catch (err) {
        logError(`TerminalReplay: failed to refetch zweb token for ${t.zellij_session_id}`, err);
        return null;
    }
    const serverUrl = `${serverBase}/${t.zellij_session_id}`;
    const cmd = `zellij attach ${serverUrl} --token ${zwToken} --remember`;
    const term = vscode.window.createTerminal({
        name: t.title,
        iconPath: new vscode.ThemeIcon('terminal'),
    });
    term.sendText(cmd);
    term.show();
    return term;
}

function spawnSshRemote(t: TrackedTerminal): vscode.Terminal {
    const term = vscode.window.createTerminal({
        name: t.title,
        shellPath: t.shell_path ?? 'ssh',
        shellArgs: t.shell_args ?? [],
    });
    term.show();
    return term;
}

function spawnLocal(t: TrackedTerminal): vscode.Terminal {
    const term = vscode.window.createTerminal({
        name: t.title,
        shellPath: t.shell_path,
        shellArgs: t.shell_args,
        env: t.env,
    });
    term.show();
    return term;
}
