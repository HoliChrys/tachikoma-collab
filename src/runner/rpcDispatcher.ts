// VI-1c RPC dispatcher.
//
// Routes incoming RpcRequest to a registered handler, gating the call with
// runnerAcl.check(). Emits an audit log line for every call (ok / denied /
// error) via the shared Tachikoma output channel.
//
// Spec: .agents/specs/to_do/VI-1c-runner-rpc.md section "Dispatcher + handler".
// ASCII only, 4-space indent.

import { log, logError } from '../log';
import {
    type RpcRequest,
    type RpcResponse,
    type RpcHandler,
} from './runnerProtocol';
import { runnerAcl } from './runnerAcl';

function audit(
    status: 'ok' | 'denied' | 'error' | 'not_found',
    req: RpcRequest,
    extra?: string,
): void {
    const tail = extra ? `  ${extra}` : '';
    log(
        `runner audit  ${status.padEnd(9)}  ` +
        `${req.method.padEnd(22)}  agent=${req.auth?.agent_id ?? '?'}  ` +
        `user=${req.auth?.user_id ?? '?'}  id=${req.id}${tail}`,
    );
}

export class RpcDispatcher {
    private handlers = new Map<string, RpcHandler>();

    register(method: string, handler: RpcHandler): void {
        if (this.handlers.has(method)) {
            log(`runner: replacing handler for ${method}`);
        }
        this.handlers.set(method, handler);
    }

    unregister(method: string): void {
        this.handlers.delete(method);
    }

    listMethods(): string[] {
        return Array.from(this.handlers.keys()).sort();
    }

    async handle(req: RpcRequest): Promise<RpcResponse> {
        const handler = this.handlers.get(req.method);
        if (!handler) {
            audit('not_found', req);
            return {
                type: 'response',
                id: req.id,
                error: {
                    code: 'method_not_found',
                    message: `unknown method: ${req.method}`,
                },
            };
        }

        // ACL gate.
        const acl = await runnerAcl.check(req.method, req.params, req.auth);
        if (!acl.allowed) {
            audit('denied', req, `reason=${acl.reason ?? '?'}`);
            return {
                type: 'response',
                id: req.id,
                error: {
                    code: 'forbidden',
                    message: acl.reason ?? 'denied',
                },
            };
        }

        try {
            const result = await handler(req.params, req.auth);
            audit('ok', req);
            return { type: 'response', id: req.id, result };
        } catch (e: any) {
            const msg = e?.message ?? String(e);
            logError(`runner handler ${req.method} failed`, e);
            audit('error', req, `error=${msg}`);
            return {
                type: 'response',
                id: req.id,
                error: { code: 'internal', message: msg },
            };
        }
    }
}
