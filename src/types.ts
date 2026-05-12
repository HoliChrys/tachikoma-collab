export interface LoginResponse {
    token: string;
    user_id: string;
    roles: string[];
}

export interface UserInfo {
    user_id: string;
    roles: string[];
    permissions: string[];
}

export interface ComponentResponse {
    id: string;
    component_type: string;
    session_id: string;
    state: string;
    participants: string[];
    data: Record<string, unknown>;
}

export interface ComponentStateResponse {
    component_id: string;
    component_type: string;
    session_id: string;
    participants: string[];
    data: Record<string, unknown>;
}

export interface SSEConnectedEvent {
    subscriber_id: string;
    participant_id: string;
    channel: string;
    components: ComponentBinding[];
}

export interface ComponentBinding {
    component_id: string;
    component_type: string;
    session_id: string;
}

export interface ComponentUpdatedEvent {
    component_id: string;
    component_type: string;
    session_id: string;
    participant_id: string;
    update?: string; // base64-encoded CRDT binary
    changes?: Record<string, unknown>;
}

export interface ParticipantEvent {
    component_id: string;
    component_type: string;
    session_id: string;
    participant_id: string;
    participant_type?: string;
}

export interface HierarchyItem {
    id: string;
    name: string;
    level: 'galaxy' | 'system' | 'space';
    path: string;
    parent_path: string;
    owner_id: string;
    hive_channel: string;
    tools: string[];
    packages: string[];
}

export type TreeNodeType = 'galaxy' | 'system' | 'space' | 'folder' | 'file';

export interface ContextNode {
    id: string;
    name: string;
    type: TreeNodeType;
    path: string;
    fsPath?: string;
    children?: ContextNode[];
    hive_channel?: string;
}

export interface AwarenessState {
    user: { id: string; name: string; color: string };
    cursor: { line: number; character: number } | null;
    selections: Array<{
        anchor: { line: number; character: number };
        head: { line: number; character: number };
    }>;
    file: string;
}

export const USER_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
    '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
];
