// VI-2a Shadow Workspace - smoke test (Phase 1 POC).
//
// Not wired into a test runner yet: just verifies the module compiles
// and that the contract holds when the host registers the provider.
// Run from an Extension Host with:
//
//   import { runShadowSmoke } from './shadow/shadowWorkspace.smoke';
//   await runShadowSmoke();
//
// CI integration is deferred to Phase 2.
//
// ASCII only, 4-space indent.

import * as vscode from 'vscode';
import { initShadowWorkspace, SHADOW_SCHEME } from './index';

export async function runShadowSmoke(
    context: vscode.ExtensionContext,
): Promise<void> {
    const handle = initShadowWorkspace(context);
    try {
        const target = vscode.Uri.from({ scheme: SHADOW_SCHEME, path: '/foo.ts' });

        // Seed via applyEdits: insert "hello" at (0,0) into a brand-new
        // shadow file. The facade auto-creates the file if missing.
        const edit = new vscode.WorkspaceEdit();
        edit.insert(target, new vscode.Position(0, 0), 'hello');
        await handle.workspace.applyEdits(edit);

        // Read back through vscode.workspace.fs to confirm VS Code is
        // routing the request through our provider.
        const bytes = await vscode.workspace.fs.readFile(target);
        const text = new TextDecoder().decode(bytes);
        if (text !== 'hello') {
            throw new Error(`shadow smoke mismatch: got ${JSON.stringify(text)}`);
        }
    } finally {
        handle.dispose();
    }
}
