import * as vscode from 'vscode';
import type { McpProfileStore } from '../store/mcpProfileStore';
import type { MCPCapability, MCPProfile } from '../api/tachikomaClient';

type NodeKind =
    | 'root'           // "MCP Copilot"
    | 'active'         // "Active: {profile_name}" or "(no profile)"
    | 'profile'        // sub-profile listing (when union mode)
    | 'capability_bucket'  // "Tools (N)" etc.
    | 'capability'     // leaf capability item
    | 'action';        // "Switch profile…" / "Refresh"

interface TreeNode {
    kind: NodeKind;
    label: string;
    description?: string;
    /** For `capability_bucket` and `profile`: the sub-list. */
    children?: TreeNode[];
    /** For `capability`: the raw record (for hover). */
    capability?: MCPCapability;
    /** For `profile`: the raw record. */
    profile?: MCPProfile;
    /** Optional command (e.g. on `action` nodes). */
    command?: vscode.Command;
    /** Icon override. */
    iconPath?: vscode.ThemeIcon | string;
}

const KIND_TO_LABEL: Record<string, string> = {
    tool: 'Tools',
    ui: 'UI Elements',
    resource: 'Resources',
    prompt: 'Prompts',
};
const KIND_TO_ICON: Record<string, string> = {
    tool: 'tools',
    ui: 'window',
    resource: 'database',
    prompt: 'comment-discussion',
};

/**
 * TreeView under the `tachikomaExplorer` view container.
 *
 * Lazy rendering — children are produced on demand by `getChildren()`,
 * so refreshing on every `McpProfileStore.onDidChange` is cheap (only
 * the visible nodes are re-resolved).
 *
 * Layout when an active profile is set:
 *
 *   MCP Copilot
 *   ├─ Active: ubuntu-default  🐧
 *   ├─ Tools (11)
 *   │  ├─ workflow.query_knowledge
 *   │  ├─ workflow.create_plan
 *   │  └─ …
 *   ├─ UI Elements (0)
 *   ├─ Resources (0)
 *   ├─ Prompts (0)
 *   ├─ ⚡ Switch profile…
 *   └─ ↻ Refresh
 *
 * In union mode (no active profile), the bucket children regroup
 * capabilities from every granted profile.
 */
export class McpCopilotTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private readonly _emitter = new vscode.EventEmitter<TreeNode | void>();
    readonly onDidChangeTreeData = this._emitter.event;

    constructor(private readonly store: McpProfileStore) {
        store.onDidChange(() => this._emitter.fire());
    }

    getTreeItem(node: TreeNode): vscode.TreeItem {
        const collapsibleKinds: NodeKind[] = ['root', 'capability_bucket', 'profile'];
        const item = new vscode.TreeItem(
            node.label,
            collapsibleKinds.includes(node.kind)
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None,
        );
        item.description = node.description;
        item.command = node.command;
        if (node.iconPath instanceof vscode.ThemeIcon) {
            item.iconPath = node.iconPath;
        } else if (typeof node.iconPath === 'string') {
            item.iconPath = new vscode.ThemeIcon(node.iconPath);
        }
        if (node.kind === 'capability' && node.capability) {
            item.tooltip = new vscode.MarkdownString(
                `**${node.capability.kind}** ${node.capability.id}\n\n`
                + (node.capability.description || '_(no description)_'),
            );
        }
        item.contextValue = node.kind;
        return item;
    }

    getChildren(element?: TreeNode): TreeNode[] {
        if (!element) {
            return [this._buildRoot()];
        }
        return element.children ?? [];
    }

    // ── Build the tree ────────────────────────────────────────────────

    private _buildRoot(): TreeNode {
        const active = this.store.getActiveProfile();
        const children: TreeNode[] = [];

        if (active) {
            children.push({
                kind: 'active',
                label: `Active: ${active.display_name || active.profile_name}`,
                description: active.icon || '',
                iconPath: 'star-full',
            });
        } else {
            children.push({
                kind: 'active',
                label: '(no active profile — union mode)',
                iconPath: 'circle-outline',
            });
        }

        // 4 capability buckets
        const caps = this.store.listCapabilitiesByKind();
        for (const kind of ['tool', 'ui', 'resource', 'prompt'] as const) {
            const ids = caps[kind] ?? [];
            children.push({
                kind: 'capability_bucket',
                label: `${KIND_TO_LABEL[kind]} (${ids.length})`,
                iconPath: KIND_TO_ICON[kind],
                children: ids.map(id => ({
                    kind: 'capability' as const,
                    label: id,
                    capability: { kind, id, name: id },
                })),
            });
        }

        // If union mode, also expose each profile as a sub-tree
        if (!active) {
            const profiles = this.store.getProfiles();
            if (profiles.length > 0) {
                children.push({
                    kind: 'capability_bucket',
                    label: `Granted profiles (${profiles.length})`,
                    iconPath: 'person',
                    children: profiles.map(p => this._profileNode(p)),
                });
            }
        }

        // Actions
        children.push({
            kind: 'action',
            label: 'Switch profile…',
            iconPath: 'arrow-swap',
            command: {
                command: 'tachikoma.mcp.selectProfile',
                title: 'Switch profile',
            },
        });
        children.push({
            kind: 'action',
            label: 'Refresh',
            iconPath: 'refresh',
            command: {
                command: 'tachikoma.mcp.refresh',
                title: 'Refresh',
            },
        });

        return {
            kind: 'root',
            label: 'MCP Copilot',
            children,
        };
    }

    private _profileNode(p: MCPProfile): TreeNode {
        const caps = p.capabilities ?? [];
        return {
            kind: 'profile',
            label: p.display_name || p.profile_name,
            description: p.state === 'active' ? `${caps.length} caps` : `(${p.state})`,
            profile: p,
            iconPath: p.state === 'active' ? 'check' : 'circle-slash',
            children: caps.map(c => ({
                kind: 'capability' as const,
                label: `${c.kind}:${c.id}`,
                capability: c,
            })),
        };
    }
}
