# Changelog

All notable changes to the **Tachikoma Collab** extension are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.16.0] - 2026-05-20

### Added
- Public cross-extension RPC commands so other extensions (notably the
  IDE-side Tachikoma sidebar in `src/vs/workbench/browser/tachikoma/sidebar/`)
  can read and mutate the active context without taking a hard dependency
  on this extension's internals:
  - `tachikoma.context.list` -- returns `ContextListItem[]`
    (`{id, path, name, active, type}`) for every context known to the store.
  - `tachikoma.context.switch` -- accepts a `string` id or `{id|path}`
    object, activates the target on the store, and resolves `true` on
    success / `false` on no-op. Subscribers can listen to
    `ICommandService.onDidExecuteCommand` to refresh after a switch.
- Both new commands are hidden from the user-facing command palette
  (`menus.commandPalette` with `when: "false"`) -- they are programmatic
  RPC, not interactive actions.

## [5.8.1] - 2026-05-20

### Added
- Marketplace-ready packaging: `icon`, `galleryBanner`, `categories`, `keywords`,
  `homepage`, `bugs`, `pricing`, and `qna` fields in `package.json`.
- 128x128 PNG icon at `media/icon-128.png` rendered from the source SVG.
- Full marketplace README with feature list, command/settings tables,
  architecture summary, requirements, known issues, and roadmap.
- Standalone `LICENSE` (MIT) file at the extension root.

### Changed
- `description` rewritten to be marketing-friendly (~140 chars).
- `.vscodeignore` extended to keep marketplace assets (`README.md`, `LICENSE`,
  `CHANGELOG.md`, `media/icon-128.png`) and exclude editor-tooling files
  (`.vscode/`, `*.vsix`, `.eslintrc*`, `eslint.config.*`).

### Notes
- Functional code (`src/`, `dist/extension.js`) is unchanged in this release;
  this is a packaging / discoverability update.

## [5.8.0] - prior

- Composer (Cmd+I) command.
- Inline completion engine selector (`tachikoma` / `copilot` / `off`).
- Agents and Swarm management commands.
- MCP Copilot view and profile picker.
- Walkthrough "Get Started with Tachikoma".
- Live collaboration via CRDT (Y.Doc) with colored presence.
- Zellij (zweb) + tmux (xterm.js / WebSocket PTY) terminal sessions.
- Context tree (`tachikoma://` FileSystemProvider) with file CRUD.
- ACL-backed Collaborators view with SSE deltas.
- Copy-with-reference (`Ctrl+Shift+Alt+C`) producing `vscode://` deep links.
