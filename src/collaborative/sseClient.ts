/**
 * Node.js-compatible EventBus — adapted from the tachikoma SDK event-bus.ts.
 *
 * Uses the `eventsource` npm package as polyfill since Node.js doesn't have
 * native EventSource. Otherwise identical to the browser SDK.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const EventSourceImpl = require('eventsource');

export interface MonorepoEvent {
    event_type: string;
    channel: string;
    component_id?: string;
    participant_id?: string;
    update?: string;
    changes?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface EventBusConfig {
    token: string;
    baseUrl: string;
}

export interface SubscribeOptions {
    channels?: string[];
    eventTypes?: string[];
    excludeTypes?: string[];
    entities?: string[];
    excludeEntities?: string[];
    entityIds?: string[];
    originUser?: string;
    originNode?: string;
    pattern?: string;
    fieldFilters?: Record<string, string>;
}

class EventStreamIterator {
    private eventSource: InstanceType<typeof EventSourceImpl> | null = null;
    private queue: MonorepoEvent[] = [];
    private resolve: ((value: IteratorResult<MonorepoEvent>) => void) | null = null;
    private closed = false;
    private _connected = false;

    constructor(
        private url: string,
        private onConnectionChange?: (connected: boolean) => void,
    ) {}

    get connected(): boolean {
        return this._connected;
    }

    start(): void {
        if (this.eventSource) return;

        this.eventSource = new EventSourceImpl(this.url);

        this.eventSource.onopen = () => {
            this._connected = true;
            this.onConnectionChange?.(true);
        };

        this.eventSource.onerror = () => {
            this._connected = false;
            this.onConnectionChange?.(false);
        };

        this.eventSource.addEventListener('connected', () => {
            // Initial connection ack
        });

        this.eventSource.onmessage = (e: { data: string }) => {
            this.enqueue(e.data);
        };

        const knownEventTypes = [
            'component.created', 'component.updated', 'component.removed',
            'component.participant_joined', 'component.participant_left',
            'space.created', 'space.updated', 'space.synced',
            'computer.discovered', 'computer.updated',
            'user.created', 'user.activated',
            'node.online', 'node.offline', 'node.heartbeat',
        ];

        for (const eventType of knownEventTypes) {
            this.eventSource.addEventListener(eventType, (e: { data: string }) => {
                this.enqueue(e.data);
            });
        }
    }

    private enqueue(raw: string): void {
        try {
            const event: MonorepoEvent = JSON.parse(raw);
            if (this.resolve) {
                const r = this.resolve;
                this.resolve = null;
                r({ value: event, done: false });
            } else {
                this.queue.push(event);
            }
        } catch {
            // ignore parse errors
        }
    }

    async next(): Promise<IteratorResult<MonorepoEvent>> {
        if (this.closed) return { value: undefined, done: true };
        if (this.queue.length > 0) return { value: this.queue.shift()!, done: false };
        return new Promise((resolve) => { this.resolve = resolve; });
    }

    close(): void {
        this.closed = true;
        this._connected = false;
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        if (this.resolve) {
            this.resolve({ value: undefined, done: true });
            this.resolve = null;
        }
        this.onConnectionChange?.(false);
    }

    [Symbol.asyncIterator](): AsyncIterator<MonorepoEvent> {
        this.start();
        return {
            next: () => this.next(),
            return: async () => {
                this.close();
                return { value: undefined, done: true as const };
            },
        };
    }
}

export class EventBus {
    private token: string;
    private baseUrl: string;

    constructor(config: EventBusConfig) {
        this.token = config.token;
        this.baseUrl = config.baseUrl.replace(/\/$/, '');
    }

    subscribe(
        options?: SubscribeOptions,
        onConnectionChange?: (connected: boolean) => void,
    ): EventStreamIterator {
        const params = new URLSearchParams();
        params.set('token', this.token);
        if (options?.channels?.length) params.set('channels', options.channels.join(','));
        if (options?.eventTypes?.length) params.set('event_types', options.eventTypes.join(','));
        if (options?.excludeTypes?.length) params.set('exclude_types', options.excludeTypes.join(','));
        if (options?.entities?.length) params.set('entities', options.entities.join(','));
        if (options?.excludeEntities?.length) params.set('exclude_entities', options.excludeEntities.join(','));
        if (options?.entityIds?.length) params.set('entity_ids', options.entityIds.join(','));
        if (options?.originUser) params.set('origin_user', options.originUser);
        if (options?.originNode) params.set('origin_node', options.originNode);
        if (options?.pattern) params.set('pattern', options.pattern);
        if (options?.fieldFilters) {
            for (const [key, val] of Object.entries(options.fieldFilters)) {
                params.append('field', `${key}=${val}`);
            }
        }

        const url = `${this.baseUrl}/api/events/stream?${params.toString()}`;
        return new EventStreamIterator(url, onConnectionChange);
    }

    async history(options?: {
        since?: string; until?: string; channels?: string[];
        eventTypes?: string[]; limit?: number;
    }): Promise<MonorepoEvent[]> {
        const params = new URLSearchParams();
        if (options?.since) params.set('since', options.since);
        if (options?.until) params.set('until', options.until);
        if (options?.channels?.length) params.set('channels', options.channels.join(','));
        if (options?.eventTypes?.length) params.set('event_types', options.eventTypes.join(','));
        if (options?.limit) params.set('limit', String(options.limit));

        const res = await fetch(
            `${this.baseUrl}/api/events/history?${params.toString()}`,
            { headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' } },
        );
        if (!res.ok) throw new Error(`History query failed: ${res.status}`);
        const data = await res.json() as { events?: MonorepoEvent[] };
        return data.events || [];
    }
}
