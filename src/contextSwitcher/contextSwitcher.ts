import * as vscode from 'vscode';
import type { AuthManager } from '../auth/authManager';
import type { ContextStore } from '../store/contextStore';
import type { ContextStoreNode } from '../types';
import { log, logError } from '../log';

/** workspaceState key holding the MRU list (most recent first, max 10). */
export const RECENT_KEY = 'tachikoma.context.recent';
/** workspaceState key holding the per-context frequency map (count). */
export const FREQ_KEY = 'tachikoma.context.frequency';
/** workspaceState key holding the per-context lastOpenedAt millis map. */
export const LAST_OPENED_KEY = 'tachikoma.context.lastOpenedAt';

const MAX_RECENT = 10;

interface ContextItem extends vscode.QuickPickItem {
    contextPath: string;
}

interface SwitcherStats {
    sessions: number;
    agents: number;
    lastOpenedAt: number | undefined;
}

/**
 * Open the Tachikoma context quick switcher.
 *
 * Walks the Galaxies > Systems > Spaces > Repositories hierarchy held by
 * the ContextStore, scores items using recent + frequency, and on accept
 * persists MRU and fires the `tachikoma.context.switch` command (with
 * fallbacks for legacy command names).
 */
export async function openContextSwitcher(
    extensionContext: vscode.ExtensionContext,
    authManager: AuthManager,
    contextStore: ContextStore,
): Promise<void> {
    if (!authManager.isConnected()) {
        vscode.window.showWarningMessage('Tachikoma: not connected — cannot switch context.');
        return;
    }

    const nodes = contextStore.getAllNodes();
    if (nodes.length === 0) {
        vscode.window.showInformationMessage('Tachikoma: no contexts available yet.');
        return;
    }

    const recent = readStringArray(extensionContext, RECENT_KEY);
    const freq = readNumberMap(extensionContext, FREQ_KEY);
    const lastOpened = readNumberMap(extensionContext, LAST_OPENED_KEY);

    const items = buildItems(contextStore, nodes, recent, freq, lastOpened);

    const quickPick = vscode.window.createQuickPick<ContextItem>();
    quickPick.title = 'Switch Tachikoma Context';
    quickPick.placeholder = 'Type to fuzzy-search galaxies, systems, spaces, repos';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.items = items;

    // Pre-select MRU head if it still exists in the current item set.
    const mruHead = recent[0];
    if (mruHead) {
        const preselect = items.find((it) => it.contextPath === mruHead);
        if (preselect) quickPick.activeItems = [preselect];
    }

    const picked = await new Promise<ContextItem | undefined>((resolve) => {
        quickPick.onDidAccept(() => {
            const sel = quickPick.activeItems[0];
            resolve(sel);
            quickPick.hide();
        });
        quickPick.onDidHide(() => {
            resolve(undefined);
            quickPick.dispose();
        });
        quickPick.show();
    });

    if (!picked) return;

    await recordSelection(extensionContext, picked.contextPath);
    await switchToContext(contextStore, picked.contextPath);
}

function buildItems(
    store: ContextStore,
    nodes: ContextStoreNode[],
    recent: string[],
    freq: Record<string, number>,
    lastOpened: Record<string, number>,
): ContextItem[] {
    const now = Date.now();
    const sessionsByCtx = countSessionsByContext(store);
    const agentsByCtx = countAgentsByContext(store);

    const recentRank = new Map<string, number>();
    recent.forEach((path, idx) => recentRank.set(path, idx));

    const scored = nodes.map((n) => {
        const stats: SwitcherStats = {
            sessions: sessionsByCtx.get(n.path) ?? 0,
            agents: agentsByCtx.get(n.path) ?? 0,
            lastOpenedAt: lastOpened[n.path],
        };
        return { node: n, stats, score: scoreNode(n, stats, recentRank, freq, now) };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.map(({ node, stats }) => toItem(node, stats, now, recentRank.has(node.path)));
}

function scoreNode(
    node: ContextStoreNode,
    stats: SwitcherStats,
    recentRank: Map<string, number>,
    freq: Record<string, number>,
    now: number,
): number {
    let score = 0;

    // Recent boost: top of MRU = +100, decays linearly to 0 at slot 10.
    const r = recentRank.get(node.path);
    if (r !== undefined) score += Math.max(0, 100 - r * 10);

    // Frequency boost: log so a runaway favourite can't crowd out the list.
    const f = freq[node.path] ?? 0;
    if (f > 0) score += Math.log2(f + 1) * 15;

    // Recency decay (exponential, half-life ~6h).
    if (stats.lastOpenedAt) {
        const ageHours = (now - stats.lastOpenedAt) / 3_600_000;
        score += 30 * Math.pow(0.5, ageHours / 6);
    }

    // Active context gets a small bump.
    if (node.active) score += 5;

    return score;
}

function toItem(
    node: ContextStoreNode,
    stats: SwitcherStats,
    now: number,
    isRecent: boolean,
): ContextItem {
    const label = buildBreadcrumb(node.path);
    const detail = buildDetail(stats, now);
    const description = isRecent ? 'recent' : node.type;

    return {
        label,
        description,
        detail,
        contextPath: node.path,
        iconPath: new vscode.ThemeIcon(iconForType(node.type)),
    };
}

function iconForType(t: ContextStoreNode['type']): string {
    switch (t) {
        case 'galaxy': return 'globe';
        case 'system': return 'package';
        case 'space': return 'folder';
        default: return 'symbol-namespace';
    }
}

/**
 * Render the dotted context path as "Galaxy > System > Space > Repo".
 *
 * The store only carries 3 levels (galaxy/system/space) but space paths
 * may carry an extra dotted segment that the UI surfaces as the "Repo".
 */
function buildBreadcrumb(contextPath: string): string {
    const parts = contextPath.split('.').filter((p) => p.length > 0);
    return parts.join(' > ');
}

function buildDetail(stats: SwitcherStats, now: number): string {
    const pieces: string[] = [];
    pieces.push(`${stats.sessions} session${stats.sessions === 1 ? '' : 's'}`);
    pieces.push(`${stats.agents} agent${stats.agents === 1 ? '' : 's'}`);
    if (stats.lastOpenedAt) {
        pieces.push(`last opened ${formatRelative(now - stats.lastOpenedAt)}`);
    } else {
        pieces.push('never opened');
    }
    return pieces.join(', ');
}

function formatRelative(deltaMs: number): string {
    if (deltaMs < 0) return 'just now';
    const sec = Math.floor(deltaMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    const mo = Math.floor(day / 30);
    if (mo < 12) return `${mo}mo ago`;
    const yr = Math.floor(day / 365);
    return `${yr}y ago`;
}

function countSessionsByContext(store: ContextStore): Map<string, number> {
    const counts = new Map<string, number>();
    for (const group of store.getSessions()) {
        const path = group.context_path;
        if (!path) continue;
        const active = group.active_sessions?.length ?? 0;
        counts.set(path, (counts.get(path) ?? 0) + active);
    }
    return counts;
}

function countAgentsByContext(store: ContextStore): Map<string, number> {
    // Agents are tracked as a sub-class of users (user_type === 'agent') with
    // their contexts list. We invert that mapping so the switcher can show
    // an "agents-attached" count per context without a new API call.
    const counts = new Map<string, number>();
    for (const node of store.getAllNodes()) {
        let n = 0;
        for (const uid of node.grantedUsers) {
            if (uid.startsWith('agent.') || uid.startsWith('k7f-') || uid.startsWith('m2x-')) {
                n += 1;
            }
        }
        counts.set(node.path, n);
    }
    return counts;
}

async function recordSelection(extensionContext: vscode.ExtensionContext, contextPath: string): Promise<void> {
    const recent = readStringArray(extensionContext, RECENT_KEY).filter((p) => p !== contextPath);
    recent.unshift(contextPath);
    while (recent.length > MAX_RECENT) recent.pop();
    await extensionContext.workspaceState.update(RECENT_KEY, recent);

    const freq = readNumberMap(extensionContext, FREQ_KEY);
    freq[contextPath] = (freq[contextPath] ?? 0) + 1;
    await extensionContext.workspaceState.update(FREQ_KEY, freq);

    const lastOpened = readNumberMap(extensionContext, LAST_OPENED_KEY);
    lastOpened[contextPath] = Date.now();
    await extensionContext.workspaceState.update(LAST_OPENED_KEY, lastOpened);
}

async function switchToContext(store: ContextStore, contextPath: string): Promise<void> {
    // Best-effort: try the canonical command first, then legacy aliases
    // already wired by the welcome page. Finally fall through to activating
    // the context directly on the store so subscribers still see the change.
    const candidates = ['tachikoma.context.switch', 'tachikoma.openInWorkspace', 'tachikoma.switchContext'];
    for (const cmd of candidates) {
        try {
            const all = await vscode.commands.getCommands(true);
            if (!all.includes(cmd)) continue;
            await vscode.commands.executeCommand(cmd, contextPath);
            log(`ContextSwitcher: dispatched ${cmd} for ${contextPath}`);
            return;
        } catch (err) {
            logError(`ContextSwitcher: ${cmd} failed`, err);
        }
    }
    try {
        store.activateContext(contextPath);
        log(`ContextSwitcher: fallback activateContext for ${contextPath}`);
    } catch (err) {
        logError('ContextSwitcher: fallback activateContext failed', err);
    }
}

function readStringArray(extensionContext: vscode.ExtensionContext, key: string): string[] {
    const raw = extensionContext.workspaceState.get<unknown>(key);
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is string => typeof v === 'string');
}

function readNumberMap(extensionContext: vscode.ExtensionContext, key: string): Record<string, number> {
    const raw = extensionContext.workspaceState.get<unknown>(key);
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
}
