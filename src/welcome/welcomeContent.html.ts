/**
 * Tachikoma Welcome — webview HTML template.
 *
 * Returns the full HTML document rendered inside the welcome
 * webview panel. All styles are inlined since webviews are isolated
 * from the workbench CSS (which is why patch 0005 alone could not
 * replace the gettingStarted shell entirely).
 *
 * Visual language mirrors the Tachikoma dashboard:
 *   - deep purple body background
 *   - glass cards (rgba + backdrop blur) over a grid + paper texture
 *   - firefly border accent on the hero
 *   - cubic-bezier(0.22, 1, 0.36, 1) hover transitions
 *
 * Communication contract (postMessage):
 *   extension -> webview : { type: 'state', connected, user, host, contexts, buildSha }
 *   webview   -> extension : { type: 'connect' }
 *                            { type: 'switchContext', path }
 *                            { type: 'openCommand', command, args? }
 *                            { type: 'dismiss' }
 */

export interface WelcomeRenderOptions {
    /** CSP nonce — bound to the single <script> tag. */
    nonce: string;
    /** Webview CSP source (passed through webview.cspSource). */
    cspSource: string;
}

export function buildWelcomeHtml(opts: WelcomeRenderOptions): string {
    const { nonce, cspSource } = opts;

    const csp = [
        "default-src 'none'",
        `img-src ${cspSource} https: data:`,
        `style-src ${cspSource} 'unsafe-inline'`,
        `font-src ${cspSource} https: data:`,
        `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Tachikoma IDE</title>
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
        --tk-glass-hover: rgba(123, 77, 255, 0.12);
        --tk-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
        --tk-ease: cubic-bezier(0.22, 1, 0.36, 1);
    }

    * { box-sizing: border-box; }

    html, body {
        margin: 0;
        padding: 0;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        color: var(--tk-text);
        background:
            radial-gradient(1200px 600px at 20% -10%, var(--tk-purple-dim), transparent 70%),
            radial-gradient(900px 500px at 110% 110%, rgba(165, 132, 255, 0.18), transparent 70%),
            linear-gradient(180deg, var(--tk-bg) 0%, var(--tk-bg-2) 100%);
        background-attachment: fixed;
        overflow-x: hidden;
    }

    /* grid + paper texture overlay */
    body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
            linear-gradient(rgba(180, 160, 255, 0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(180, 160, 255, 0.06) 1px, transparent 1px);
        background-size: 32px 32px;
        opacity: 0.5;
        z-index: 0;
    }

    body::after {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image: radial-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px);
        background-size: 4px 4px;
        z-index: 0;
    }

    .container {
        position: relative;
        z-index: 1;
        max-width: 960px;
        margin: 0 auto;
        padding: 56px 32px 80px;
    }

    /* hero */
    .hero {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        padding: 40px 24px 36px;
        border-radius: 22px;
        background: var(--tk-glass);
        border: 1px solid var(--tk-glass-border);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        box-shadow: var(--tk-shadow);
        overflow: hidden;
    }

    /* firefly border accent */
    .hero::before {
        content: "";
        position: absolute;
        inset: -1px;
        border-radius: 22px;
        padding: 1px;
        background: conic-gradient(
            from 0deg,
            transparent 0%,
            var(--tk-purple-2) 18%,
            transparent 32%,
            transparent 60%,
            var(--tk-purple) 78%,
            transparent 92%
        );
        -webkit-mask:
            linear-gradient(#000 0 0) content-box,
            linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
                mask-composite: exclude;
        opacity: 0.7;
        animation: tk-firefly 14s linear infinite;
        pointer-events: none;
    }

    @keyframes tk-firefly {
        to { transform: rotate(360deg); }
    }

    .hero .logo {
        width: 96px;
        height: 96px;
        filter: drop-shadow(0 6px 18px rgba(123, 77, 255, 0.55));
    }

    .hero h1 {
        margin: 0;
        font-size: 34px;
        font-weight: 700;
        letter-spacing: -0.5px;
        background: linear-gradient(135deg, #ffffff 0%, var(--tk-purple-2) 100%);
        -webkit-background-clip: text;
                background-clip: text;
        -webkit-text-fill-color: transparent;
    }

    .hero .tagline {
        margin: 0;
        font-size: 14px;
        color: var(--tk-text-dim);
        letter-spacing: 0.2px;
    }

    /* status block */
    .status {
        margin-top: 28px;
        padding: 22px 24px;
        border-radius: 16px;
        background: var(--tk-glass);
        border: 1px solid var(--tk-glass-border);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        flex-wrap: wrap;
    }

    .status .label {
        font-size: 13px;
        color: var(--tk-text-dim);
        text-transform: uppercase;
        letter-spacing: 1.5px;
        margin-bottom: 6px;
    }

    .status .value {
        font-size: 18px;
        font-weight: 600;
    }

    .status .value.connected { color: #8effc7; }
    .status .value.disconnected { color: #ff9494; }

    .status .meta {
        font-size: 12px;
        color: var(--tk-text-dim);
        margin-top: 4px;
    }

    .btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 12px 22px;
        border-radius: 12px;
        border: 1px solid transparent;
        background: linear-gradient(135deg, var(--tk-purple) 0%, var(--tk-purple-2) 100%);
        color: #ffffff;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(123, 77, 255, 0.45);
        transition: transform 220ms var(--tk-ease),
                    box-shadow 220ms var(--tk-ease),
                    filter 220ms var(--tk-ease);
    }

    .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 28px rgba(123, 77, 255, 0.6);
        filter: brightness(1.08);
    }

    .btn:active { transform: translateY(0); }

    .btn.ghost {
        background: transparent;
        border-color: var(--tk-glass-border);
        color: var(--tk-text);
        box-shadow: none;
    }

    .btn.ghost:hover {
        background: var(--tk-glass-hover);
        border-color: var(--tk-purple-2);
    }

    /* sections */
    .section { margin-top: 36px; }

    .section h2 {
        margin: 0 0 14px;
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 1.8px;
        color: var(--tk-text-dim);
    }

    /* recent contexts */
    .contexts {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .ctx-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border-radius: 12px;
        background: var(--tk-glass);
        border: 1px solid var(--tk-glass-border);
        cursor: pointer;
        transition: background 260ms var(--tk-ease),
                    border-color 260ms var(--tk-ease),
                    transform 260ms var(--tk-ease);
    }

    .ctx-row:hover {
        background: var(--tk-glass-hover);
        border-color: var(--tk-purple-2);
        transform: translateX(4px);
    }

    .ctx-row .crumbs {
        font-size: 13px;
        color: var(--tk-text);
        font-family: "SF Mono", Menlo, Consolas, monospace;
    }

    .ctx-row .sep {
        color: var(--tk-text-dim);
        margin: 0 6px;
    }

    .ctx-row .arrow {
        margin-left: auto;
        color: var(--tk-text-dim);
        font-size: 16px;
    }

    .empty-hint {
        font-size: 13px;
        color: var(--tk-text-dim);
        padding: 12px 0;
    }

    /* quick action tiles */
    .tiles {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 14px;
    }

    .tile {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 18px;
        border-radius: 14px;
        background: var(--tk-glass);
        border: 1px solid var(--tk-glass-border);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        cursor: pointer;
        transition: background 260ms var(--tk-ease),
                    border-color 260ms var(--tk-ease),
                    transform 260ms var(--tk-ease),
                    box-shadow 260ms var(--tk-ease);
    }

    .tile:hover {
        background: var(--tk-glass-hover);
        border-color: var(--tk-purple-2);
        transform: translateY(-3px);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
    }

    .tile .icon {
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        background: linear-gradient(135deg, var(--tk-purple) 0%, var(--tk-purple-2) 100%);
        color: #fff;
        font-size: 16px;
    }

    .tile .title {
        font-size: 14px;
        font-weight: 600;
        color: var(--tk-text);
    }

    .tile .desc {
        font-size: 12px;
        color: var(--tk-text-dim);
        line-height: 1.4;
    }

    .tile[disabled],
    .tile.placeholder {
        cursor: not-allowed;
        opacity: 0.55;
    }

    .tile .badge {
        align-self: flex-start;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 1px;
        padding: 2px 8px;
        border-radius: 6px;
        background: var(--tk-purple-dim);
        color: var(--tk-purple-2);
    }

    /* footer */
    .footer {
        margin-top: 48px;
        padding: 18px 4px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        font-size: 11px;
        color: var(--tk-text-dim);
        border-top: 1px solid var(--tk-glass-border);
    }

    .footer a {
        color: var(--tk-text-dim);
        text-decoration: none;
        transition: color 200ms var(--tk-ease);
    }

    .footer a:hover { color: var(--tk-purple-2); }

    .footer .sha {
        font-family: "SF Mono", Menlo, Consolas, monospace;
    }

    .row-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
    }

    .ctx-picker {
        font-size: 12px;
        color: var(--tk-text-dim);
        background: transparent;
        border: 1px solid var(--tk-glass-border);
        color: var(--tk-text);
        padding: 6px 10px;
        border-radius: 8px;
        cursor: pointer;
    }

    .hidden { display: none !important; }
</style>
</head>
<body>
    <main class="container">
        <!-- HERO -->
        <section class="hero" aria-label="Tachikoma">
            <svg class="logo" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <defs>
                    <radialGradient id="body-grad" cx="50%" cy="40%" r="55%">
                        <stop offset="0%" stop-color="#ece9ff"/>
                        <stop offset="60%" stop-color="#a584ff"/>
                        <stop offset="100%" stop-color="#5a32d8"/>
                    </radialGradient>
                    <linearGradient id="leg-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#a584ff"/>
                        <stop offset="100%" stop-color="#4a2bb5"/>
                    </linearGradient>
                </defs>
                <!-- legs -->
                <g stroke="url(#leg-grad)" stroke-width="3" stroke-linecap="round" fill="none">
                    <path d="M60 60 L24 32"/>
                    <path d="M60 60 L18 56"/>
                    <path d="M60 60 L24 88"/>
                    <path d="M60 60 L48 102"/>
                    <path d="M60 60 L96 32"/>
                    <path d="M60 60 L102 56"/>
                    <path d="M60 60 L96 88"/>
                    <path d="M60 60 L72 102"/>
                </g>
                <!-- foot dots -->
                <g fill="#a584ff">
                    <circle cx="24" cy="32" r="3"/>
                    <circle cx="18" cy="56" r="3"/>
                    <circle cx="24" cy="88" r="3"/>
                    <circle cx="48" cy="102" r="3"/>
                    <circle cx="96" cy="32" r="3"/>
                    <circle cx="102" cy="56" r="3"/>
                    <circle cx="96" cy="88" r="3"/>
                    <circle cx="72" cy="102" r="3"/>
                </g>
                <!-- body -->
                <circle cx="60" cy="60" r="22" fill="url(#body-grad)" stroke="#ece9ff" stroke-width="1.5"/>
                <!-- three eyes -->
                <circle cx="52" cy="56" r="3" fill="#1a0f3d"/>
                <circle cx="60" cy="54" r="3" fill="#1a0f3d"/>
                <circle cx="68" cy="56" r="3" fill="#1a0f3d"/>
                <!-- highlight -->
                <ellipse cx="56" cy="50" rx="6" ry="3" fill="rgba(255,255,255,0.6)"/>
            </svg>
            <h1>Tachikoma IDE</h1>
            <p class="tagline">Your AI agents deserve real infrastructure.</p>
        </section>

        <!-- STATUS BLOCK -->
        <section class="status" id="status">
            <div>
                <div class="label">Status</div>
                <div class="value disconnected" id="status-value">Not connected</div>
                <div class="meta" id="status-meta">No Tachikoma session detected on this machine.</div>
            </div>
            <div class="row-actions" id="status-actions">
                <button class="btn" id="btn-connect" type="button">
                    <span aria-hidden="true">$(rocket)</span>
                    <span>Connect to Tachikoma Cloud</span>
                </button>
            </div>
        </section>

        <!-- RECENT CONTEXTS -->
        <section class="section hidden" id="contexts-section">
            <h2>Recent contexts</h2>
            <div class="contexts" id="contexts-list"></div>
        </section>

        <!-- QUICK ACTIONS -->
        <section class="section">
            <h2>Quick actions</h2>
            <div class="tiles" id="tiles">
                <div class="tile" data-cmd="tachikomaContextTree.focus">
                    <span class="icon" aria-hidden="true">$(repo)</span>
                    <div class="title">Browse monorepo</div>
                    <div class="desc">Galaxies, systems, spaces - open any context in your workspace.</div>
                </div>
                <div class="tile" data-cmd="workbench.action.chat.open" data-args='{"query":"@tachikoma "}'>
                    <span class="icon" aria-hidden="true">$(comment-discussion)</span>
                    <div class="title">Start chat with @tachikoma</div>
                    <div class="desc">Talk to your agents through the Hermes runtime.</div>
                </div>
                <div class="tile" data-cmd="tachikoma.agents.spawn">
                    <span class="icon" aria-hidden="true">$(rocket)</span>
                    <div class="title">Spawn local agent</div>
                    <div class="desc">Run a Tachikoma agent on this machine via the local daemon.</div>
                </div>
                <div class="tile placeholder" data-cmd="">
                    <span class="badge">Soon</span>
                    <span class="icon" aria-hidden="true">$(symbol-color)</span>
                    <div class="title">Open Canvas (whiteboard)</div>
                    <div class="desc">Live multi-agent whiteboard - coming in a future release.</div>
                </div>
                <div class="tile" data-cmd="tachikoma.mcp.selectProfile">
                    <span class="icon" aria-hidden="true">$(plug)</span>
                    <div class="title">Configure MCP profile</div>
                    <div class="desc">Scope agent tools and capabilities for this workspace.</div>
                </div>
                <div class="tile" data-cmd="tachikoma.openZellij">
                    <span class="icon" aria-hidden="true">$(terminal)</span>
                    <div class="title">Open zellij session</div>
                    <div class="desc">Attach the shared remote terminal session.</div>
                </div>
            </div>
        </section>

        <!-- FOOTER -->
        <footer class="footer">
            <div class="sha" id="footer-sha">build dev</div>
            <div class="row-actions">
                <a href="#" id="link-release-notes">Release notes</a>
                <a href="#" id="link-settings">Settings</a>
                <a href="#" id="link-dismiss">Dismiss</a>
            </div>
        </footer>
    </main>

<script nonce="${nonce}">
    (function () {
        const vscode = acquireVsCodeApi();

        const elStatusValue = document.getElementById('status-value');
        const elStatusMeta = document.getElementById('status-meta');
        const elStatusActions = document.getElementById('status-actions');
        const elContextsSection = document.getElementById('contexts-section');
        const elContextsList = document.getElementById('contexts-list');
        const elFooterSha = document.getElementById('footer-sha');

        document.getElementById('btn-connect')?.addEventListener('click', function () {
            vscode.postMessage({ type: 'connect' });
        });

        document.getElementById('link-release-notes')?.addEventListener('click', function (e) {
            e.preventDefault();
            vscode.postMessage({ type: 'openCommand', command: 'tachikoma.showOutput' });
        });

        document.getElementById('link-settings')?.addEventListener('click', function (e) {
            e.preventDefault();
            vscode.postMessage({
                type: 'openCommand',
                command: 'workbench.action.openSettings',
                args: '@ext:Tachikoma.tachikoma-collab',
            });
        });

        document.getElementById('link-dismiss')?.addEventListener('click', function (e) {
            e.preventDefault();
            vscode.postMessage({ type: 'dismiss' });
        });

        const tiles = document.querySelectorAll('.tile');
        tiles.forEach(function (tile) {
            tile.addEventListener('click', function () {
                if (tile.classList.contains('placeholder')) return;
                const cmd = tile.getAttribute('data-cmd');
                if (!cmd) return;
                const argsRaw = tile.getAttribute('data-args');
                let args;
                if (argsRaw) {
                    try { args = JSON.parse(argsRaw); } catch (e) { args = undefined; }
                }
                vscode.postMessage({ type: 'openCommand', command: cmd, args: args });
            });
        });

        function renderContexts(contexts) {
            elContextsList.innerHTML = '';
            if (!contexts || contexts.length === 0) {
                const hint = document.createElement('div');
                hint.className = 'empty-hint';
                hint.textContent = 'No active contexts yet. Open one from the Tachikoma sidebar.';
                elContextsList.appendChild(hint);
                return;
            }
            contexts.forEach(function (path) {
                const parts = String(path).split(/[\\.\\/]/).filter(Boolean);
                const row = document.createElement('div');
                row.className = 'ctx-row';
                row.setAttribute('role', 'button');
                row.setAttribute('tabindex', '0');

                const crumbs = document.createElement('div');
                crumbs.className = 'crumbs';
                parts.forEach(function (p, idx) {
                    const seg = document.createElement('span');
                    seg.textContent = p;
                    crumbs.appendChild(seg);
                    if (idx < parts.length - 1) {
                        const sep = document.createElement('span');
                        sep.className = 'sep';
                        sep.textContent = '>';
                        crumbs.appendChild(sep);
                    }
                });

                const arrow = document.createElement('span');
                arrow.className = 'arrow';
                arrow.textContent = '->';

                row.appendChild(crumbs);
                row.appendChild(arrow);
                row.addEventListener('click', function () {
                    vscode.postMessage({ type: 'switchContext', path: path });
                });
                row.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        vscode.postMessage({ type: 'switchContext', path: path });
                    }
                });
                elContextsList.appendChild(row);
            });
        }

        function applyState(state) {
            if (state.connected) {
                elStatusValue.textContent = 'Connected as ' + (state.user || 'unknown')
                    + (state.host ? ' @ ' + state.host : '');
                elStatusValue.classList.remove('disconnected');
                elStatusValue.classList.add('connected');
                elStatusMeta.textContent = (state.contexts && state.contexts.length)
                    ? state.contexts.length + ' active context(s)'
                    : 'No active context yet - open one from the sidebar.';
                elStatusActions.innerHTML = '';
                const btn = document.createElement('button');
                btn.className = 'btn ghost';
                btn.type = 'button';
                btn.textContent = 'Switch context';
                btn.addEventListener('click', function () {
                    vscode.postMessage({ type: 'openCommand', command: 'tachikomaContextTree.focus' });
                });
                elStatusActions.appendChild(btn);
                elContextsSection.classList.remove('hidden');
                renderContexts(state.contexts || []);
            } else {
                elStatusValue.textContent = 'Not connected';
                elStatusValue.classList.remove('connected');
                elStatusValue.classList.add('disconnected');
                elStatusMeta.textContent = 'No Tachikoma session detected on this machine.';
                elStatusActions.innerHTML = '';
                const btn = document.createElement('button');
                btn.className = 'btn';
                btn.id = 'btn-connect';
                btn.type = 'button';
                btn.textContent = 'Connect to Tachikoma Cloud';
                btn.addEventListener('click', function () {
                    vscode.postMessage({ type: 'connect' });
                });
                elStatusActions.appendChild(btn);
                elContextsSection.classList.add('hidden');
            }
            if (state.buildSha) {
                elFooterSha.textContent = 'build ' + state.buildSha;
            }
        }

        window.addEventListener('message', function (event) {
            const msg = event.data;
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'state') {
                applyState(msg);
            }
        });

        // Signal ready so the host can post initial state.
        vscode.postMessage({ type: 'ready' });
    })();
</script>
</body>
</html>`;
}
