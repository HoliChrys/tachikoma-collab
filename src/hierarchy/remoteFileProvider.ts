import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import { log, logError } from '../log';

export const TACHIKOMA_SCHEME = 'tachikoma';

/**
 * Full read/write FileSystemProvider for tachikoma:// URIs.
 *
 * URI format: tachikoma://context.path/relative/file/path
 * Example:    tachikoma://tachikoma.paralelle.landingpage/app/src/main.ts
 *
 * Files open as normal editable VS Code documents. Ctrl+S saves back
 * to the user's monorepo on the remote computer via the REST API.
 */
export class RemoteFileProvider implements vscode.FileSystemProvider {
    private client: TachikomaClient | null = null;

    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._onDidChangeFile.event;

    setClient(client: TachikomaClient | null): void {
        this.client = client;
    }

    watch(): vscode.Disposable {
        return new vscode.Disposable(() => {});
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const { contextPath, filePath } = parseUri(uri);

        if (!filePath || filePath === '/') {
            return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        }

        // For files, we do a lightweight check by fetching content
        // A proper impl would use a HEAD/stat endpoint
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

    createDirectory(): void {
        throw vscode.FileSystemError.NoPermissions('Not supported yet');
    }

    async delete(): Promise<void> {
        throw vscode.FileSystemError.NoPermissions('Not supported yet');
    }

    rename(): void {
        throw vscode.FileSystemError.NoPermissions('Not supported yet');
    }
}

function parseUri(uri: vscode.Uri): { contextPath: string; filePath: string } {
    const contextPath = uri.authority;
    const filePath = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
    return { contextPath, filePath };
}

export function buildFileUri(contextPath: string, filePath: string): vscode.Uri {
    return vscode.Uri.parse(`${TACHIKOMA_SCHEME}://${contextPath}/${filePath}`);
}
