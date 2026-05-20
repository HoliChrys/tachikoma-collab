/// <reference lib="dom" />
// VI-1f floating panes - overlay DOM manager.
//
// Maintains the set of floating overlay DIVs attached to the Monaco workbench
// root. Driven by ZellijFloatingEvent messages emitted by the HoliChrys/zellij
// fork's control buffer and surfaced through the VI-1c transport channel
// `zellij.{computerId}.floating`. When the user drags / resizes / closes an
// overlay locally, the manager emits a FloatingPaneAction back to the caller
// (typically forwarded to zellij so the server-side pane stays in sync).
//
// The manager is intentionally renderer-only: no vscode API import, no
// network code. Wiring is the job of `index.ts` / `extension.ts`.
//
// Spec: .agents/specs/to_do/VI-1f-floating-windows.md
// ASCII only, 4-space indent.

import {
    attachCloseHandle,
    attachDragHandle,
    attachResizeHandle,
} from "./floatingHandle";
import type {
    FloatingPaneAction,
    FloatingPaneCoordinates,
    ZellijFloatingEvent,
} from "./floatingProtocol";

export type FloatingActionEmitter = (action: FloatingPaneAction) => void;

const WORKBENCH_SELECTOR = ".monaco-workbench";

const HOST_CLASS = "tachikoma-floating-pane";
const DRAGBAR_CLASS = "tachikoma-floating-pane__dragbar";
const CLOSE_CLASS = "tachikoma-floating-pane__close";
const RESIZE_CLASS = "tachikoma-floating-pane__resize";
const BODY_CLASS = "tachikoma-floating-pane__body";

export class FloatingPaneManager {
    private readonly overlays = new Map<number, HTMLDivElement>();
    private readonly emit: FloatingActionEmitter;
    private root: Element | null;
    private visible = true;

    constructor(emit: FloatingActionEmitter, root?: Element | null) {
        this.emit = emit;
        this.root = root ?? this.resolveRoot();
    }

    handle(event: ZellijFloatingEvent): void {
        switch (event.type) {
            case "floating_pane_created":
                this.create(event.pane_id, event.coordinates);
                break;
            case "floating_pane_moved":
                this.move(event.pane_id, event.coordinates);
                break;
            case "floating_pane_resized":
                this.resize(event.pane_id, event.coordinates);
                break;
            case "floating_pane_closed":
                this.destroy(event.pane_id);
                break;
            case "floating_visibility_toggled":
                this.setVisible(event.visible);
                break;
            default: {
                const _exhaustive: never = event;
                void _exhaustive;
            }
        }
    }

    dispose(): void {
        for (const overlay of this.overlays.values()) {
            overlay.remove();
        }
        this.overlays.clear();
    }

    private resolveRoot(): Element | null {
        if (typeof document === "undefined") {
            return null;
        }
        return document.querySelector(WORKBENCH_SELECTOR);
    }

    private create(paneId: number, coords: FloatingPaneCoordinates): void {
        const root = this.root ?? this.resolveRoot();
        if (!root) {
            return;
        }
        this.root = root;
        if (this.overlays.has(paneId)) {
            this.move(paneId, coords);
            this.resize(paneId, coords);
            return;
        }

        const host = document.createElement("div");
        host.className = HOST_CLASS;
        host.id = `tk-float-${paneId}`;
        host.dataset.paneId = String(paneId);
        host.style.position = "absolute";
        host.style.zIndex = "9999";
        host.style.left = `${coords.x}px`;
        host.style.top = `${coords.y}px`;
        host.style.width = `${coords.width}px`;
        host.style.height = `${coords.height}px`;
        host.style.backdropFilter = "blur(20px)";
        host.style.background = "rgba(24, 20, 31, 0.85)";
        host.style.borderRadius = "12px";
        host.style.border = "1px solid rgba(255, 255, 255, 0.20)";
        host.style.boxShadow = "0 16px 64px rgba(0, 0, 0, 0.50)";
        host.style.overflow = "hidden";
        host.style.display = this.visible ? "block" : "none";

        const dragBar = document.createElement("div");
        dragBar.className = DRAGBAR_CLASS;
        attachDragHandle(dragBar, host, (next) => {
            this.emit({
                type: "floating_pane_move",
                pane_id: paneId,
                coordinates: next,
            });
        });

        const closeButton = document.createElement("button");
        closeButton.className = CLOSE_CLASS;
        closeButton.type = "button";
        closeButton.setAttribute("aria-label", "Close floating pane");
        closeButton.textContent = "×";
        attachCloseHandle(closeButton, () => {
            this.emit({
                type: "floating_pane_close",
                pane_id: paneId,
            });
        });

        const body = document.createElement("div");
        body.className = BODY_CLASS;

        const resizeHandle = document.createElement("div");
        resizeHandle.className = RESIZE_CLASS;
        attachResizeHandle(resizeHandle, host, (next) => {
            this.emit({
                type: "floating_pane_resize",
                pane_id: paneId,
                coordinates: next,
            });
        });

        host.appendChild(dragBar);
        host.appendChild(closeButton);
        host.appendChild(body);
        host.appendChild(resizeHandle);
        root.appendChild(host);
        this.overlays.set(paneId, host);
    }

    private move(paneId: number, coords: FloatingPaneCoordinates): void {
        const host = this.overlays.get(paneId);
        if (!host) {
            return;
        }
        host.style.left = `${coords.x}px`;
        host.style.top = `${coords.y}px`;
    }

    private resize(paneId: number, coords: FloatingPaneCoordinates): void {
        const host = this.overlays.get(paneId);
        if (!host) {
            return;
        }
        host.style.width = `${coords.width}px`;
        host.style.height = `${coords.height}px`;
    }

    private destroy(paneId: number): void {
        const host = this.overlays.get(paneId);
        if (!host) {
            return;
        }
        host.remove();
        this.overlays.delete(paneId);
    }

    private setVisible(visible: boolean): void {
        this.visible = visible;
        for (const host of this.overlays.values()) {
            host.style.display = visible ? "block" : "none";
        }
    }

    // Test / debug surface - returns the overlay element for a pane if any.
    getOverlay(paneId: number): HTMLDivElement | undefined {
        return this.overlays.get(paneId);
    }

    get paneCount(): number {
        return this.overlays.size;
    }
}
