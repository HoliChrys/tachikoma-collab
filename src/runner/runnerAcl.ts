// VI-1c runner ACL.
//
// Gates every RPC call from the backend. V1 scope:
//   1. Skip signature verification (token validation is done by transport
//      Bearer auth; per-call signatures land in V2).
//   2. Check the calling user_id matches the locally logged-in user_id.
//   3. Check the method's REQUIRED_SCOPES are all present in auth.scopes.
//   4. For DANGEROUS_METHODS: prompt the user once via showWarningMessage
//      with an "Always allow" option persisted to workspaceState.
//
// Spec: .agents/specs/to_do/VI-1c-runner-rpc.md section "ACL flow".
// ASCII only, 4-space indent.

import * as vscode from 'vscode';
import {
    REQUIRED_SCOPES,
    DANGEROUS_METHODS,
    type RpcAuth,
} from './runnerProtocol';

const ALWAYS_ALLOW_KEY_PREFIX = 'tachikoma.runner.alwaysAllow.';

export interface AclResult {
    allowed: boolean;
    reason?: string;
}

// Hook injected by initRunner() so the ACL can read the current user id and
// access workspaceState. Kept as module-level state to avoid threading the
// context through every call site.
let _localUserId: () => string | null = () => null;
let _state: vscode.Memento | null = null;

export function configureRunnerAcl(opts: {
    getLocalUserId: () => string | null;
    workspaceState: vscode.Memento;
}): void {
    _localUserId = opts.getLocalUserId;
    _state = opts.workspaceState;
}

function alwaysAllowKey(userId: string, method: string): string {
    return `${ALWAYS_ALLOW_KEY_PREFIX}${userId}.${method}`;
}

async function confirmDangerous(
    method: string,
    auth: RpcAuth,
): Promise<boolean> {
    if (_state) {
        const remembered = _state.get<boolean>(
            alwaysAllowKey(auth.user_id, method),
        );
        if (remembered === true) return true;
    }
    const choice = await vscode.window.showWarningMessage(
        `Agent ${auth.agent_id} requests ${method}. Allow?`,
        { modal: true },
        'Allow',
        'Always allow',
        'Deny',
    );
    if (choice === 'Always allow') {
        if (_state) {
            await _state.update(
                alwaysAllowKey(auth.user_id, method),
                true,
            );
        }
        return true;
    }
    return choice === 'Allow';
}

export const runnerAcl = {
    async check(
        method: string,
        params: any,
        auth: RpcAuth,
    ): Promise<AclResult> {
        // 1. Signature verification deferred to V2 (token already validated
        //    at transport layer via Bearer auth).

        // 2. User identity check.
        const localUid = _localUserId();
        if (!localUid) {
            return { allowed: false, reason: 'no local session' };
        }
        if (localUid !== auth.user_id) {
            return { allowed: false, reason: 'user mismatch' };
        }

        // 3. Scope check.
        const required = REQUIRED_SCOPES[method] ?? [];
        for (const scope of required) {
            if (!auth.scopes.includes(scope)) {
                return {
                    allowed: false,
                    reason: `missing scope: ${scope}`,
                };
            }
        }

        // 4. Dangerous-method confirmation gate.
        if (DANGEROUS_METHODS.has(method)) {
            const ok = await confirmDangerous(method, auth);
            if (!ok) return { allowed: false, reason: 'user denied' };
        }

        return { allowed: true };
    },

    // Reset all "Always allow" entries for the given user (used on logout).
    async forgetAllowances(userId: string): Promise<void> {
        if (!_state) return;
        // Memento lacks a key enumerate; we rely on documented keys only.
        const methods = Array.from(DANGEROUS_METHODS);
        for (const m of methods) {
            await _state.update(alwaysAllowKey(userId, m), undefined);
        }
    },
};
