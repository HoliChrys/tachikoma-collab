// Bundled type declarations for @tachikoma/transport.
// Generated from the SDK src/ tree at sandbox/webtransport/packages/transport
// via tsc --emitDeclarationOnly + manual flattening. Do not edit by hand —
// rerun the vendor script if the upstream SDK changes.
// ASCII only.

export interface TransportConfig {
    baseUrl: string;
    token: string;
    webtransportUrl?: string;
    sseUrl?: string;
    autoReconnect?: boolean;
    reconnectDelay?: number;
    maxReconnectAttempts?: number;
}

export interface SubscribeOptions {
    channels: string[];
    eventTypes?: string[];
    excludeTypes?: string[];
    entities?: string[];
}

export interface TransportEvent {
    channel: string;
    eventType: string;
    eventId: string;
    data: Record<string, unknown>;
    offset?: string;
    timestamp?: number;
}

export interface CRDTUpdate {
    componentId: string;
    delta: Uint8Array;
}

export type EventHandler = (event: TransportEvent) => void;
export type CRDTHandler = (update: CRDTUpdate) => void;
export type DatagramHandler = (type: string, payload: Uint8Array) => void;

export interface TransportClient {
    connect(): Promise<void>;
    disconnect(): void;
    subscribe(options: SubscribeOptions): Promise<void>;
    unsubscribe(channels: string[]): void;
    onEvent(handler: EventHandler): () => void;
    onCRDT(componentId: string, handler: CRDTHandler): () => void;
    onDatagram(handler: DatagramHandler): () => void;
    joinComponent(componentId: string): Promise<void>;
    sendCRDTUpdate(componentId: string, delta: Uint8Array): void;
    leaveComponent(componentId: string): void;
    sendCursor(componentId: string, x: number, y: number): void;
    sendTyping(componentId: string, isTyping: boolean): void;
    readonly connected: boolean;
    readonly transport: "webtransport" | "sse";
}

export declare enum MessageType {
    SUBSCRIBE = 1,
    UNSUBSCRIBE = 2,
    SUBSCRIBED = 3,
    RESUME = 4,
    RESET = 5,
    PING = 6,
    PONG = 7,
    ERROR = 8,
    WELCOME = 9,
    EVENT = 16,
    EVENT_BATCH = 17,
    CRDT_JOIN = 32,
    CRDT_UPDATE = 33,
    CRDT_STATE = 34,
    CRDT_LEAVE = 35,
    DATAGRAM_CURSOR = 48,
    DATAGRAM_TYPING = 49,
    DATAGRAM_PRESENCE = 50
}

export declare function encode(type: MessageType, payload: Record<string, unknown>): Uint8Array;
export declare function decode(data: Uint8Array): [MessageType, Record<string, unknown>];
export declare function encodeEvent(channel: string, eventType: string, eventId: string, data: Record<string, unknown>, offset?: string): Uint8Array;

export declare class WebTransportClient implements TransportClient {
    constructor(config: TransportConfig);
    get connected(): boolean;
    get transport(): "webtransport";
    connect(): Promise<void>;
    disconnect(): void;
    subscribe(options: SubscribeOptions): Promise<void>;
    unsubscribe(channels: string[]): void;
    onEvent(handler: EventHandler): () => void;
    onCRDT(componentId: string, handler: CRDTHandler): () => void;
    onDatagram(handler: DatagramHandler): () => void;
    joinComponent(componentId: string): Promise<void>;
    sendCRDTUpdate(componentId: string, delta: Uint8Array): void;
    leaveComponent(componentId: string): void;
    sendCursor(componentId: string, x: number, y: number): void;
    sendTyping(componentId: string, isTyping: boolean): void;
}

export declare class SSEClient implements TransportClient {
    constructor(config: TransportConfig);
    get connected(): boolean;
    get transport(): "sse";
    connect(): Promise<void>;
    disconnect(): void;
    subscribe(options: SubscribeOptions): Promise<void>;
    unsubscribe(channels: string[]): void;
    onEvent(handler: EventHandler): () => void;
    onCRDT(componentId: string, handler: CRDTHandler): () => void;
    onDatagram(_handler: DatagramHandler): () => void;
    joinComponent(componentId: string): Promise<void>;
    sendCRDTUpdate(componentId: string, delta: Uint8Array): void;
    leaveComponent(componentId: string): void;
    sendCursor(): void;
    sendTyping(): void;
}

export declare function createTransport(config: TransportConfig): Promise<TransportClient>;
