// VI-1c runner transport wrapper.
//
// Wraps @tachikoma/transport createTransport() and bridges TransportEvent ->
// RpcDispatcher.handle(). Outgoing RpcResponse / RpcEvent are emitted via
// REST (per transport-rpc-pattern.md: the SDK lacks a direct send, so
// we POST replies/events to the backend monorepo API).
//
// The SDK lives under src/runner/vendor/transport/ as a pre-bundled CJS
// artifact (index.js + index.d.ts) so it compiles cleanly into the VSIX
// without requiring npm to resolve a sandbox `file:` dependency during CI.
// The runtime load is still wrapped in try/catch so a malformed vendor
// bundle fails soft (the runner logs and stays idle instead of crashing).
//
// Source upstream: sandbox/webtransport/packages/transport/src.
// Spec: .agents/specs/to_do/VI-1c-runner-rpc.md section "Transport client".
// Pattern: .agents/context/consume/transport-rpc-pattern.md.
// ASCII only, 4-space indent.

import * as vscode from 'vscode';
import { log, logError } from '../log';
import {
    type RpcRequest,
    type RpcResponse,
    type RpcEvent,
} from './runnerProtocol';
import { RpcDispatcher } from './rpcDispatcher';
import type {
    TransportClient,
    TransportConfig,
    TransportEvent,
} from './vendor/transport';

/** Lifecycle / health state surfaced by RunnerTransport to outside
 * observers (status bar, audit views). Lives outside the class so other
 * modules can import the literal type without depending on RunnerTransport. */
export type RunnerState = 'idle' | 'connecting' | 'active' | 'error';

export interface RunnerStateSnapshot {
    state: RunnerState;
    /** Transport mode reported by the SDK once connected. */
    mode: 'webtransport' | 'sse' | null;
    /** Computer id this transport is bound to. */
    computerId: string | null;
    /** Last RPC method handled (any status) — null until first call. */
    lastMethod: string | null;
    /** Timestamp (epoch ms) of the last RPC call. */
    lastAt: number | null;
    /** Last error message, if state === 'error'. */
    lastError: string | null;
}

// Loaded at runtime so a corrupt/missing vendor bundle does not break compile
// or extension activation. esbuild rewrites this require() into the vendored
// CJS file at bundle time, so no npm resolution is involved.
type CreateTransportFn = (cfg: TransportConfig) => Promise<TransportClient>;

function loadCreateTransport(): CreateTransportFn | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('./vendor/transport/index.js');
        return mod.createTransport as CreateTransportFn;
    } catch (e) {
        logError('runner: vendor @tachikoma/transport load failed', e);
        return null;
    }
}

export interface RunnerTransportOptions {
    baseUrl: string;          // e.g. http://dev-005:8000
    token: string;            // Bearer token (user session)
    computerId: string;       // local computer id
    dispatcher: RpcDispatcher;
}

export class RunnerTransport {
    private client: TransportClient | null = null;
    private commandsChannel: string;
    private repliesPath: string;
    private connected = false;

    private snapshot: RunnerStateSnapshot;
    private readonly _onDidChangeState =
        new vscode.EventEmitter<RunnerStateSnapshot>();
    /** Fires whenever the lifecycle/health state changes (idle ->
     * connecting -> active -> error). Subscribers get the full snapshot. */
    readonly onDidChangeState = this._onDidChangeState.event;

    constructor(private opts: RunnerTransportOptions) {
        this.commandsChannel = `runner.${opts.computerId}.commands`;
        this.repliesPath = '/api/runner/reply';
        this.snapshot = {
            state: 'idle',
            mode: null,
            computerId: opts.computerId,
            lastMethod: null,
            lastAt: null,
            lastError: null,
        };
    }

    getState(): RunnerStateSnapshot {
        return { ...this.snapshot };
    }

    private setState(patch: Partial<RunnerStateSnapshot>): void {
        this.snapshot = { ...this.snapshot, ...patch };
        this._onDidChangeState.fire({ ...this.snapshot });
    }

    async connect(): Promise<void> {
        const createTransport = loadCreateTransport();
        if (!createTransport) {
            log('runner: skipping transport connect (SDK missing)');
            this.setState({
                state: 'error',
                lastError: 'transport SDK missing',
            });
            return;
        }
        log(`runner: connecting transport baseUrl=${this.opts.baseUrl}`);
        this.setState({ state: 'connecting', lastError: null });
        try {
            this.client = await createTransport({
                baseUrl: this.opts.baseUrl,
                token: this.opts.token,
                autoReconnect: true,
                reconnectDelay: 3000,
            });
            await this.client.subscribe({ channels: [this.commandsChannel] });
            this.client.onEvent((event) => this.onEvent(event));
            this.connected = true;
            this.setState({
                state: 'active',
                mode: this.client.transport,
                lastError: null,
            });
            log(
                `runner: subscribed channel=${this.commandsChannel} ` +
                `mode=${this.client.transport}`,
            );
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.setState({ state: 'error', lastError: msg });
            throw e;
        }
    }

    disconnect(): void {
        try {
            this.client?.disconnect();
        } catch (e) {
            logError('runner: disconnect error', e);
        }
        this.client = null;
        this.connected = false;
        this.setState({ state: 'idle', mode: null });
    }

    isConnected(): boolean {
        return this.connected;
    }

    private onEvent(event: TransportEvent): void {
        // Backend wraps the RpcRequest payload inside a TransportEvent;
        // the actual request lives in `event.data` (msgpack-decoded by SDK).
        if (event.channel !== this.commandsChannel) return;
        const req = event.data as unknown as RpcRequest;
        if (!req || req.type !== 'request') return;
        this.setState({ lastMethod: req.method, lastAt: Date.now() });
        void this.opts.dispatcher
            .handle(req)
            .then((resp) => this.sendReply(resp))
            .catch((e) => logError('runner: dispatch failed', e));
    }

    // Replies and outgoing events go through the monorepo REST API (the SDK
    // exposes no direct send). The backend re-broadcasts to the originating
    // agent via its own channel.
    private async sendReply(resp: RpcResponse): Promise<void> {
        try {
            await fetch(`${this.opts.baseUrl}${this.repliesPath}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.opts.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    computer_id: this.opts.computerId,
                    response: resp,
                }),
            });
        } catch (e) {
            logError(`runner: reply POST failed (id=${resp.id})`, e);
        }
    }

    async emitEvent(topic: string, payload: any): Promise<void> {
        const event: RpcEvent = { type: 'event', topic, payload };
        try {
            await fetch(`${this.opts.baseUrl}/api/runner/event`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.opts.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    computer_id: this.opts.computerId,
                    event,
                }),
            });
        } catch (e) {
            logError(`runner: event POST failed (topic=${topic})`, e);
        }
    }
}
