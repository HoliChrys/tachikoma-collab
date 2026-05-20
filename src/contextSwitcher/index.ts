import * as vscode from 'vscode';
import type { AuthManager } from '../auth/authManager';
import type { ContextStore } from '../store/contextStore';
import { log, logError } from '../log';
import { openContextSwitcher } from './contextSwitcher';

export const COMMAND_QUICK_SWITCH = 'tachikoma.context.quickSwitch';
export const COMMAND_LIST = 'tachikoma.context.list';
export const COMMAND_SWITCH = 'tachikoma.context.switch';

/**
 * Shape returned by `tachikoma.context.list`.
 *
 * Cross-extension contract -- consumed by the IDE-side Tachikoma sidebar
 * (`src/vs/workbench/browser/tachikoma/sidebar/tachikomaSidebar.ts`) and any
 * other extension that wants to render the user's available contexts. Keep
 * this stable: bumping the shape requires a minor version bump of the
 * collab extension and a coordinated sidebar update.
 */
export interface ContextListItem {
    /** Dotted context path, e.g. `tachikoma.parallele.vscode`. Stable id. */
    readonly id: string;
    /** Same as `id` -- kept separate so future variants can split them. */
    readonly path: string;
    /** Human-readable last-segment label. */
    readonly name: string;
    /** Whether this context is currently active (has open buffers). */
    readonly active: boolean;
    /** `galaxy` | `system` | `space` -- useful for icon selection. */
    readonly type: string;
}

/**
 * Register the Tachikoma context quick switcher with VS Code.
 *
 * Wires up three commands:
 *  - `tachikoma.context.quickSwitch` : QuickPick UI (Cmd/Ctrl+Shift+H).
 *  - `tachikoma.context.list`        : returns `ContextListItem[]` for
 *                                       cross-extension consumers (sidebar).
 *  - `tachikoma.context.switch`      : takes a context path, activates it
 *                                       on the store. Subscribers can listen
 *                                       to `ICommandService.onDidExecuteCommand`
 *                                       to refresh after a switch.
 *
 * The caller (extension.ts) is responsible for pushing the returned
 * Disposable to its subscriptions so commands are unregistered on
 * deactivate.
 */
export function registerContextSwitcher(
    context: vscode.ExtensionContext,
    authManager: AuthManager,
    contextStore: ContextStore,
): vscode.Disposable {
    const quickSwitch = vscode.commands.registerCommand(COMMAND_QUICK_SWITCH, async () => {
        try {
            await openContextSwitcher(context, authManager, contextStore);
        } catch (err) {
            logError('ContextSwitcher: command handler failed', err);
            vscode.window.showErrorMessage('Tachikoma: context switcher failed -- see logs.');
        }
    });

    const list = vscode.commands.registerCommand(COMMAND_LIST, (): ContextListItem[] => {
        try {
            const nodes = contextStore.getAllNodes();
            return nodes.map((n) => ({
                id: n.path,
                path: n.path,
                name: n.name,
                active: n.active,
                type: n.type,
            }));
        } catch (err) {
            logError('ContextSwitcher: list handler failed', err);
            return [];
        }
    });

    const switchCmd = vscode.commands.registerCommand(COMMAND_SWITCH, async (arg: unknown): Promise<boolean> => {
        try {
            // Accept either a raw string id or `{id: string}` / `{path: string}`.
            let target: string | undefined;
            if (typeof arg === 'string') {
                target = arg;
            } else if (arg && typeof arg === 'object') {
                const o = arg as { id?: unknown; path?: unknown };
                if (typeof o.id === 'string') target = o.id;
                else if (typeof o.path === 'string') target = o.path;
            }
            if (!target) {
                log('ContextSwitcher: switch called with no target');
                return false;
            }
            if (!contextStore.getNode(target)) {
                log(`ContextSwitcher: switch target unknown: ${target}`);
                return false;
            }
            contextStore.activateContext(target);
            log(`ContextSwitcher: activated ${target}`);
            return true;
        } catch (err) {
            logError('ContextSwitcher: switch handler failed', err);
            return false;
        }
    });

    log('ContextSwitcher: registered tachikoma.context.{quickSwitch,list,switch}');
    return vscode.Disposable.from(quickSwitch, list, switchCmd);
}

export { openContextSwitcher };
