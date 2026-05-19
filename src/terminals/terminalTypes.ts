/**
 * Tracked terminal — a vscode.Terminal opened by the Tachikoma extension that we
 * want to persist for replay across reloads / reconnects / machines.
 *
 * Tokens (zweb, ssh keys, secrets) MUST be excluded by the caller. They're
 * refetched from the API at replay time.
 */
export interface TrackedTerminal {
    id: string;                  // uuid, generated extension-side
    kind: 'zellij' | 'ssh-remote' | 'tmux' | 'local-pty';
    machine_id: string;          // which machine opened it (anti-feedback-loop)
    user_id: string;             // owner

    context_path: string;        // tachikoma ctx active at open time
    title: string;
    shell_path?: string;
    shell_args?: string[];
    env?: Record<string, string>;

    // Per-kind metadata (for replay reconstruction)
    zellij_session_id?: string;
    zellij_server_url?: string;
    tmux_session_name?: string;
    tmux_socket?: string;
    ssh_host?: string;
    ssh_user?: string;
    ssh_cwd?: string;

    opened_at: string;           // ISO date
    last_active_at: string;
    auto_replay: boolean;        // false = skip in replayAll()
}

/** What the backend stores per user. */
export interface SessionStateSnapshot {
    user_id: string;
    updated_at: string;
    sessions: TrackedTerminal[];
}

/** SSE event payloads. */
export interface UserTerminalsEvent {
    user_id: string;
    machine_id: string;
    terminal?: TrackedTerminal;       // for opened / updated
    terminal_id?: string;             // for closed
    sessions?: TrackedTerminal[];     // for snapshot
}
