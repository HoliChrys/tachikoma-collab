# Bundle Size Analysis — tachikoma-collab v5.10.0

Analysis-only document. No code changes yet. Source of truth for the next
optimization pass.

## 1. Current State

Measured 2026-05-20 with `esbuild 0.25` from `src/extension.ts`,
`--bundle --format=cjs --platform=node --external:vscode`, no minification.

| Artifact                          | Size (bytes) | Size (KB) |
|-----------------------------------|--------------|-----------|
| `dist/extension.js` (shipped)     | 575,488      | 562.0     |
| `dist/extension.js` (gzip)        | 119,773      | 117.0     |
| Sum of resolved inputs            | 856,141      | 836.1     |
| Inputs from `src/`                | 413,667      | 404.0     |
| Inputs from `node_modules/`       | 442,474      | 432.1     |
| `yjs` + `lib0` + `y-protocols`    | 398,783      | 389.4     |
| `eventsource*` (cjs + esm copies) | 43,691       | 42.7      |
| Vendored transport (msgpack ESM)  | 78,190       | 76.4      |

> The shipped bundle is smaller than the sum of inputs because esbuild
> tree-shakes unused exports and rewrites comments / IIFE boilerplate.

### Growth context

- v4.11 baseline: ~393 KB.
- v5.10 today: ~562 KB (unminified) / ~117 KB gzip.
- Delta: +169 KB (+43%) over the last minor cycle.
- Largest contributors to the growth: agents view (Swarm), Composer panel,
  MCP profile UI (`nativeMcpSettings.ts` alone is 18 KB), terminals stack
  (zellij + tmux + replay), Copilot webview, and the vendored msgpack
  transport pulled in for runner RPC.

### Categorical breakdown

| Category                              | KB    | % of inputs |
|---------------------------------------|-------|-------------|
| First-party `src/`                    | 404.0 | 48.3%       |
| Yjs / lib0 / y-protocols              | 389.4 | 46.6%       |
| Vendored msgpack transport            | 76.4  | 9.1%        |
| eventsource + eventsource-parser      | 42.7  | 5.1%        |
| Other node_modules                    | ~5    | ~0.6%       |

`yjs` + `lib0` together are roughly half of the output and dwarf every other
single contributor.

## 2. Top 20 Contributors

Sorted by input bytes (esbuild metafile). Percentage is share of the 836 KB
input total; the shipped bundle keeps roughly 69% of these inputs.

| #  | Module                                                | Bytes   | KB    | %     |
|----|-------------------------------------------------------|---------|-------|-------|
| 1  | `node_modules/yjs/dist/yjs.mjs`                       | 299,499 | 292.5 | 35.0% |
| 2  | `src/runner/vendor/transport/index.js`                | 78,190  | 76.4  | 9.1%  |
| 3  | `src/extension.ts`                                    | 39,886  | 39.0  | 4.7%  |
| 4  | `node_modules/lib0/encoding.js`                       | 26,567  | 25.9  | 3.1%  |
| 5  | `src/store/contextStore.ts`                           | 25,770  | 25.2  | 3.0%  |
| 6  | `src/auth/authManager.ts`                             | 20,558  | 20.1  | 2.4%  |
| 7  | `src/copilot/nativeMcpSettings.ts`                    | 18,668  | 18.2  | 2.2%  |
| 8  | `node_modules/lib0/decoding.js`                       | 17,847  | 17.4  | 2.1%  |
| 9  | `src/api/tachikomaClient.ts`                          | 17,609  | 17.2  | 2.1%  |
| 10 | `node_modules/eventsource/dist/index.cjs`             | 14,968  | 14.6  | 1.7%  |
| 11 | `node_modules/eventsource/dist/index.js`              | 14,842  | 14.5  | 1.7%  |
| 12 | `src/auth/statusBarItems.ts`                          | 11,736  | 11.5  | 1.4%  |
| 13 | `src/cache/cacheManager.ts`                           | 9,833   | 9.6   | 1.1%  |
| 14 | `src/sessions/sessionsProvider.ts`                    | 9,697   | 9.5   | 1.1%  |
| 15 | `src/copilot/webview.ts`                              | 8,786   | 8.6   | 1.0%  |
| 16 | `src/runner/transport.ts`                             | 8,055   | 7.9   | 0.9%  |
| 17 | `src/composer/composerPanel.ts`                       | 7,929   | 7.7   | 0.9%  |
| 18 | `src/collaborative/collaborationManager.ts`           | 7,642   | 7.5   | 0.9%  |
| 19 | `src/agents/agentsView.ts`                            | 7,473   | 7.3   | 0.9%  |
| 20 | `src/collaborative/sseClient.ts`                      | 7,046   | 6.9   | 0.8%  |

Honorable mentions (positions 21-25): `eventsource-parser` cjs (6.8 KB),
`eventsource-parser` esm (6.7 KB), `floatingPaneManager.ts` (6.6 KB),
`copilot/treeProvider.ts` (6.5 KB), `agents/swarmCommands.ts` (6.2 KB).

## 3. Findings

### F1. Yjs is bundled in full and dominates the artifact

`yjs/dist/yjs.mjs` contributes 292.5 KB pre-tree-shake, and `lib0/encoding`
+ `lib0/decoding` add another 43.3 KB. The actual CRDT surface used by the
extension is narrow — `Y.Doc`, `Y.Text`, encoding/applying updates from the
SSE bridge — yet the entire library (including XmlFragment, Y.Array helpers,
relative positions, the full undo manager, etc.) ships unconditionally.

Yjs is only loaded when a remote computer is attached and live-edit starts.
On a cold extension activation (no connection) it is dead weight.

### F2. `eventsource` is duplicated (CJS + ESM both bundled)

Both `eventsource/dist/index.cjs` (14.6 KB) and `eventsource/dist/index.js`
(14.5 KB) are present in the bundle, plus `eventsource-parser` in both
flavours (6.8 + 6.7 KB). Root cause:

- `src/store/mcpProfileSseBridge.ts` does `import { EventSource } from 'eventsource'`
  — esbuild resolves to the ESM `index.js` via the `import` export condition.
- `src/collaborative/sseClient.ts` uses `const EventSourceImpl = require('eventsource')`
  — esbuild resolves to the CJS `index.cjs` via the `require` condition.

The two resolutions short-circuit the dedupe pass, so every byte of
`eventsource` (~42 KB combined) ships twice.

### F3. Vendored msgpack transport (76 KB) is pre-bundled

`src/runner/vendor/transport/index.js` is a 2,206-line, already-bundled
artifact from `sandbox/webtransport/packages/transport` that inlines the
whole `@msgpack/msgpack` package and the Tachikoma transport wrapper. It
ships verbatim because esbuild treats it as an opaque commonjs blob and
cannot tree-shake encode-only or decode-only paths. The extension only
uses a small subset (RPC over SSE, no WebTransport datagrams).

### F4. Unused / over-declared dependencies in `package.json`

- `ws` (^8.18.2): imported as a *type* in `src/terminal/terminalPanel.ts`,
  but the actual `new WebSocket(...)` call lives **inside a webview HTML
  template string** (xterm.js runs in the iframe, not in Node). Esbuild
  tree-shakes the runtime import, so `ws` is already free in the bundle —
  but the dep declaration causes `npm install` weight and confuses readers.
- `y-protocols` (^1.0.6): declared but not imported anywhere in `src/`.
  Zero bytes in the bundle, dead in `package.json`.
- `@xterm/xterm`, `@xterm/addon-fit`: loaded by the **webview**
  (`vscode.Uri.joinPath(... 'node_modules/@xterm/...')`), never imported
  in Node code. They are correctly outside the extension bundle but must
  remain in `node_modules` (not devDependencies) because `.vsix` ships
  them for the webview.

### F5. Webview HTML/CSS/JS embedded as template literals

Three files inline >2 KB of HTML/CSS/JS each in template strings:

| File                                  | Total | Template-literal bytes | % inlined |
|---------------------------------------|------:|-----------------------:|----------:|
| `src/copilot/nativeMcpSettings.ts`    | 18.7K | 10.7K                  | 57%       |
| `src/terminal/terminalPanel.ts`       | 5.4K  | 2.7K                   | 50%       |
| `src/copilot/webview.ts`              | 8.8K  | 4.2K                   | 48%       |

These strings are parsed by `esbuild` as JS, so they cost the same as code.
They are only used when the webview is opened — moving them to
`media/webviews/*.html|.css|.js` and loading them via
`webview.asWebviewUri` would defer the cost to webview load.

### F6. First-party hot paths bundled eagerly

Several large first-party modules execute only when a feature is activated:

- `src/copilot/nativeMcpSettings.ts` (18 KB) — needed only when the MCP
  settings WebviewView is opened.
- `src/composer/composerPanel.ts` (7.7 KB) — only when `Cmd+I` is hit.
- `src/agents/agentsView.ts` + `agents/swarmCommands.ts` (~14 KB combined)
  — only when the Agents tree is expanded.
- `src/terminal/terminalPanel.ts` + `terminals/*.ts` (~16 KB) — only when
  a terminal is opened.
- `src/copilot/webview.ts` + `treeProvider.ts` + `statusbar.ts` (~16 KB)
  — only when the Copilot view is shown.

All of these are pulled in eagerly through the top-level barrel in
`src/extension.ts` (39 KB on its own, mostly command/provider registration).

### F7. Bundle is unminified

`esbuild` is invoked without `--minify`. Minification typically saves
30-45% on JS bundles of this composition. The gzip ratio (562 KB → 117 KB)
already shows good compressibility, so minification primarily helps cold
parse/load time and disk footprint, not network for VS Code marketplace
(which gzips the .vsix anyway).

## 4. Optimization Recommendations

Ordered by **savings / effort ratio** (highest first). All numbers are
estimates against the 562 KB unminified baseline.

### R1. Enable esbuild minification (effort: 1 min, savings: ~180 KB)

Add `--minify` to the production build script (keep `--sourcemap=external`
so the published map is still useful). Expected output ~360-400 KB
unminified-equivalent, gzip drops to ~90 KB. This is by far the cheapest
win and should be done before any structural change.

### R2. Deduplicate `eventsource` resolution (effort: 5 min, savings: ~28 KB)

Convert `src/collaborative/sseClient.ts` from `const EventSourceImpl = require('eventsource')`
to `import { EventSource } from 'eventsource'` (matching `mcpProfileSseBridge.ts`).
Both call sites now resolve to the ESM build, esbuild dedupes, and one of
the two 14.5 KB copies disappears. The `eventsource-parser` duplicate is a
transitive consequence and will collapse with it (~7 KB additional).
Total: ~28 KB saved, no API surface change.

### R3. Lazy-load Yjs and the collaborative stack (effort: 1-2 h, savings: ~310 KB pre-minify / ~80-100 KB minified)

Wrap `yjs` and `src/collaborative/*` behind a `dynamic import()` triggered
the first time a file enters live-edit mode (i.e. `CollaborationManager.attach()`).
Esbuild emits a separate chunk for the dynamic import; the activation path
no longer pays the 292 KB Yjs cost. Caveats:

- VS Code extensions run as CJS, so `import()` produces a runtime `require`.
  Esbuild needs `--splitting --format=esm` *or* an explicit `// @ts-ignore`
  + manual `require` to make the chunk a sibling file. Easiest path: ship
  Yjs as a sibling `dist/yjs-chunk.js` loaded on demand.
- `src/collaborative/sseClient.ts` (SSE event bus) is also used by
  `mcpProfileSseBridge`, so factor the EventBus out before lazy-loading.

### R4. Code-split feature panels (effort: 2-3 h, savings: ~60-80 KB)

Apply the same lazy-import pattern to:

- `copilot/nativeMcpSettings.ts` + `copilot/webview.ts`
- `composer/composerPanel.ts`
- `agents/agentsView.ts` + `agents/swarmCommands.ts`
- `terminal/terminalPanel.ts` + `terminals/*.ts`

Each becomes a sibling chunk loaded by the command/view registration
callback. Eager activation drops to roughly: `extension.ts` + auth + api +
contextStore + collaborationManager-shell ≈ 180-220 KB before minify.

### R5. Move webview HTML/CSS/JS to `media/webviews/` (effort: 2 h, savings: ~18 KB main bundle + better UX)

Replace inline template literals in:

- `copilot/nativeMcpSettings.ts` (10.7 KB inlined)
- `copilot/webview.ts` (4.2 KB inlined)
- `terminal/terminalPanel.ts` (2.7 KB inlined)

…with files loaded via `webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webviews', '<name>.html'))`.
Side benefits: enables CSP nonces cleanly, lets a designer iterate without
TS rebuild, and lets webview content be cached by VS Code.

### R6. Slim the vendored transport (effort: 4-6 h, savings: ~30-50 KB)

`src/runner/vendor/transport/index.js` is a pre-bundled blob that includes
encode AND decode paths of `@msgpack/msgpack`, plus WebTransport plumbing
that the extension never touches. Two paths:

- **A (light):** re-export only `encode/decode` from the upstream package
  via a thin `src/runner/transport-msgpack.ts` and `npm install @msgpack/msgpack`
  directly. Drops the WebTransport wrapper (~30 KB).
- **B (cleaner):** publish the transport as a proper npm package with ESM
  named exports so esbuild can tree-shake. Bigger refactor, but unblocks
  reuse outside the extension.

### R7. Remove dead `package.json` dependencies (effort: 2 min, savings: 0 bundle KB / ~3 MB install)

Drop `y-protocols` (never imported) and consider whether `ws` should be
`devDependencies` (only used as a TypeScript type). No bundle impact, but
shrinks `.vsix` and clears the dependency story.

### R8. Audit `src/store/contextStore.ts` and `src/auth/authManager.ts` (effort: 1-2 h, savings: 5-15 KB)

Both are 20-25 KB and contain a lot of inline JSON shape converters, retry
logic, and logging strings. Quick wins:

- Extract repeated `log()` formats into helpers (logger already exists).
- Collapse `switch` branches that re-build identical request bodies.
- Move static configuration tables to JSON files loaded once.

Lower priority — wait until R1-R5 land before refactoring first-party.

## 5. Estimated Post-Optimization Size

Cumulative effect (applying R1-R5 in order):

| Step                                       | Unminified | Minified est. | Gzip est. |
|--------------------------------------------|-----------:|--------------:|----------:|
| Baseline v5.10                             | 562 KB     | ~360 KB       | 117 KB    |
| + R1 (minify)                              | —          | 360 KB        | 90 KB     |
| + R2 (dedupe eventsource)                  | —          | 340 KB        | 85 KB     |
| + R3 (lazy Yjs)                            | —          | 180-200 KB    | 50-55 KB  |
| + R4 (lazy panels)                         | —          | 130-150 KB    | 38-45 KB  |
| + R5 (extract webview assets)              | —          | 115-135 KB    | 35-42 KB  |
| + R6 (slim transport)                      | —          | 95-115 KB     | 30-37 KB  |

**Realistic target after R1-R5 (one sprint of work): ~130 KB minified main
chunk + lazy chunks loaded on demand**, vs. 360 KB minified today and 250
KB minified at v4.11. Lazy chunks total ~200 KB but only the chunks for
features the user actually opens are ever parsed.

The fastest path to "back under v4.11 perceived weight" is R1 + R2 + R3:
~3 hours of work for an estimated 60-65% reduction in activation-path
bundle size.

## 6. Out of Scope / Future Work

- **WebTransport datagram path** when added (project_webtransport_implementation)
  will reintroduce binary protocol mass. Slim transport (R6) first.
- **Marketplace `.vsix` size** is dominated by `node_modules/@xterm/*`
  shipped raw for the webview. Out of `dist/extension.js` scope but worth
  checking once R1-R5 land.
- **Sourcemap size**: not measured here; published `extension.js.map`
  weight should also be reviewed before R1 ships.
