import * as vscode from 'vscode';
import type { TachikomaClient } from '../api/tachikomaClient';
import { logError } from '../log';

export const TACHIKOMA_SCHEME = 'tachikoma';

/**
 * Provides file content for tachikoma:// URIs.
 *
 * URI format: tachikoma://context/path/to/file
 * Example:    tachikoma://tachikoma.paralelle.landingpage/app/src/main.ts
 */
export class RemoteFileProvider implements vscode.TextDocumentContentProvider {
    private client: TachikomaClient | null = null;

    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    setClient(client: TachikomaClient | null): void {
        this.client = client;
    }

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        if (!this.client) return '// Not connected to Tachikoma';

        const contextPath = uri.authority;
        const filePath = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;

        try {
            return await this.client.readFile(contextPath, filePath);
        } catch (err) {
            logError(`Failed to read ${contextPath}/${filePath}`, err);
            return `// Error reading file: ${err instanceof Error ? err.message : err}`;
        }
    }

    refresh(uri: vscode.Uri): void {
        this._onDidChange.fire(uri);
    }
}

export function buildFileUri(contextPath: string, filePath: string): vscode.Uri {
    return vscode.Uri.parse(`${TACHIKOMA_SCHEME}://${contextPath}/${filePath}`);
}
