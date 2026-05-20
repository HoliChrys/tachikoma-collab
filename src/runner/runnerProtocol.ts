// VI-1c runner RPC protocol (msgpack message shapes).
// Wire format is encoded via @tachikoma/transport (msgpack); these are the
// JS-level shapes the runner dispatcher sees after decode.
//
// Spec: .agents/specs/to_do/VI-1c-runner-rpc.md (section "RPC protocol").
// ASCII only, 4-space indent.

export interface RpcAuth {
    agent_id: string;        // who is calling
    user_id: string;         // on behalf of which user
    scopes: string[];        // ACL scopes
    token_signature: string; // signed by backend; verified by runner (V2)
}

export interface RpcRequest {
    type: 'request';
    id: string;              // correlation id
    method: string;          // e.g. "terminal.open"
    params: any;             // method-specific payload
    auth: RpcAuth;
}

export interface RpcError {
    code: string;
    message: string;
    data?: any;
}

export interface RpcResponse {
    type: 'response';
    id: string;              // matches request.id
    result?: any;
    error?: RpcError;
}

export interface RpcEvent {
    type: 'event';
    topic: string;           // e.g. "terminal.output.<session_id>"
    payload: any;
}

// Required scopes per method. If a method is absent the call is allowed (no
// scope gate). See spec section "ACL flow".
export const REQUIRED_SCOPES: Record<string, string[]> = {
    'terminal.open': ['runner.terminal'],
    'terminal.send_keys': ['runner.terminal'],
    'terminal.read': ['runner.terminal'],
    'terminal.list': ['runner.terminal'],
    'terminal.close': ['runner.terminal'],
    'command.execute': ['runner.command'],
    'command.list': ['runner.command'],
    'editor.set_selection': ['runner.editor.read'],
    'editor.insert_text': ['runner.editor.write'],
    'editor.replace_range': ['runner.editor.write'],
    'file.open': ['runner.file.read'],
    'file.save': ['runner.file.write'],
    'screen.observe': ['runner.screen.read'],
};

// Methods that prompt the user for confirmation on first call (until the
// user toggles "Always allow"). Persisted to workspaceState by runnerAcl.
export const DANGEROUS_METHODS: Set<string> = new Set([
    'terminal.send_keys',   // arbitrary shell input
    'command.execute',      // arbitrary command
    'editor.replace_range', // arbitrary text replacement
    'editor.insert_text',
    'file.save',            // persists changes
]);

// RPC handler signature. Handlers receive decoded params + auth context and
// return a result (serializable). Throwing rejects with an 'internal' error.
export type RpcHandler = (params: any, auth: RpcAuth) => Promise<any>;
