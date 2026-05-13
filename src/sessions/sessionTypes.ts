export interface TmuxSessionInfo {
    session_id: string;
    name: string;
    ctx_id: string;
    owner_id: string;
    parent_session_id?: string;
    subsession_path?: string;
    tmux_socket: string;
    tmux_target: string;
    state: string;
}

export interface ZellijSessionInfo {
    id: string;
    name: string;
    session_type: string;
    context_path: string;
    status: string;
    is_current_context?: boolean;
}

export interface ContextSessionGroup {
    ctx_id: string;
    context_path: string;
    zweb_available: boolean;
    zweb_port: number;
    zweb_ip?: string;
    zweb_started?: string;
    session_url?: string;
    active_sessions: ZellijSessionInfo[];
    exited_sessions?: ZellijSessionInfo[];
}

export interface ZellijWebInfo {
    available: boolean;
    ctx_id: string;
    port: number;
    token: string;
    url: string;
    proxy_url: string;
    session_url: string;
    started?: string;
    pid?: string;
}
