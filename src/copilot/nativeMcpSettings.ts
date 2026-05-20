import * as vscode from 'vscode';
import { log, logError } from '../log';
import type { TachikomaClient, MCPProfile, MCPCapability } from '../api/tachikomaClient';
import type { McpProfileStore } from '../store/mcpProfileStore';

/**
 * Native VS Code WebviewView for MCP profile management.
 *
 * Complements `CopilotWebviewProvider` (which iframes the remote
 * dashboard): when no `tachikoma.copilot.url` is configured the
 * extension still needs a usable settings surface to switch profiles,
 * toggle tools and inspect granted capabilities. This view is that
 * surface, rendered entirely in-extension.
 *
 * The view subscribes to `McpProfileStore`; SSE-driven mutations
 * (active profile changed, tools/list_changed) re-fire the store event
 * which pushes a fresh state frame to the webview.
 *
 * Message protocol (extension <-> webview, JSON over `postMessage`):
 *
 *   extension -> webview
 *     { type: 'state', userId, activeProfileId, profiles, draftToggles }
 *
 *   webview -> extension
 *     { type: 'switch-profile', profile_id }
 *     { type: 'toggle-tool', tool_id, enabled }
 *     { type: 'save' }
 *     { type: 'discard' }
 *     { type: 'refresh' }
 */
export class NativeMcpSettingsProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'tachikomaMcpSettings';

    private webview?: vscode.Webview;
    private draftActiveProfileId: string | null = null;
    /** Tool id -> enabled (only the user-edited subset since last save). */
    private toolToggleDraft: Map<string, boolean> = new Map();
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly client: TachikomaClient,
        private readonly store: McpProfileStore,
    ) {
        this.disposables.push(
            this.store.onDidChange(() => this._postState()),
        );
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _ctx: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this.webview = webviewView.webview;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };
        webviewView.webview.html = this._buildHtml(webviewView.webview);

        this.disposables.push(
            webviewView.webview.onDidReceiveMessage((msg) => {
                this._onMessage(msg).catch((err) =>
                    logError('NativeMcpSettingsProvider: handler failed', err),
                );
            }),
        );

        this._postState();
    }

    private async _onMessage(msg: unknown): Promise<void> {
        if (!msg || typeof msg !== 'object') return;
        const type = (msg as { type?: unknown }).type;
        if (typeof type !== 'string') return;

        switch (type) {
            case 'switch-profile': {
                const id = String((msg as { profile_id?: unknown }).profile_id ?? '');
                this.draftActiveProfileId = id;
                // tool toggles only apply to the currently chosen profile
                this.toolToggleDraft.clear();
                this._postState();
                return;
            }
            case 'toggle-tool': {
                const toolId = String((msg as { tool_id?: unknown }).tool_id ?? '');
                const enabled = Boolean((msg as { enabled?: unknown }).enabled);
                if (!toolId) return;
                this.toolToggleDraft.set(toolId, enabled);
                this._postState();
                return;
            }
            case 'save': {
                await this._saveDraft();
                return;
            }
            case 'discard': {
                this.draftActiveProfileId = null;
                this.toolToggleDraft.clear();
                this._postState();
                return;
            }
            case 'refresh': {
                const uid = this.store.getUserId();
                if (uid) await this.store.refresh(uid);
                return;
            }
            default:
                log(`NativeMcpSettingsProvider: unknown message type ${type}`);
        }
    }

    private async _saveDraft(): Promise<void> {
        const uid = this.store.getUserId();
        if (!uid) {
            vscode.window.showWarningMessage('Tachikoma: no active user, cannot save MCP settings.');
            return;
        }
        // 1) Apply the profile switch through the store (which calls
        //    setActiveProfile under the hood and rolls back on failure).
        if (this.draftActiveProfileId !== null
            && this.draftActiveProfileId !== this.store.getActiveProfileId()) {
            try {
                await this.store.setActive(this.draftActiveProfileId);
            } catch (err) {
                vscode.window.showErrorMessage(
                    `Tachikoma: failed to switch profile (${(err as Error).message})`,
                );
                return;
            }
        }
        // 2) Best-effort PATCH for tool toggles. The backend may not
        //    yet expose this endpoint; a 404 is treated as a no-op so
        //    the rest of the save still succeeds.
        const profileId = this.draftActiveProfileId ?? this.store.getActiveProfileId();
        if (profileId && this.toolToggleDraft.size > 0) {
            const payload = {
                tools: Object.fromEntries(this.toolToggleDraft.entries()),
            };
            try {
                await (this.client as unknown as {
                    request: <T>(method: string, path: string, body?: unknown) => Promise<T>;
                }).request('PATCH', `/api/mcp/profiles/${encodeURIComponent(profileId)}/tools`, payload);
                log(`NativeMcpSettings: tool toggles saved for ${profileId}`);
            } catch (err) {
                const msg = (err as Error).message ?? '';
                if (msg.includes('404')) {
                    log('NativeMcpSettings: tool toggle endpoint not available (404), skipping');
                } else {
                    vscode.window.showWarningMessage(
                        `Tachikoma: tool toggles not applied (${msg})`,
                    );
                }
            }
        }
        this.draftActiveProfileId = null;
        this.toolToggleDraft.clear();
        this._postState();
    }

    private _postState(): void {
        if (!this.webview) return;
        const profiles = this.store.getProfiles().map((p) => ({
            id: p.id,
            profile_name: p.profile_name,
            display_name: p.display_name || p.profile_name,
            icon: p.icon,
            description: p.description,
            state: p.state,
            tool_names: p.tool_names ?? [],
            capabilities: (p.capabilities ?? []).map((c: MCPCapability) => ({
                kind: c.kind,
                id: c.id,
                name: c.name,
                description: c.description ?? '',
            })),
        }));
        this.webview.postMessage({
            type: 'state',
            userId: this.store.getUserId(),
            activeProfileId: this.store.getActiveProfileId(),
            draftActiveProfileId: this.draftActiveProfileId,
            profiles,
            draftToggles: Object.fromEntries(this.toolToggleDraft.entries()),
            dirty: this.draftActiveProfileId !== null || this.toolToggleDraft.size > 0,
        });
    }

    private _nonce(): string {
        let n = '';
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            n += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return n;
    }

    private _buildHtml(webview: vscode.Webview): string {
        const nonce = this._nonce();
        const csp = [
            "default-src 'none'",
            "style-src 'unsafe-inline' " + webview.cspSource,
            `script-src 'nonce-${nonce}'`,
            "img-src " + webview.cspSource + " data:",
            "font-src " + webview.cspSource,
        ].join('; ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  :root {
    --glass-bg: rgba(40, 24, 72, 0.55);
    --glass-bg-strong: rgba(58, 36, 102, 0.78);
    --glass-border: rgba(176, 132, 255, 0.32);
    --glass-border-strong: rgba(176, 132, 255, 0.55);
    --glass-shadow: 0 4px 24px rgba(0, 0, 0, 0.32);
    --accent: #b084ff;
    --accent-soft: rgba(176, 132, 255, 0.18);
    --accent-strong: #d4b6ff;
    --danger: #ff7a8a;
    --text: var(--vscode-foreground);
    --text-muted: var(--vscode-descriptionForeground);
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--text);
    background: transparent;
    margin: 0;
    padding: 12px;
    font-size: var(--vscode-font-size);
  }
  .section {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: var(--glass-shadow);
  }
  .section h3 {
    margin: 0 0 8px 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent-strong);
  }
  select {
    width: 100%;
    background: var(--glass-bg-strong);
    color: var(--text);
    border: 1px solid var(--glass-border-strong);
    border-radius: 6px;
    padding: 6px 8px;
    font: inherit;
    cursor: pointer;
  }
  select:focus { outline: 1px solid var(--accent); }
  .meta {
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
  }
  .tool-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid rgba(176, 132, 255, 0.08);
  }
  .tool-row:last-child { border-bottom: none; }
  .tool-row input[type=checkbox] {
    margin-top: 3px;
    accent-color: var(--accent);
  }
  .tool-info { flex: 1; min-width: 0; }
  .tool-name {
    font-weight: 500;
    font-size: 12px;
    word-break: break-all;
  }
  .tool-desc {
    font-size: 10px;
    color: var(--text-muted);
    margin-top: 2px;
  }
  .scope-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 4px;
  }
  .scope-badge {
    background: var(--accent-soft);
    color: var(--accent-strong);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    padding: 1px 6px;
    font-size: 9px;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .cap-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 200px;
    overflow-y: auto;
  }
  .cap-item {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 11px;
    padding: 3px 0;
  }
  .cap-kind {
    background: var(--glass-bg-strong);
    color: var(--accent-strong);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .cap-id { word-break: break-all; }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 4px;
  }
  button {
    background: var(--glass-bg-strong);
    color: var(--text);
    border: 1px solid var(--glass-border-strong);
    border-radius: 6px;
    padding: 6px 14px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  button:hover:not(:disabled) {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  button.primary {
    background: var(--accent);
    color: #1a0f33;
    border-color: var(--accent-strong);
    font-weight: 600;
  }
  button.primary:hover:not(:disabled) { background: var(--accent-strong); }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  .empty {
    color: var(--text-muted);
    font-size: 11px;
    font-style: italic;
    padding: 8px 0;
  }
  .dirty-indicator {
    color: var(--accent-strong);
    font-size: 10px;
    margin-right: auto;
    align-self: center;
    font-style: italic;
  }
</style>
</head>
<body>
  <div class="section" id="profile-section">
    <h3>Active Profile</h3>
    <select id="profile-picker">
      <option value="">(union - all granted capabilities)</option>
    </select>
    <div class="meta" id="profile-meta"></div>
  </div>

  <div class="section" id="tools-section">
    <h3>Tools</h3>
    <div id="tools-list"><div class="empty">No profile selected.</div></div>
  </div>

  <div class="section" id="caps-section">
    <h3>Capabilities</h3>
    <div class="cap-list" id="caps-list"><div class="empty">No profile selected.</div></div>
  </div>

  <div class="actions">
    <span class="dirty-indicator" id="dirty-indicator"></span>
    <button id="btn-discard" disabled>Discard</button>
    <button id="btn-save" class="primary" disabled>Save</button>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const picker = document.getElementById('profile-picker');
  const meta = document.getElementById('profile-meta');
  const toolsList = document.getElementById('tools-list');
  const capsList = document.getElementById('caps-list');
  const btnSave = document.getElementById('btn-save');
  const btnDiscard = document.getElementById('btn-discard');
  const dirtyInd = document.getElementById('dirty-indicator');

  let state = {
    userId: '',
    activeProfileId: '',
    draftActiveProfileId: null,
    profiles: [],
    draftToggles: {},
    dirty: false,
  };

  picker.addEventListener('change', () => {
    vscode.postMessage({ type: 'switch-profile', profile_id: picker.value });
  });
  btnSave.addEventListener('click', () => vscode.postMessage({ type: 'save' }));
  btnDiscard.addEventListener('click', () => vscode.postMessage({ type: 'discard' }));

  function effectiveProfileId() {
    return state.draftActiveProfileId !== null
      ? state.draftActiveProfileId
      : state.activeProfileId;
  }

  function inferScopes(capName) {
    // Heuristic: tool names like "scope:resource:action" expose a
    // required_scope in the leading prefix. Fall back to '*' if none.
    if (!capName) return ['*'];
    const parts = String(capName).split(/[:.]/);
    return parts.length > 1 ? parts.slice(0, -1) : ['*'];
  }

  function render() {
    // 1) profile dropdown
    picker.innerHTML = '<option value="">(union - all granted capabilities)</option>';
    for (const p of state.profiles) {
      const opt = document.createElement('option');
      opt.value = p.id;
      const icon = p.icon ? p.icon + ' ' : '';
      opt.textContent = icon + p.display_name + ' (' + p.capabilities.length + ' caps)';
      opt.selected = (p.id === effectiveProfileId());
      picker.appendChild(opt);
    }

    const pid = effectiveProfileId();
    const active = state.profiles.find(p => p.id === pid);

    // 2) meta line
    if (active) {
      meta.textContent = 'user=' + (state.userId || '?')
        + '  profile=' + active.profile_name
        + '  state=' + active.state;
    } else {
      meta.textContent = 'user=' + (state.userId || '?') + '  union mode';
    }

    // 3) tools list
    toolsList.innerHTML = '';
    const tools = active
      ? active.capabilities.filter(c => c.kind === 'tool')
      : [];
    if (tools.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = active
        ? 'No tools in this profile.'
        : 'Select a profile to see tools.';
      toolsList.appendChild(empty);
    } else {
      for (const tool of tools) {
        const row = document.createElement('div');
        row.className = 'tool-row';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'tool-' + tool.id;
        const draftVal = state.draftToggles[tool.id];
        cb.checked = draftVal !== undefined ? draftVal : true;
        cb.addEventListener('change', () => {
          vscode.postMessage({
            type: 'toggle-tool',
            tool_id: tool.id,
            enabled: cb.checked,
          });
        });

        const info = document.createElement('div');
        info.className = 'tool-info';

        const label = document.createElement('label');
        label.className = 'tool-name';
        label.htmlFor = cb.id;
        label.textContent = tool.name || tool.id;
        info.appendChild(label);

        if (tool.description) {
          const desc = document.createElement('div');
          desc.className = 'tool-desc';
          desc.textContent = tool.description;
          info.appendChild(desc);
        }

        const badges = document.createElement('div');
        badges.className = 'scope-badges';
        for (const s of inferScopes(tool.name || tool.id)) {
          const b = document.createElement('span');
          b.className = 'scope-badge';
          b.textContent = s;
          badges.appendChild(b);
        }
        info.appendChild(badges);

        row.appendChild(cb);
        row.appendChild(info);
        toolsList.appendChild(row);
      }
    }

    // 4) capabilities (read-only, all kinds)
    capsList.innerHTML = '';
    const caps = active ? active.capabilities : [];
    if (caps.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No capabilities.';
      capsList.appendChild(empty);
    } else {
      for (const cap of caps) {
        const item = document.createElement('div');
        item.className = 'cap-item';
        const kind = document.createElement('span');
        kind.className = 'cap-kind';
        kind.textContent = cap.kind;
        const id = document.createElement('span');
        id.className = 'cap-id';
        id.textContent = cap.name || cap.id;
        item.appendChild(kind);
        item.appendChild(id);
        capsList.appendChild(item);
      }
    }

    // 5) action buttons
    btnSave.disabled = !state.dirty;
    btnDiscard.disabled = !state.dirty;
    dirtyInd.textContent = state.dirty ? 'unsaved changes' : '';
  }

  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (msg && msg.type === 'state') {
      state = msg;
      render();
    }
  });

  render();
</script>
</body>
</html>`;
    }

    dispose(): void {
        for (const d of this.disposables) {
            try { d.dispose(); } catch (err) { logError('NativeMcpSettingsProvider.dispose', err); }
        }
    }
}
