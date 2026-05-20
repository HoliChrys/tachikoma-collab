/// <reference lib="dom" />
// VI-1f floating panes - module entry point.
//
// Wires a FloatingPaneManager to a vendored @tachikoma/transport client and
// subscribes to the `zellij.{computerId}.floating` channel. Incoming events
// are decoded into ZellijFloatingEvent and routed to the manager. Returns a
// vscode.Disposable so the extension can clean up overlays and the
// subscription on shutdown.
//
// Imports the vendored transport bundle (the VI-1c v5.6 vendoring) via
// `../runner/vendor/transport` - the same path the runner uses - so this
// module does not introduce a new direct dependency on @tachikoma/transport.
//
// Spec: .agents/specs/to_do/VI-1f-floating-windows.md
// ASCII only, 4-space indent.

import * as vscode from "vscode";
import type {
    TransportClient,
    TransportEvent,
} from "../runner/vendor/transport";
import {
    FloatingPaneManager,
    type FloatingActionEmitter,
} from "./floatingPaneManager";
import type {
    FloatingPaneAction,
    ZellijFloatingEvent,
} from "./floatingProtocol";

export interface InitFloatingPanesOptions {
    emit?: FloatingActionEmitter;
    root?: Element | null;
}

function channelFor(computerId: string): string {
    return `zellij.${computerId}.floating`;
}

function decodeEvent(event: TransportEvent): ZellijFloatingEvent | null {
    const payload = event.data as Partial<ZellijFloatingEvent> | undefined;
    if (!payload || typeof payload.type !== "string") {
        return null;
    }
    return payload as ZellijFloatingEvent;
}

export async function initFloatingPanes(
    transport: TransportClient,
    computerId: string,
    options: InitFloatingPanesOptions = {},
): Promise<vscode.Disposable> {
    const emit: FloatingActionEmitter =
        options.emit ?? (() => {
            // Dormant until extension.ts wires the outbound bridge.
        });
    const manager = new FloatingPaneManager(emit, options.root);
    const channel = channelFor(computerId);

    const offEvent = transport.onEvent((event: TransportEvent) => {
        if (event.channel !== channel) {
            return;
        }
        const decoded = decodeEvent(event);
        if (decoded) {
            manager.handle(decoded);
        }
    });

    await transport.subscribe({ channels: [channel] });

    return new vscode.Disposable(() => {
        try {
            transport.unsubscribe([channel]);
        } catch {
            // ignore - transport may already be torn down
        }
        offEvent();
        manager.dispose();
    });
}

export type { FloatingPaneManager } from "./floatingPaneManager";
export type {
    FloatingPaneAction,
    ZellijFloatingEvent,
} from "./floatingProtocol";
