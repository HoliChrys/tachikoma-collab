import * as vscode from 'vscode';
import type { HierarchyItem, UserRecord } from '../types';
import type { ContextSessionGroup, TmuxSessionInfo } from '../sessions/sessionTypes';
import { log } from '../log';

export interface CacheSnapshot {
    version: 1;
    timestamp: number;
    host: string;
    userId: string;
    galaxies: HierarchyItem[];
    systems: HierarchyItem[];
    spaces: HierarchyItem[];
    users: UserRecord[];
    sessions: ContextSessionGroup[];
    tmuxSessions: TmuxSessionInfo[];
}

const CACHE_KEY = 'tachikoma.cache.v1';
const CACHE_VERSION = 1 as const;

export class PersistentCache {
    private state: vscode.Memento;

    constructor(state: vscode.Memento) {
        this.state = state;
    }

    load(host: string, userId: string): CacheSnapshot | null {
        const raw = this.state.get<CacheSnapshot>(CACHE_KEY);
        if (!raw) return null;
        if (raw.version !== CACHE_VERSION) {
            log(`Cache: version mismatch (${raw.version} vs ${CACHE_VERSION}) — invalidating`);
            void this.invalidate();
            return null;
        }
        if (raw.host !== host || raw.userId !== userId) {
            log(`Cache: host/user mismatch (${raw.host}/${raw.userId} vs ${host}/${userId}) — skipping`);
            return null;
        }
        const ageMs = Date.now() - raw.timestamp;
        log(`Cache hit: ${raw.galaxies.length} galaxies, ${raw.systems.length} systems, ${raw.spaces.length} spaces, age=${Math.round(ageMs / 1000)}s`);
        return raw;
    }

    async save(snap: Omit<CacheSnapshot, 'version' | 'timestamp'>): Promise<void> {
        const full: CacheSnapshot = {
            ...snap,
            version: CACHE_VERSION,
            timestamp: Date.now(),
        };
        await this.state.update(CACHE_KEY, full);
    }

    async invalidate(): Promise<void> {
        await this.state.update(CACHE_KEY, undefined);
        log('Cache invalidated');
    }
}
