# Tachikoma Collab

Connect to a Tachikoma computer from VS Code. Browse monorepo contexts, edit remote files, attach terminal sessions, and collaborate in real-time with other users.

## Features

### Contexts
Browse the monorepo hierarchy (Galaxy > System > Space) and open remote files directly in the editor. Files are fetched via the API — no SSH or Remote extension needed.

### Collaborators
See who's active in each context. Users are resolved from ACL grants and updated in real-time via SSE.

### Sessions
Attach to zellij and tmux terminal sessions bound to contexts. Zellij sessions open as embedded web terminals via the zweb proxy. Tmux sessions use xterm.js over WebSocket PTY.

### Live Collaboration
When multiple users open the same file, edits sync in real-time via CRDT (Y.Doc). Cursor positions and selections are broadcast as colored presence indicators.

### Copy with Reference
`Ctrl+Shift+Alt+C` copies the selected code with a file reference and a clickable `vscode://` deep link that opens the exact location from any terminal or chat.

## Setup

1. Install the extension from the VS Code Marketplace
2. Run **Tachikoma: Connect** (`Ctrl+Shift+P`)
3. Enter the computer address (e.g. `http://dev-005:8000`) and credentials
4. The context tree, collaborators, and sessions load automatically

## Settings

| Setting | Description |
|---------|-------------|
| `tachikoma.host` | Computer address (auto-filled after first connect) |
| `tachikoma.autoConnect` | Reconnect on VS Code startup |
| `tachikoma.autoCollab` | Auto-start CRDT collaboration on file open |

## Architecture

- **Auth**: ACL token from `/api/auth/login`, cached in VS Code SecretStorage
- **State**: Persistent cache in `globalState` + SSE live deltas (no polling)
- **Files**: `tachikoma://` FileSystemProvider with read/write via REST
- **Terminals**: Zellij via zweb iframe (HTTPS/Traefik), tmux via xterm.js/WebSocket PTY
- **CRDT**: Y.Doc bridge matching server's RealtimeInstance schema (`_data` Y.Map)
