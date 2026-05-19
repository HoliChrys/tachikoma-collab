import * as vscode from 'vscode';
import { log, logError } from '../log';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { McpProfileStore } from '../store/mcpProfileStore';

/**
 * Webview view provider for the embedded Copilot UI.
 *
 * Two render modes (chosen at runtime by `_buildHtml()`):
 *
 *  1. **Remote dashboard** — when `tachikoma.copilot.url` is set
 *     (or auto-derived from the API base URL), we embed the
 *     dashboard's `/copilot?webview=1&token=...&user=...` page in an
 *     iframe. The dashboard ships the proven CopilotKit chat with the
 *     MCPProfilePicker injected — zero duplication.
 *
 *  2. **Local fallback** — when no dashboard is reachable (or the user
 *     opted out), we render an in-extension HTML page with just the
 *     profile picker + a "Open in dashboard" CTA. The chat itself
 *     isn't reimplemented locally; the picker is the minimal viable
 *     surface so the user can still switch profiles without leaving
 *     VS Code.
 *
 * Communication: `postMessage` JSON.
 *   extension → webview: `{type: 'state', profiles, activeProfileId, userId}`
 *   webview → extension: `{type: 'switch-profile', profile_id: '...'}`
 *                        `{type: 'open-dashboard'}`
 *                        `{type: 'refresh'}`
 */
export class CopilotWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'tachikomaCopilot';

    private webview?: vscode.Webview;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly client: TachikomaClient,
        private readonly store: McpProfileStore,
    ) {
        store.onDidChange(() => this._postState());
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this.webview = webviewView.webview;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };
        webviewView.webview.html = this._buildHtml();

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            await this._onMessage(msg);
        });

        // Push initial state
        this._postState();
    }

    private async _onMessage(msg: any): Promise<void> {
        const type = msg?.type;
        if (!type) return;
        try {
            if (type === 'switch-profile') {
                const id = String(msg.profile_id ?? '');
                await this.store.setActive(id);
            } else if (type === 'open-dashboard') {
                const url = this._dashboardUrl();
                if (url) {
                    vscode.env.openExternal(vscode.Uri.parse(url));
                }
            } else if (type === 'refresh') {
                const uid = this.store.getUserId();
                if (uid) await this.store.refresh(uid);
            }
        } catch (err) {
            logError(`CopilotWebviewProvider: message ${type} failed`, err);
        }
    }

    private _postState(): void {
        if (!this.webview) return;
        const profiles = this.store.getProfiles().map(p => ({
            id: p.id,
            profile_name: p.profile_name,
            display_name: p.display_name || p.profile_name,
            icon: p.icon,
            description: p.description,
            state: p.state,
            caps_count: p.capabilities?.length ?? 0,
        }));
        this.webview.postMessage({
            type: 'state',
            profiles,
            activeProfileId: this.store.getActiveProfileId(),
            userId: this.store.getUserId(),
            dashboardUrl: this._dashboardUrl(),
        });
    }

    private _dashboardUrl(): string | undefined {
        const cfg = vscode.workspace.getConfiguration('tachikoma');
        const explicit = cfg.get<string>('copilot.url') || '';
        if (explicit) return explicit;
        // Auto-derive: if API is at http://host:8000 → dashboard typically
        // on :3000 or accessible at /. Skip auto-derive — too brittle.
        return undefined;
    }

    private _buildHtml(): string {
        const url = this._dashboardUrl();
        const token = this.client.getToken() ?? '';
        const csp =
            "default-src 'none'; "
            + "style-src 'unsafe-inline'; "
            + "script-src 'unsafe-inline'; "
            + "frame-src http: https:; "
            + "img-src https: data: vscode-resource:; ";

        // Always render the local UI (picker + capability summary).
        // If a dashboard URL is configured, expose an iframe below the
        // picker so the user gets the full CopilotKit chat too.
        const iframe = url
            ? `<iframe id="copilot-iframe" src="${url}?webview=1&token=${encodeURIComponent(token)}&user=${encodeURIComponent(this.store.getUserId())}"></iframe>`
            : `<div class="empty">
                 No dashboard URL configured.
                 Set <code>tachikoma.copilot.url</code> to embed the full Copilot chat,
                 or use <a href="#" id="open-dash">open in dashboard</a> if available.
               </div>`;

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .header {
    padding: 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  select, button {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    padding: 6px 10px;
    font: inherit;
    cursor: pointer;
  }
  .meta {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  .caps {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .caps span {
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 8px;
    padding: 1px 6px;
    font-size: 10px;
  }
  iframe {
    flex: 1;
    border: 0;
    background: var(--vscode-editor-background);
  }
  .empty {
    flex: 1;
    padding: 16px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
  code {
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 4px;
    border-radius: 3px;
  }
  a { color: var(--vscode-textLink-foreground); }
</style>
</head>
<body>
  <div class="header">
    <label for="profile-picker"><strong>Active MCP profile</strong></label>
    <select id="profile-picker">
      <option value="">(union — all granted capabilities)</option>
    </select>
    <div class="meta" id="meta"></div>
    <div class="caps" id="caps"></div>
  </div>
  ${iframe}
<script>
  const vscode = acquireVsCodeApi();
  const picker = document.getElementById('profile-picker');
  const meta = document.getElementById('meta');
  const caps = document.getElementById('caps');
  let state = { profiles: [], activeProfileId: '', userId: '' };

  picker.addEventListener('change', () => {
    vscode.postMessage({ type: 'switch-profile', profile_id: picker.value });
  });

  const openDash = document.getElementById('open-dash');
  if (openDash) {
    openDash.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'open-dashboard' });
    });
  }

  function render() {
    picker.innerHTML = '<option value="">(union — all granted capabilities)</option>';
    for (const p of state.profiles) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = (p.icon ? p.icon + ' ' : '') + p.display_name + ' — ' + p.caps_count + ' caps';
      opt.selected = (p.id === state.activeProfileId);
      picker.appendChild(opt);
    }
    const active = state.profiles.find(p => p.id === state.activeProfileId);
    meta.textContent = active
      ? 'user=' + (state.userId || '?') + ' • profile=' + active.profile_name
      : 'user=' + (state.userId || '?') + ' • union mode';
    caps.innerHTML = '';
    if (active) {
      // We don't have detailed caps in the slim state — show count only
      const tag = document.createElement('span');
      tag.textContent = active.caps_count + ' capabilities';
      caps.appendChild(tag);
    }
  }

  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (msg.type === 'state') {
      state = msg;
      render();
    }
  });
  render();
</script>
</body>
</html>`;
    }
}
