// VI-2a Shadow Workspace - public init entrypoint (Phase 1 POC).
//
// initShadowWorkspace() registers the in-memory FileSystemProvider with
// VS Code under the `tachikoma-shadow:` scheme and returns a Disposable
// plus a ShadowWorkspace facade. The caller (extension.ts) is expected
// to push the Disposable onto context.subscriptions and stash the
// ShadowWorkspace handle somewhere RPC handlers can reach it (currently
// runner/state.ts).
//
// Spec: .agents/specs/to_do/VI-2a-shadow-workspace.md (Phase 1).
// ASCII only, 4-space indent.

import * as vscode from 'vscode';
import { ShadowFsProvider, SHADOW_SCHEME } from './shadowFsProvider';
import { ShadowWorkspace } from './shadowWorkspace';

export { SHADOW_SCHEME, ShadowFsProvider, ShadowWorkspace };
export type { ShadowDiff } from './shadowWorkspace';

export interface ShadowWorkspaceHandle extends vscode.Disposable {
    workspace: ShadowWorkspace;
    provider: ShadowFsProvider;
}

export function initShadowWorkspace(
    context: vscode.ExtensionContext,
): ShadowWorkspaceHandle {
    const provider = new ShadowFsProvider();
    const registration = vscode.workspace.registerFileSystemProvider(
        SHADOW_SCHEME,
        provider,
        { isCaseSensitive: true, isReadonly: false },
    );
    context.subscriptions.push(registration);
    const workspace = new ShadowWorkspace(provider);

    return {
        workspace,
        provider,
        dispose: () => registration.dispose(),
    };
}
