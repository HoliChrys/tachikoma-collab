import * as vscode from 'vscode';
import type { McpProfileStore } from '../store/mcpProfileStore';

/**
 * Statusbar item that exposes the active MCP profile and acts as a
 * one-click QuickPick switcher (via `tachikoma.mcp.selectProfile`).
 *
 * Rendering rules:
 *  - No active profile → `$(symbol-method) MCP: union`
 *    (lets the user know that *every* granted capability is exposed —
 *     i.e. no scoping is in effect).
 *  - Active profile set →`{icon} {display_name}`
 *    where icon defaults to `$(symbol-method)` when the profile has
 *    no emoji.
 *  - Tooltip carries the long form + capability count.
 */
export function registerMcpStatusBar(
    context: vscode.ExtensionContext,
    store: McpProfileStore,
): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        99,  // just to the left of standard status entries
    );
    item.command = 'tachikoma.mcp.selectProfile';
    item.show();

    const render = () => {
        const active = store.getActiveProfile();
        if (!active) {
            item.text = '$(symbol-method) MCP: union';
            item.tooltip = new vscode.MarkdownString(
                '**MCP profile** — no active profile selected\n\n'
                + 'Click to choose one of your granted profiles, or stay '
                + 'on *union* to expose every granted capability.',
            );
            return;
        }
        const icon = active.icon || '$(symbol-method)';
        item.text = `${icon} ${active.display_name || active.profile_name}`;
        const caps = active.capabilities?.length ?? 0;
        const md = new vscode.MarkdownString(
            `**MCP profile:** \`${active.profile_name}\`\n\n`
            + `${active.description || '_(no description)_'}\n\n`
            + `**${caps}** capabilit${caps === 1 ? 'y' : 'ies'} active\n\n`
            + 'Click to switch profile.',
        );
        md.supportHtml = false;
        item.tooltip = md;
    };

    render();
    const sub = store.onDidChange(render);

    context.subscriptions.push(item, sub);
    return item;
}
