// Runner module-level shared handles.
//
// Other modules sometimes need a reference to objects created during
// activation (e.g. the ShadowWorkspace facade) so future RPC handlers
// can pick them up without re-plumbing through every function call.
// Phase 2 will replace this module-level singleton with a proper
// dependency-injection container.
//
// Spec: .agents/specs/to_do/VI-2a-shadow-workspace.md (Phase 1 wiring).
// ASCII only, 4-space indent.

import type { ShadowWorkspace } from '../shadow/shadowWorkspace';

let shadowWorkspace: ShadowWorkspace | null = null;

export function setShadowWorkspace(ws: ShadowWorkspace | null): void {
    shadowWorkspace = ws;
}

export function getShadowWorkspace(): ShadowWorkspace | null {
    return shadowWorkspace;
}
