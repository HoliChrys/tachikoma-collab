// VI-1f floating panes - control buffer protocol types.
//
// Mirrors the events emitted by the HoliChrys/zellij fork on its control
// buffer (per project-zellij-remote-attach-broken.md). The fork work is in
// flight in a parallel agent; these types are written against the agreed
// shape so the IDE side can be developed and unit-tested today against
// mocks, then wired live once the fork lands.
//
// Spec: .agents/specs/to_do/VI-1f-floating-windows.md
// ASCII only, 4-space indent.

export interface FloatingPaneCoordinates {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface FloatingPaneCreatedEvent {
    type: "floating_pane_created";
    pane_id: number;
    coordinates: FloatingPaneCoordinates;
}

export interface FloatingPaneMovedEvent {
    type: "floating_pane_moved";
    pane_id: number;
    coordinates: FloatingPaneCoordinates;
}

export interface FloatingPaneResizedEvent {
    type: "floating_pane_resized";
    pane_id: number;
    coordinates: FloatingPaneCoordinates;
}

export interface FloatingPaneClosedEvent {
    type: "floating_pane_closed";
    pane_id: number;
}

export interface FloatingVisibilityToggledEvent {
    type: "floating_visibility_toggled";
    visible: boolean;
}

export type ZellijFloatingEvent =
    | FloatingPaneCreatedEvent
    | FloatingPaneMovedEvent
    | FloatingPaneResizedEvent
    | FloatingPaneClosedEvent
    | FloatingVisibilityToggledEvent;

// Outbound actions sent back to zellij via the control buffer when the user
// drags / resizes / closes an overlay locally. Kept here so the manager and
// transport bridge share one source of truth.
export interface FloatingPaneMoveAction {
    type: "floating_pane_move";
    pane_id: number;
    coordinates: FloatingPaneCoordinates;
}

export interface FloatingPaneResizeAction {
    type: "floating_pane_resize";
    pane_id: number;
    coordinates: FloatingPaneCoordinates;
}

export interface FloatingPaneCloseAction {
    type: "floating_pane_close";
    pane_id: number;
}

export type FloatingPaneAction =
    | FloatingPaneMoveAction
    | FloatingPaneResizeAction
    | FloatingPaneCloseAction;
