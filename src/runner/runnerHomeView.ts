import * as vscode from 'vscode';

/**
 * Placeholder WebviewViewProvider for the dedicated "Runner" activity-bar
 * container (`tachikomaRunner` -> view `tachikomaRunnerHome`).
 *
 * Renders a styled "Runner -- coming soon" panel in the Tachikoma purple
 * glass design language (matching the welcome panel). The real Runner UI
 * (live RPC dispatcher status, agent control, plan stepping) will replace
 * this provider in a follow-up. The view container itself stays stable so
 * the activity-bar icon never disappears between releases.
 *
 * Activation condition (declared in package.json): `tachikoma.connected`.
 * The container icon is always visible (lives under `viewsContainers`),
 * but the view only renders once connected; otherwise VS Code shows the
 * "view is not available" empty state, which is acceptable for a curated
 * placeholder.
 */
export class RunnerHomeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'tachikomaRunnerHome';

    constructor(private readonly context: vscode.ExtensionContext) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _ctx: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        webviewView.webview.options = {
            enableScripts: false,
            localResourceRoots: [this.context.extensionUri],
        };
        webviewView.webview.html = this._buildHtml();
    }

    private _buildHtml(): string {
        // Inline CSP -- webview is isolated from workbench CSS so all
        // styles ship inline. Visual language mirrors the welcome panel:
        // deep purple background, glass card, firefly accent.
        const csp = [
            "default-src 'none'",
            "style-src 'unsafe-inline'",
            "img-src data:",
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Tachikoma Runner</title>
<style>
    :root {
        --tk-bg: #0d0a1f;
        --tk-bg-2: #16102e;
        --tk-purple: #7b4dff;
        --tk-purple-2: #a584ff;
        --tk-purple-dim: rgba(123, 77, 255, 0.28);
        --tk-text: #ece9ff;
        --tk-text-dim: #9a96b8;
        --tk-glass: rgba(255, 255, 255, 0.04);
        --tk-glass-border: rgba(180, 160, 255, 0.18);
        --tk-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
    }
    * { box-sizing: border-box; }
    html, body {
        margin: 0; padding: 0;
        min-height: 100%;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        color: var(--tk-text);
        background:
            radial-gradient(600px 320px at 20% -10%, var(--tk-purple-dim), transparent 70%),
            radial-gradient(500px 280px at 110% 110%, rgba(165, 132, 255, 0.18), transparent 70%),
            linear-gradient(180deg, var(--tk-bg) 0%, var(--tk-bg-2) 100%);
    }
    .wrap {
        padding: 18px 14px;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .card {
        background: var(--tk-glass);
        border: 1px solid var(--tk-glass-border);
        border-radius: 12px;
        padding: 18px 16px;
        box-shadow: var(--tk-shadow);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
    }
    .badge {
        display: inline-block;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--tk-purple-2);
        background: rgba(123, 77, 255, 0.12);
        border: 1px solid var(--tk-glass-border);
        padding: 3px 8px;
        border-radius: 999px;
        margin-bottom: 10px;
    }
    h1 {
        font-size: 16px;
        font-weight: 600;
        margin: 0 0 6px 0;
        background: linear-gradient(135deg, var(--tk-purple-2), #fff 70%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
    }
    p {
        font-size: 12px;
        line-height: 1.55;
        color: var(--tk-text-dim);
        margin: 0;
    }
    .rocket {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px; height: 28px;
        border-radius: 8px;
        background: linear-gradient(135deg, var(--tk-purple), var(--tk-purple-2));
        box-shadow: 0 4px 14px rgba(123, 77, 255, 0.35);
        margin-right: 8px;
        vertical-align: middle;
        color: #fff;
    }
    .row { display: flex; align-items: center; margin-bottom: 8px; }
    ul { padding-left: 16px; margin: 8px 0 0 0; color: var(--tk-text-dim); font-size: 12px; }
    li { margin-bottom: 4px; }
</style>
</head>
<body>
<div class="wrap">
    <div class="card">
        <div class="row">
            <span class="rocket">
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11.5 2.5c-2.5 0-5 2-6.5 5l-1.5.5L4.5 9l1.5-.5.7.7L6.2 10.7l1 1 1.5-.5.7.7-.5 1.5 1.5 1.5.5-1.5c3-1.5 5-4 5-6.5 0-2.5-1.5-4-4-4Z"/>
                    <circle cx="10.5" cy="5.5" r="1"/>
                </svg>
            </span>
            <div>
                <span class="badge">Preview</span>
                <h1>Runner -- coming soon</h1>
            </div>
        </div>
        <p>
            The dedicated Runner surface will host live agent dispatch,
            plan stepping, and WebTransport RPC traces, all in one
            curated panel. The activity-bar icon is reserved so the
            entry point stays stable across releases.
        </p>
        <ul>
            <li>Spawn and steer agents without leaving the IDE</li>
            <li>Live floating panes for shadow workspaces</li>
            <li>Inspect RPC traffic and per-context ACL</li>
        </ul>
    </div>
</div>
</body>
</html>`;
    }
}
