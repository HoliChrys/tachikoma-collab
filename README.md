<div align="center">

<img src="media/icon-128.png" alt="Tachikoma" width="128" height="128" />

# Tachikoma Collab

**Bring your Tachikoma computer into VS Code — browse contexts, edit remotely, share terminals, and live-collaborate.**

[![Version](https://img.shields.io/badge/version-5.8.1-blue)](https://github.com/HoliChrys/tachikoma-collab)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.95%2B-007ACC)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

</div>

---

## What is Tachikoma?

**Tachikoma** is a multi-user, multi-machine development platform that turns a monorepo into a graph of *contexts* (galaxies, systems, spaces) shared by humans and AI agents. Each context carries its own venv, sessions, secrets, agents, and live state — all synced across the machines that mount it.

The **Tachikoma Collab** extension is the official VS Code client for that platform. It connects to a Tachikoma backend over HTTPS/SSE/WebSocket, mounts the remote monorepo as a virtual file system, surfaces collaborators and terminal sessions in the activity bar, and bridges your editor into the same CRDT (Y.Doc) realtime channel the rest of your team is editing on.

It works equally well as a **built-in component of Tachikoma IDE** (our Code-OSS fork) or as a **standalone extension in vanilla VS Code** — install it from the marketplace, point it at a Tachikoma computer, and you are in.

## Features

- **Context browser** — Navigate galaxy → system → space → folder/file. Files load through the `tachikoma://` virtual FS, no SSH or Remote-SSH required.
- **Live collaboration (CRDT)** — Y.Doc-backed real-time editing with colored cursors, presence, and selection broadcast. Conflict-free across an arbitrary number of clients.
- **Collaborators view** — See who is active on each context, resolved from ACL grants and pushed via SSE.
- **Zellij & tmux sessions** — Attach to shared terminal sessions per context. Zellij sessions open as embedded web terminals through the zweb proxy; tmux sessions stream via xterm.js over a WebSocket PTY.
- **Local Agent toggle** — Start/stop a per-user Tachikoma local agent that handles file sync, task dispatch, and process management.
- **MCP Copilot** — Pick MCP profiles that scope which tools, dashboards, and dataset accesses your agents may use.
- **@tachikoma chat participant** — Talk to your agents directly from the VS Code chat view; tool calls route through the Hermes runtime.
- **Composer (Cmd+I)** — A multi-file, agentic edit composer wired to your active context.
- **Copy with reference** — `Ctrl+Shift+Alt+C` copies the current selection along with a clickable `vscode://` deep link that reopens the exact line from any terminal, PR, or chat message.
- **Inline completions** — Pluggable backend (`tachikoma`, `copilot`, or `off`) for ghost-text completions.
- **Walkthrough** — A first-run "Get Started with Tachikoma" guide that takes you from API token to first edit.

## Quick Start

1. **Install** the extension from the VS Code Marketplace (or via `Extensions: Install from VSIX...`).
2. **Sign in** — open the command palette (`Ctrl+Shift+P`) and run **`Tachikoma: Connect with API Token`**. Paste the token issued by your Tachikoma admin / `/api/auth/login`.
3. **Browse** — click the Tachikoma icon in the activity bar to open *Contexts*, *Collaborators*, *Sessions*, *MCP Copilot*, *Copilot*, and *Agents*.
4. **Open a remote file** — double-click any leaf in the context tree. Live collaboration starts automatically (configurable via `tachikoma.autoCollab`).
5. **Attach a terminal** — open the integrated terminal dropdown and pick **Tachikoma (zellij)** or **Tachikoma Remote**.
6. **Chat** — open the VS Code chat view and address **`@tachikoma`** to talk to your agents.

> Screenshots and a longer walkthrough live in the in-product *Get Started with Tachikoma* page (auto-opens after the first connection).

## Commands

All commands are available from the command palette. The full list:

| Command | Title |
|---|---|
| `tachikoma.connect` | Connect to Computer |
| `tachikoma.connectWithToken` | Connect with API Token |
| `tachikoma.disconnect` | Disconnect |
| `tachikoma.getMcpSession` | Get MCP Session (for MCP marketplace) |
| `tachikoma.toggleDaemon` | Toggle Local Agent |
| `tachikoma.openLocalTerminal` | Open Local Terminal |
| `tachikoma.remoteTerminal` | Open Remote Terminal |
| `tachikoma.showOutput` | Show Logs |
| `tachikoma.startCollaborating` | Start Collaborating on File |
| `tachikoma.stopCollaborating` | Stop Collaborating on File |
| `tachikoma.attachSession` | Attach Session |
| `tachikoma.openZellij` | Open Zellij Web |
| `tachikoma.refreshSessions` | Refresh Sessions |
| `tachikoma.toggleShowAllSessions` | Toggle Show All Sessions |
| `tachikoma.invalidateCache` | Invalidate Cache and Resync |
| `tachikoma.copyWithReference` | Copy Selection with File Reference |
| `tachikoma.newFile` | New File |
| `tachikoma.newFolder` | New Folder |
| `tachikoma.deleteEntry` | Delete |
| `tachikoma.openInWorkspace` | Open in Workspace |
| `tachikoma.copilot.open` | Open Copilot |
| `tachikoma.mcp.selectProfile` | Select MCP Profile |
| `tachikoma.mcp.clearActiveProfile` | Clear Active MCP Profile |
| `tachikoma.mcp.refresh` | Refresh MCP |
| `tachikoma.agents.spawn` | Spawn Local Agent |
| `tachikoma.agents.stop` | Stop Agent |
| `tachikoma.swarm.create` | Create Swarm |
| `tachikoma.swarm.addMember` | Add Agent to Swarm |
| `tachikoma.composer.open` | Composer (Cmd+I) |

## Settings

All settings live under the `tachikoma.*` namespace (Settings UI → search for "Tachikoma").

| Setting | Type | Default | Description |
|---|---|---|---|
| `tachikoma.host` | string | `""` | Tachikoma computer address (e.g. `http://localhost:8000`). |
| `tachikoma.autoConnect` | boolean | `false` | Automatically connect on VS Code startup. |
| `tachikoma.monorepoRoot` | string | `""` | Path to the monorepo root on the remote computer. |
| `tachikoma.showAllSessions` | boolean | `false` | Show sessions from all contexts, not just active ones. |
| `tachikoma.autoCollab` | boolean | `true` | Auto-start CRDT collaboration when opening remote files. |
| `tachikoma.copilot.url` | string | `""` | Optional dashboard URL for the CopilotKit chat iframe. |
| `tachikoma.terminals.persist` | boolean | `true` | Persist terminal sessions per-user for cross-machine replay. |
| `tachikoma.terminals.autoReplayOnConnect` | boolean | `true` | Restore previously-tracked terminals on reconnect. |
| `tachikoma.terminals.crossMachineReplay` | boolean | `false` | Replay terminals opened on other machines (opt-in). |
| `tachikoma.terminals.killOnDisconnect` | boolean | `true` | Close tracked terminals on disconnect. |
| `tachikoma.inlineCompletion.engine` | enum | `"tachikoma"` | Inline completion backend: `tachikoma`, `copilot`, or `off`. |

## Requirements

- **VS Code 1.95+** (or any compatible OSS distribution, including **Tachikoma IDE**).
- A reachable **Tachikoma backend** (a "computer" running the Tachikoma API + WebTransport gateway). For self-hosting docs see the [tachikoma monorepo](https://github.com/HoliChrys/tachikoma).
- A **Tachikoma API token** issued by an admin or via `/api/auth/login`.
- No SSH, no Remote-SSH, and no local clone of the monorepo are required — the extension treats the remote computer as the source of truth.

## Architecture (one paragraph)

The extension authenticates with the Tachikoma API using an ACL token cached in VS Code `SecretStorage`. Persistent state lives in `globalState`; live updates arrive via SSE deltas instead of polling. Remote files are exposed through a `tachikoma://` `FileSystemProvider` that reads and writes over REST. Collaborative editing is bridged into a `Y.Doc` whose schema mirrors the server's `RealtimeInstance` (`_data` `Y.Map`); presence is broadcast through `y-protocols/awareness`. Terminals come in two flavors: **zellij** via an iframe pointed at the zweb proxy (HTTPS/Traefik), and **tmux** via `xterm.js` over a WebSocket PTY.

## Known Issues

- The `vscode://` deep-link handler from *Copy with Reference* only opens the file if the receiving VS Code instance already has this extension installed.
- Zellij web terminals require the backend's `zweb` proxy to be reachable from your browser (HTTPS recommended).
- Cross-machine terminal replay (`tachikoma.terminals.crossMachineReplay`) is opt-in and still considered experimental.

## Roadmap

- Native session migration UI (snapshot / restore between machines).
- WebTransport-only fallback path when classic WebSocket is blocked.
- Inline review/comment threads tied to CRDT positions.
- Per-computer crypto keys for ACL exchanges.
- First-class Composer with multi-file diff preview.

## Telemetry

This extension does **not** ship any telemetry of its own. The only network traffic goes to the Tachikoma backend you explicitly point it at (`tachikoma.host`).

## License

[MIT](./LICENSE) © Tachikoma contributors.
