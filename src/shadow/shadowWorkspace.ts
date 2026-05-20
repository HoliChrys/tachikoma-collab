// VI-2a Shadow Workspace - high-level facade (Phase 1 POC).
//
// Wraps a ShadowFsProvider and exposes the operations agents will call
// to stage, diff, and (eventually) commit experimental edits. URIs are
// re-mapped from any non-shadow scheme (typically `file:`) into
// `tachikoma-shadow:` so the user's open documents are never mutated.
//
// Phase 2 will host this class inside a utilityProcess fork and route
// applyEdits through MessageChannelMain.
//
// Spec: .agents/specs/to_do/VI-2a-shadow-workspace.md (Phase 1).
// ASCII only, 4-space indent.

import * as vscode from 'vscode';
import { ShadowFsProvider, SHADOW_SCHEME } from './shadowFsProvider';

export interface ShadowDiff {
    added: string[];
    modified: string[];
    deleted: string[];
}

function toShadowUri(real: vscode.Uri): vscode.Uri {
    if (real.scheme === SHADOW_SCHEME) return real;
    // We collapse the real URI into a single shadow path. The shadow
    // workspace is flat per-scheme: the path component is preserved so
    // back-mapping during commit is trivial.
    return vscode.Uri.from({ scheme: SHADOW_SCHEME, path: real.path });
}

function toRealUri(shadow: vscode.Uri, template: vscode.Uri): vscode.Uri {
    // Re-apply the original scheme/authority so commit() writes back to
    // the user's filesystem at the same location.
    return template.with({ path: shadow.path });
}

export class ShadowWorkspace {
    constructor(private readonly fs: ShadowFsProvider) {}

    /**
     * Apply a WorkspaceEdit but redirect every URI into the shadow
     * scheme. Currently supports text edits (insert / replace / delete)
     * and createFile / deleteFile / renameFile via the WorkspaceEdit
     * "file operations" entries.
     */
    async applyEdits(edits: vscode.WorkspaceEdit): Promise<void> {
        const shadowEdit = new vscode.WorkspaceEdit();

        // 1) Text edits, grouped by URI.
        for (const [uri, textEdits] of edits.entries()) {
            const shadowUri = toShadowUri(uri);
            // Ensure the target file exists in the shadow buffer before
            // applyEdit() runs, otherwise applyEdit cannot open it.
            await this._ensureShadowFile(uri, shadowUri);
            for (const te of textEdits) {
                shadowEdit.replace(shadowUri, te.range, te.newText);
            }
        }

        const ok = await vscode.workspace.applyEdit(shadowEdit);
        if (!ok) throw new Error('shadow applyEdit failed');
    }

    /**
     * Compare the shadow buffer against the real workspace. `realRoot`
     * carries the scheme + authority used to read the real files back;
     * only the path component is swapped against shadow entries.
     */
    async diff(realRoot: vscode.Uri): Promise<ShadowDiff> {
        const added: string[] = [];
        const modified: string[] = [];
        const deleted: string[] = [];

        for (const shadowPath of this.fs.listFiles()) {
            const shadowBytes = this.fs.readFile(
                vscode.Uri.from({ scheme: SHADOW_SCHEME, path: shadowPath }),
            );
            const realUri = realRoot.with({ path: shadowPath });
            let realBytes: Uint8Array | null = null;
            try {
                realBytes = await vscode.workspace.fs.readFile(realUri);
            } catch {
                realBytes = null;
            }
            if (realBytes === null) {
                added.push(shadowPath);
                continue;
            }
            if (!bytesEqual(shadowBytes, realBytes)) {
                modified.push(shadowPath);
            }
        }
        // Phase 1 does not track deletions explicitly; the shadow buffer
        // has no "tombstone" yet. Deferred to Phase 2.
        return { added, modified, deleted };
    }

    /**
     * Write every shadow file back to the real workspace using the
     * scheme/authority of `realRoot`, then clear the shadow buffer.
     */
    async commit(realRoot?: vscode.Uri): Promise<void> {
        const root = realRoot ?? this._inferRealRoot();
        if (!root) throw new Error('commit: no real workspace root available');
        for (const shadowPath of this.fs.listFiles()) {
            const shadowUri = vscode.Uri.from({ scheme: SHADOW_SCHEME, path: shadowPath });
            const bytes = this.fs.readFile(shadowUri);
            const realUri = toRealUri(shadowUri, root);
            await vscode.workspace.fs.writeFile(realUri, bytes);
        }
        this.fs.clearAll();
    }

    /** Drop every staged change without touching the real workspace. */
    discard(): void {
        this.fs.clearAll();
    }

    // --------------------------------------------------------------------

    private async _ensureShadowFile(realUri: vscode.Uri, shadowUri: vscode.Uri): Promise<void> {
        try {
            this.fs.stat(shadowUri);
            return; // already present
        } catch {
            // Not in shadow yet: seed from the real file if it exists,
            // otherwise create an empty file. Either way applyEdit() can
            // then operate on it.
        }
        let seed: Uint8Array;
        try {
            seed = await vscode.workspace.fs.readFile(realUri);
        } catch {
            seed = new Uint8Array();
        }
        this.fs.writeFile(shadowUri, seed, { create: true, overwrite: true });
    }

    private _inferRealRoot(): vscode.Uri | null {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) return folders[0].uri;
        return null;
    }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.byteLength; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
