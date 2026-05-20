/// <reference lib="dom" />
// VI-1f floating panes - drag / resize / close handle helpers.
//
// Pure DOM helpers that attach pointer-event listeners to a host overlay
// element. The caller owns the overlay lifecycle; these helpers only mutate
// inline styles during interaction and fire a single `onChange` callback on
// pointer release so the manager can publish the final position/size back to
// zellij.
//
// No reference to the vscode API on purpose - the manager runs inside the
// renderer process, attached to the workbench DOM root.
//
// Spec: .agents/specs/to_do/VI-1f-floating-windows.md
// ASCII only, 4-space indent.

import type { FloatingPaneCoordinates } from "./floatingProtocol";

export type CoordinateChangeHandler = (
    coordinates: FloatingPaneCoordinates,
) => void;

interface PointerOrigin {
    pointerX: number;
    pointerY: number;
    left: number;
    top: number;
    width: number;
    height: number;
}

function readCoordinates(host: HTMLElement): FloatingPaneCoordinates {
    return {
        x: host.offsetLeft,
        y: host.offsetTop,
        width: host.offsetWidth,
        height: host.offsetHeight,
    };
}

function startPointer(
    handle: HTMLElement,
    host: HTMLElement,
    apply: (origin: PointerOrigin, dx: number, dy: number) => void,
    onCommit: CoordinateChangeHandler,
): void {
    handle.addEventListener("pointerdown", (downEvent: PointerEvent) => {
        downEvent.preventDefault();
        downEvent.stopPropagation();
        handle.setPointerCapture(downEvent.pointerId);

        const origin: PointerOrigin = {
            pointerX: downEvent.clientX,
            pointerY: downEvent.clientY,
            left: host.offsetLeft,
            top: host.offsetTop,
            width: host.offsetWidth,
            height: host.offsetHeight,
        };

        const handleMove = (moveEvent: PointerEvent): void => {
            apply(
                origin,
                moveEvent.clientX - origin.pointerX,
                moveEvent.clientY - origin.pointerY,
            );
        };

        const handleUp = (upEvent: PointerEvent): void => {
            handle.releasePointerCapture(upEvent.pointerId);
            handle.removeEventListener("pointermove", handleMove);
            handle.removeEventListener("pointerup", handleUp);
            handle.removeEventListener("pointercancel", handleUp);
            onCommit(readCoordinates(host));
        };

        handle.addEventListener("pointermove", handleMove);
        handle.addEventListener("pointerup", handleUp);
        handle.addEventListener("pointercancel", handleUp);
    });
}

export function attachDragHandle(
    handle: HTMLElement,
    host: HTMLElement,
    onChange: CoordinateChangeHandler,
): void {
    startPointer(
        handle,
        host,
        (origin, dx, dy) => {
            host.style.left = `${origin.left + dx}px`;
            host.style.top = `${origin.top + dy}px`;
        },
        onChange,
    );
}

export function attachResizeHandle(
    handle: HTMLElement,
    host: HTMLElement,
    onChange: CoordinateChangeHandler,
    minWidth = 160,
    minHeight = 96,
): void {
    startPointer(
        handle,
        host,
        (origin, dx, dy) => {
            const nextWidth = Math.max(minWidth, origin.width + dx);
            const nextHeight = Math.max(minHeight, origin.height + dy);
            host.style.width = `${nextWidth}px`;
            host.style.height = `${nextHeight}px`;
        },
        onChange,
    );
}

export function attachCloseHandle(
    handle: HTMLElement,
    onClose: () => void,
): void {
    handle.addEventListener("click", (clickEvent: MouseEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        onClose();
    });
}
