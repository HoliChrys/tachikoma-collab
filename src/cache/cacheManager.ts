import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { TachikomaClient } from '../api/tachikomaClient';
import { log, logError } from '../log';

const FEEDBACK_TTL = 2_000;
const PUSH_DEBOUNCE = 300;
const MAX_CONCURRENT = 5;

export class CacheManager implements vscode.Disposable {
    private cacheRoot: string;
    private client: TachikomaClient | null = null;
    private watcher: vscode.FileSystemWatcher | null = null;
    private disposables: vscode.Disposable[] = [];

    private recentServerWrites = new Map<string, number>();
    private recentLocalPushes = new Map<string, number>();
    private pushTimers = new Map<string, ReturnType<typeof setTimeout>>();

    private _onSyncProgress = new vscode.EventEmitter<{ total: number; done: number; ctx: string }>();
    readonly onSyncProgress = this._onSyncProgress.event;

    constructor(hostUrl: string, private userId: string) {
        const hostHash = new URL(hostUrl).host.replace(/[^a-zA-Z0-9.\-]/g, '_');
        const base = vscode.workspace.getConfiguration('tachikoma').get<string>('cacheDir')
            || path.join(os.homedir(), '.tachikoma', 'cache');
        this.cacheRoot = path.join(base, hostHash, userId);
        fs.mkdirSync(this.cacheRoot, { recursive: true });
        log(`CacheManager: root=${this.cacheRoot}`);
    }

    getCacheRoot(): string {
        return this.cacheRoot;
    }

    connect(client: TachikomaClient): void {
        this.client = client;
    }

    disconnect(): void {
        this.stopWatching();
        this.client = null;
    }

    contextToLocalPath(ctxPath: string, filePath: string = ''): string {
        const ctxDir = ctxPath.replace(/\./g, path.sep);
        return filePath
            ? path.join(this.cacheRoot, ctxDir, filePath)
            : path.join(this.cacheRoot, ctxDir);
    }

    localPathToContext(fsPath: string): { contextPath: string; filePath: string } | undefined {
        const normalized = path.resolve(fsPath);
        const root = path.resolve(this.cacheRoot);
        if (!normalized.startsWith(root + path.sep) && normalized !== root) return undefined;
        const relative = normalized.slice(root.length + 1);
        if (!relative) return undefined;
        const parts = relative.split(path.sep);
        // Context paths use dots: tachikoma.parallele.vscode
        // We need to figure out where the context ends and the file path begins.
        // Strategy: walk parts until we find a dir that looks like a file (has extension)
        // or until the remaining path exists as a context in our synced dirs.
        // Simpler: the context is the deepest dotted prefix that has a matching directory.
        // For now, use a heuristic: contexts are typically 1-3 levels deep.
        // We'll try from deepest to shallowest.
        for (let i = Math.min(parts.length, 4); i >= 1; i--) {
            const ctxParts = parts.slice(0, i);
            const ctxPath = ctxParts.join('.');
            const ctxDir = path.join(this.cacheRoot, ...ctxParts);
            if (fs.existsSync(ctxDir) && fs.statSync(ctxDir).isDirectory()) {
                const fileParts = parts.slice(i);
                return { contextPath: ctxPath, filePath: fileParts.join('/') };
            }
        }
        return { contextPath: parts[0], filePath: parts.slice(1).join('/') };
    }

    async syncContext(ctxPath: string): Promise<void> {
        if (!this.client) return;
        log(`Sync context: ${ctxPath}`);
        const files = await this.listAllFiles(ctxPath, '');
        let done = 0;
        this._onSyncProgress.fire({ total: files.length, done: 0, ctx: ctxPath });

        const semaphore = new Array(MAX_CONCURRENT).fill(null);
        let idx = 0;

        const worker = async () => {
            while (idx < files.length) {
                const file = files[idx++];
                if (!file) continue;
                try {
                    await this.pullFile(ctxPath, file);
                } catch (err) {
                    logError(`Sync failed: ${ctxPath}/${file}`, err);
                }
                done++;
                this._onSyncProgress.fire({ total: files.length, done, ctx: ctxPath });
            }
        };

        await Promise.all(semaphore.map(() => worker()));
        log(`Sync complete: ${ctxPath} (${files.length} files)`);
    }

    async syncFile(ctxPath: string, filePath: string): Promise<void> {
        await this.pullFile(ctxPath, filePath);
    }

    async handleServerFileEvent(event: { ctxPath: string; filePath: string; changeType: string }): Promise<void> {
        if (!this.client || !event.filePath) return;
        const localPath = this.contextToLocalPath(event.ctxPath, event.filePath);

        if (this.wasRecentlyPushed(localPath)) return;

        if (event.changeType.includes('deleted')) {
            this.markServerWrite(localPath);
            try {
                if (fs.existsSync(localPath)) {
                    const stat = fs.statSync(localPath);
                    if (stat.isDirectory()) {
                        fs.rmSync(localPath, { recursive: true });
                    } else {
                        fs.unlinkSync(localPath);
                    }
                }
            } catch (err) {
                logError(`Delete local cache failed: ${localPath}`, err);
            }
        } else {
            await this.pullFile(event.ctxPath, event.filePath);
        }
    }

    startWatching(): void {
        if (this.watcher) return;
        const pattern = new vscode.RelativePattern(this.cacheRoot, '**/*');
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);

        this.disposables.push(
            this.watcher.onDidChange((uri) => this.onLocalChange(uri, 'change')),
            this.watcher.onDidCreate((uri) => this.onLocalChange(uri, 'create')),
            this.watcher.onDidDelete((uri) => this.onLocalDelete(uri)),
            this.watcher,
        );
        log('CacheManager: file watcher started');
    }

    stopWatching(): void {
        for (const d of this.disposables) d.dispose();
        this.disposables = [];
        this.watcher = null;
        for (const timer of this.pushTimers.values()) clearTimeout(timer);
        this.pushTimers.clear();
    }

    dispose(): void {
        this.disconnect();
        this._onSyncProgress.dispose();
    }

    // --- private ---

    private async listAllFiles(ctxPath: string, subpath: string): Promise<string[]> {
        if (!this.client) return [];
        const entries = await this.client.listContextFiles(ctxPath, subpath);
        const files: string[] = [];
        for (const e of entries) {
            const entryPath = subpath ? `${subpath}/${e.name}` : e.name;
            if (e.type === 'dir' || e.type === 'directory') {
                const sub = await this.listAllFiles(ctxPath, entryPath);
                files.push(...sub);
            } else {
                files.push(entryPath);
            }
        }
        return files;
    }

    private async pullFile(ctxPath: string, filePath: string): Promise<void> {
        if (!this.client) return;
        const localPath = this.contextToLocalPath(ctxPath, filePath);
        try {
            const content = await this.client.readFile(ctxPath, filePath);
            this.markServerWrite(localPath);
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            fs.writeFileSync(localPath, content, 'utf-8');
        } catch (err) {
            logError(`Pull failed: ${ctxPath}/${filePath}`, err);
        }
    }

    private onLocalChange(uri: vscode.Uri, _type: 'change' | 'create'): void {
        const fsPath = uri.fsPath;
        if (this.wasRecentServerWrite(fsPath)) return;
        this.debouncePush(fsPath);
    }

    private onLocalDelete(uri: vscode.Uri): void {
        const fsPath = uri.fsPath;
        if (this.wasRecentServerWrite(fsPath)) return;
        const ctx = this.localPathToContext(fsPath);
        if (!ctx || !this.client) return;
        this.markLocalPush(fsPath);
        this.client.deleteEntry(ctx.contextPath, ctx.filePath).catch((err) => {
            logError(`Push delete failed: ${fsPath}`, err);
        });
    }

    private debouncePush(fsPath: string): void {
        const existing = this.pushTimers.get(fsPath);
        if (existing) clearTimeout(existing);
        this.pushTimers.set(fsPath, setTimeout(() => {
            this.pushTimers.delete(fsPath);
            void this.pushFileToServer(fsPath);
        }, PUSH_DEBOUNCE));
    }

    private async pushFileToServer(fsPath: string): Promise<void> {
        const ctx = this.localPathToContext(fsPath);
        if (!ctx || !this.client) return;
        try {
            const content = fs.readFileSync(fsPath, 'utf-8');
            this.markLocalPush(fsPath);
            await this.client.writeFile(ctx.contextPath, ctx.filePath, content);
        } catch (err) {
            logError(`Push failed: ${fsPath}`, err);
        }
    }

    private markServerWrite(p: string): void {
        this.recentServerWrites.set(p, Date.now());
    }

    private markLocalPush(p: string): void {
        this.recentLocalPushes.set(p, Date.now());
    }

    private wasRecentServerWrite(p: string): boolean {
        const ts = this.recentServerWrites.get(p);
        if (!ts) return false;
        if (Date.now() - ts < FEEDBACK_TTL) return true;
        this.recentServerWrites.delete(p);
        return false;
    }

    private wasRecentlyPushed(p: string): boolean {
        const ts = this.recentLocalPushes.get(p);
        if (!ts) return false;
        if (Date.now() - ts < FEEDBACK_TTL) return true;
        this.recentLocalPushes.delete(p);
        return false;
    }
}
