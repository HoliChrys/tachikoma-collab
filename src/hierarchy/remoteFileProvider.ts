import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import type { EventBus } from '../collaborative/sseClient';
import { log, logError } from '../log';

export const TACHIKOMA_SCHEME = 'tachikoma';

/**
 * Full read/write FileSystemProvider for tachikoma:// URIs.
 * Bidirectional: local edits push to server, server changes refresh locally.
 *
 * URI format: tachikoma://tachikoma/relative/path?ctx=context.path
 */
export class RemoteFileProvider implements vscode.FileSystemProvider {
    private client: TachikomaClient | null = null;
    private eventBus: EventBus | null = null;
    private watchDisposable: vscode.Disposable | null = null;

    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._onDidChangeFile.event;

    setClient(client: TachikomaClient | null): void {
        this.client = client;
    }

    setEventBus(eventBus: EventBus | null): void {
        if (this.watchDisposable) {
            this.watchDisposable.dispose();
            this.watchDisposable = null;
        }
        this.eventBus = eventBus;
    }

    watch(): vscode.Disposable {
        if (!this.eventBus) return new vscode.Disposable(() => {});

        const stream = this.eventBus.subscribe({
            eventTypes: [
                'file.created', 'file.modified', 'file.deleted',
                'context.file_changed',
            ],
        });

        const disposable = new vscode.Disposable(() => stream.close());

        void (async () => {
            try {
                for await (const event of stream) {
                    const ctxPath = (event.context_path ?? '') as string;
                    const filePath = (event.file_path ?? event.path ?? '') as string;
                    if (!ctxPath || !filePath) continue;

                    const uri = buildFileUri(ctxPath, filePath);
                    const changeType = (event.change_type ?? event.event_type ?? '') as string;

                    let type: vscode.FileChangeType;
                    if (changeType.includes('created')) {
                        type = vscode.FileChangeType.Created;
                    } else if (changeType.includes('deleted')) {
                        type = vscode.FileChangeType.Deleted;
                    } else {
                        type = vscode.FileChangeType.Changed;
                    }

                    this._onDidChangeFile.fire([{ type, uri }]);
                }
            } catch {
                log('RemoteFileProvider: watch stream ended');
            }
        })();

        this.watchDisposable = disposable;
        return disposable;
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const { filePath } = parseUri(uri);

        if (!filePath || filePath === '/') {
            return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        }

        return {
            type: vscode.FileType.File,
            ctime: 0,
            mtime: Date.now(),
            size: 0,
        };
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        if (!this.client) return [];
        const { contextPath, filePath } = parseUri(uri);
        try {
            const entries = await this.client.listContextFiles(contextPath, filePath);
            return entries.map((e) => [
                e.name,
                (e.type === 'dir' || e.type === 'directory')
                    ? vscode.FileType.Directory
                    : vscode.FileType.File,
            ]);
        } catch {
            return [];
        }
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        if (!this.client) throw vscode.FileSystemError.Unavailable('Not connected');
        const { contextPath, filePath } = parseUri(uri);
        log(`Reading ${contextPath}/${filePath}`);
        try {
            const content = await this.client.readFile(contextPath, filePath);
            return new TextEncoder().encode(content);
        } catch (err) {
            logError(`Read failed ${contextPath}/${filePath}`, err);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        if (!this.client) throw vscode.FileSystemError.Unavailable('Not connected');
        const { contextPath, filePath } = parseUri(uri);
        const text = new TextDecoder().decode(content);
        log(`Saving ${contextPath}/${filePath} (${content.length} bytes)`);
        try {
            await this.client.writeFile(contextPath, filePath, text);
            log(`Saved ${contextPath}/${filePath}`);
        } catch (err) {
            logError(`Save failed ${contextPath}/${filePath}`, err);
            throw vscode.FileSystemError.NoPermissions(uri);
        }
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        if (!this.client) throw vscode.FileSystemError.Unavailable('Not connected');
        const { contextPath, filePath } = parseUri(uri);
        log(`Creating directory ${contextPath}/${filePath}`);
        try {
            await this.client.createDir(contextPath, filePath);
        } catch (err) {
            logError(`Mkdir failed ${contextPath}/${filePath}`, err);
            throw vscode.FileSystemError.NoPermissions(uri);
        }
    }

    async delete(uri: vscode.Uri): Promise<void> {
        if (!this.client) throw vscode.FileSystemError.Unavailable('Not connected');
        const { contextPath, filePath } = parseUri(uri);
        log(`Deleting ${contextPath}/${filePath}`);
        try {
            await this.client.deleteEntry(contextPath, filePath);
        } catch (err) {
            logError(`Delete failed ${contextPath}/${filePath}`, err);
            throw vscode.FileSystemError.NoPermissions(uri);
        }
    }

    rename(): void {
        throw vscode.FileSystemError.NoPermissions('Not supported yet');
    }
}

function parseUri(uri: vscode.Uri): { contextPath: string; filePath: string } {
    const params = new URLSearchParams(uri.query);
    const contextPath = params.get('ctx') || uri.authority;
    const filePath = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
    return { contextPath, filePath };
}

export function buildFileUri(contextPath: string, filePath: string): vscode.Uri {
    return vscode.Uri.parse(
        `${TACHIKOMA_SCHEME}://tachikoma/${filePath}?ctx=${encodeURIComponent(contextPath)}`
    );
}
