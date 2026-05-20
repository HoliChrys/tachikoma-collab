/**
 * Lazy-loader for Yjs.
 *
 * Yjs (~75 KB minified) is only needed when the user actually opens a file
 * for live collaboration. To keep the extension's cold-start bundle small,
 * we mark `yjs` as `--external:yjs` in the main esbuild step, ship it as a
 * separate file at `dist/yjs-bundle.js`, and load it on demand via a
 * runtime `require()` from this module.
 *
 * Compile-time types are still pulled in via `import type * as Y from 'yjs'`
 * — that import is erased by tsc and therefore contributes 0 bytes to
 * either bundle.
 */

import type * as Y from 'yjs';

// `require` and `__dirname` are CJS globals provided by the Node / VS Code
// extension host. We declare them so tsc is happy without pulling in
// @types/node global augmentations into this file.
declare const require: (id: string) => unknown;
declare const __dirname: string;

let cached: typeof Y | null = null;

/**
 * Resolve the path to the standalone yjs bundle that esbuild emits next to
 * the main extension bundle. At runtime the extension is loaded as
 * `dist/extension.js`, so `__dirname` is the `dist/` directory and the
 * sibling file is `dist/yjs-bundle.js`.
 */
function resolveBundlePath(): string {
    return __dirname + '/yjs-bundle.js';
}

/**
 * Synchronously load the Yjs module the first time it's needed.
 *
 * Synchronous is fine: the extension host runs on Node where `require()`
 * is sync, and the collaboration entry point itself is reached from an
 * async command handler — the user already pays for IO latency there.
 */
export function loadYjs(): typeof Y {
    if (cached) return cached;
    // Indirect-call require so esbuild does not try to statically bundle
    // the target file: assigning `require` to a local variable hides the
    // call site from esbuild's static analysis, leaving a real runtime
    // `require(<expr>)` in the emitted bundle.
    const indirectRequire: (id: string) => unknown = require;
    cached = indirectRequire(resolveBundlePath()) as typeof Y;
    return cached;
}
