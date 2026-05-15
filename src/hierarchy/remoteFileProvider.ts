import * as vscode from 'vscode';

export const TACHIKOMA_SCHEME = 'tachikoma';

export function buildFileUri(contextPath: string, filePath: string): vscode.Uri {
    return vscode.Uri.parse(
        `${TACHIKOMA_SCHEME}://tachikoma/${filePath}?ctx=${encodeURIComponent(contextPath)}`
    );
}

export class RemoteFileProvider implements vscode.FileSystemProvider {
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._onDidChangeFile.event;

    watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }
    stat(): Promise<vscode.FileStat> { throw vscode.FileSystemError.FileNotFound(); }
    readDirectory(): Promise<[string, vscode.FileType][]> { return Promise.resolve([]); }
    readFile(): Promise<Uint8Array> { throw vscode.FileSystemError.FileNotFound(); }
    writeFile(): Promise<void> { throw vscode.FileSystemError.NoPermissions(); }
    createDirectory(): Promise<void> { throw vscode.FileSystemError.NoPermissions(); }
    delete(): Promise<void> { throw vscode.FileSystemError.NoPermissions(); }
    rename(): Promise<void> { throw vscode.FileSystemError.NoPermissions(); }
}
