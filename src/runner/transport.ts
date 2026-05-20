// VI-1c runner transport wrapper.
//
// Wraps @tachikoma/transport createTransport() and bridges TransportEvent ->
// RpcDispatcher.handle(). Outgoing RpcResponse / RpcEvent are emitted via
// REST (per transport-rpc-pattern.md: the SDK lacks a direct send, so
// we POST replies/events to the backend monorepo API).
//
// The SDK is type-imported only and loaded at runtime via dynamic require so
// the file compiles even when @tachikoma/transport is not yet installed in
// node_modules. Wire-up to package.json happens in a follow-up.
//
// Spec: .agents/specs/to_do/VI-1c-runner-rpc.md section "Transport client".
// Pattern: .agents/context/consume/transport-rpc-pattern.md.
// ASCII only, 4-space indent.

import { log, logError } from '../log';
import {
    type RpcRequest,
    type RpcResponse,
    type RpcEvent,
} from './runnerProtocol';
import { RpcDispatcher } from './rpcDispatcher';

// Minimal local shape mirror of the @tachikoma/transport public API. We
// keep it inlined (rather than `import type from '@tachikoma/transport'`)
// so the file compiles even when the package is not yet installed in
// node_modules. Once the dep lands in package.json, swap these for the
// real `import type`.
interface TransportEvent {
    channel: string;
    eventType: string;
    eventId: string;
    data: Record<string, unknown>;
    offset?: string;
    timestamp?: number;
}

interface TransportClient {
    connect(): Promise<void>;
    disconnect(): void;
    subscribe(opts: { channels: string[]; eventTypes?: string[] }): Promise<void>;
    onEvent(handler: (event: TransportEvent) => void): () => void;
    readonly connected: boolean;
    readonly transport: 'webtransport' | 'sse';
}

interface TransportConfig {
    baseUrl: string;
    token: string;
    autoReconnect?: boolean;
    reconnectDelay?: number;
}

// Loaded at runtime so a missing package does not break compile or activate.
type CreateTransportFn = (cfg: TransportConfig) => Promise<TransportClient>;

function loadCreateTransport(): CreateTransportFn | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('@tachikoma/transport');
        return mod.createTransport as CreateTransportFn;
    } catch (e) {
        logError('runner: @tachikoma/transport not installed', e);
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

    constructor(private opts: RunnerTransportOptions) {
        this.commandsChannel = `runner.${opts.computerId}.commands`;
        this.repliesPath = '/api/runner/reply';
    }

    async connect(): Promise<void> {
        const createTransport = loadCreateTransport();
        if (!createTransport) {
            log('runner: skipping transport connect (SDK missing)');
            return;
        }
        log(`runner: connecting transport baseUrl=${this.opts.baseUrl}`);
        this.client = await createTransport({
            baseUrl: this.opts.baseUrl,
            token: this.opts.token,
            autoReconnect: true,
            reconnectDelay: 3000,
        });
        await this.client.subscribe({ channels: [this.commandsChannel] });
        this.client.onEvent((event) => this.onEvent(event));
        this.connected = true;
        log(
            `runner: subscribed channel=${this.commandsChannel} ` +
            `mode=${this.client.transport}`,
        );
    }

    disconnect(): void {
        try {
            this.client?.disconnect();
        } catch (e) {
            logError('runner: disconnect error', e);
        }
        this.client = null;
        this.connected = false;
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
