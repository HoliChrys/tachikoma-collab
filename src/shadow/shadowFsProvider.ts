// VI-2a Shadow Workspace - in-memory FileSystemProvider (Phase 1 POC).
//
// Registers the `tachikoma-shadow:` URI scheme so agents can stage
// experimental edits in a parallel, invisible workspace without touching
// the user's open files. The backing store is a Map<string, Uint8Array>;
// directories are tracked in a separate Set so listing is cheap.
//
// Phase 2 will swap this for a worker/utilityProcess-backed buffer and
// implement cross-process file watching.
//
// Spec: .agents/specs/to_do/VI-2a-shadow-workspace.md (Phase 1).
// ASCII only, 4-space indent.

import * as vscode from 'vscode';

export const SHADOW_SCHEME = 'tachikoma-shadow';

function normalize(uri: vscode.Uri): string {
    // Drop the authority / query / fragment so callers see a single
    // canonical key per path. The leading slash is preserved.
    let p = uri.path || '/';
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p;
}

function parentOf(path: string): string {
    if (path === '/' || path === '') return '/';
    const idx = path.lastIndexOf('/');
    if (idx <= 0) return '/';
    return path.slice(0, idx);
}

function basenameOf(path: string): string {
    if (path === '/' || path === '') return '';
    const idx = path.lastIndexOf('/');
    return idx >= 0 ? path.slice(idx + 1) : path;
}

interface Entry {
    type: vscode.FileType;
    data: Uint8Array;
    ctime: number;
    mtime: number;
}

export class ShadowFsProvider implements vscode.FileSystemProvider {
    private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    // Keyed by normalized path. Root '/' is always a directory.
    private readonly entries = new Map<string, Entry>();

    constructor() {
        const now = Date.now();
        this.entries.set('/', { type: vscode.FileType.Directory, data: new Uint8Array(), ctime: now, mtime: now });
    }

    // FileSystemProvider does not require us to actually watch anything
    // beyond firing onDidChangeFile from our own mutators. Phase 2 wires
    // cross-process notifications.
    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: readonly string[] }): vscode.Disposable {
        return new vscode.Disposable(() => undefined);
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        const p = normalize(uri);
        const e = this.entries.get(p);
        if (!e) throw vscode.FileSystemError.FileNotFound(uri);
        return {
            type: e.type,
            ctime: e.ctime,
            mtime: e.mtime,
            size: e.type === vscode.FileType.File ? e.data.byteLength : 0,
        };
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        const p = normalize(uri);
        const dir = this.entries.get(p);
        if (!dir) throw vscode.FileSystemError.FileNotFound(uri);
        if (dir.type !== vscode.FileType.Directory) {
            throw vscode.FileSystemError.FileNotADirectory(uri);
        }
        const out: [string, vscode.FileType][] = [];
        const prefix = p === '/' ? '/' : p + '/';
        for (const [k, v] of this.entries) {
            if (k === p) continue;
            if (!k.startsWith(prefix)) continue;
            const rest = k.slice(prefix.length);
            if (rest.includes('/')) continue;
            out.push([rest, v.type]);
        }
        return out;
    }

    createDirectory(uri: vscode.Uri): void {
        const p = normalize(uri);
        if (this.entries.has(p)) {
            const existing = this.entries.get(p)!;
            if (existing.type === vscode.FileType.Directory) return;
            throw vscode.FileSystemError.FileExists(uri);
        }
        this._ensureParentDir(uri);
        const now = Date.now();
        this.entries.set(p, { type: vscode.FileType.Directory, data: new Uint8Array(), ctime: now, mtime: now });
        this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
    }

    readFile(uri: vscode.Uri): Uint8Array {
        const p = normalize(uri);
        const e = this.entries.get(p);
        if (!e) throw vscode.FileSystemError.FileNotFound(uri);
        if (e.type !== vscode.FileType.File) throw vscode.FileSystemError.FileIsADirectory(uri);
        return e.data;
    }

    writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        options: { create: boolean; overwrite: boolean },
    ): void {
        const p = normalize(uri);
        const existing = this.entries.get(p);
        if (existing && existing.type === vscode.FileType.Directory) {
            throw vscode.FileSystemError.FileIsADirectory(uri);
        }
        if (!existing && !options.create) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        if (existing && !options.overwrite && options.create) {
            throw vscode.FileSystemError.FileExists(uri);
        }
        this._ensureParentDir(uri);
        const now = Date.now();
        const entry: Entry = existing
            ? { type: vscode.FileType.File, data: content, ctime: existing.ctime, mtime: now }
            : { type: vscode.FileType.File, data: content, ctime: now, mtime: now };
        this.entries.set(p, entry);
        this._emitter.fire([{
            type: existing ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created,
            uri,
        }]);
    }

    delete(uri: vscode.Uri, _options: { recursive: boolean }): void {
        const p = normalize(uri);
        if (p === '/') throw vscode.FileSystemError.NoPermissions(uri);
        const e = this.entries.get(p);
        if (!e) throw vscode.FileSystemError.FileNotFound(uri);
        // Recursive delete: drop the entry and any descendant.
        const prefix = p + '/';
        const removed: vscode.FileChangeEvent[] = [];
        for (const k of Array.from(this.entries.keys())) {
            if (k === p || k.startsWith(prefix)) {
                this.entries.delete(k);
                removed.push({ type: vscode.FileChangeType.Deleted, uri: uri.with({ path: k }) });
            }
        }
        if (removed.length > 0) this._emitter.fire(removed);
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
        const oldP = normalize(oldUri);
        const newP = normalize(newUri);
        if (!this.entries.has(oldP)) throw vscode.FileSystemError.FileNotFound(oldUri);
        if (this.entries.has(newP)) {
            if (!options.overwrite) throw vscode.FileSystemError.FileExists(newUri);
            this.entries.delete(newP);
        }
        this._ensureParentDir(newUri);
        const events: vscode.FileChangeEvent[] = [];
        const oldPrefix = oldP + '/';
        const remap: Array<[string, string]> = [[oldP, newP]];
        for (const k of this.entries.keys()) {
            if (k.startsWith(oldPrefix)) {
                remap.push([k, newP + k.slice(oldP.length)]);
            }
        }
        for (const [from, to] of remap) {
            const e = this.entries.get(from)!;
            this.entries.delete(from);
            this.entries.set(to, e);
            events.push({ type: vscode.FileChangeType.Deleted, uri: oldUri.with({ path: from }) });
            events.push({ type: vscode.FileChangeType.Created, uri: newUri.with({ path: to }) });
        }
        if (events.length > 0) this._emitter.fire(events);
    }

    // ---- shadow-only helpers (not part of FileSystemProvider) ----------

    /** List every file path currently held in the shadow buffer. */
    listFiles(): string[] {
        const out: string[] = [];
        for (const [k, v] of this.entries) {
            if (v.type === vscode.FileType.File) out.push(k);
        }
        return out;
    }

    /** Drop every entry except the root directory. */
    clearAll(): void {
        const events: vscode.FileChangeEvent[] = [];
        for (const [k] of this.entries) {
            if (k === '/') continue;
            events.push({
                type: vscode.FileChangeType.Deleted,
                uri: vscode.Uri.from({ scheme: SHADOW_SCHEME, path: k }),
            });
        }
        this.entries.clear();
        const now = Date.now();
        this.entries.set('/', { type: vscode.FileType.Directory, data: new Uint8Array(), ctime: now, mtime: now });
        if (events.length > 0) this._emitter.fire(events);
    }

    private _ensureParentDir(uri: vscode.Uri): void {
        const p = normalize(uri);
        const parent = parentOf(p);
        if (parent === '/' || this.entries.has(parent)) return;
        // Walk up and materialize every missing ancestor as a directory.
        const parts = parent.split('/').filter((s) => s.length > 0);
        let cur = '';
        const now = Date.now();
        for (const seg of parts) {
            cur = cur + '/' + seg;
            if (!this.entries.has(cur)) {
                this.entries.set(cur, {
                    type: vscode.FileType.Directory,
                    data: new Uint8Array(),
                    ctime: now,
                    mtime: now,
                });
            }
        }
        // The basename will be created by the caller (writeFile / createDirectory).
        void basenameOf(p);
    }
}
