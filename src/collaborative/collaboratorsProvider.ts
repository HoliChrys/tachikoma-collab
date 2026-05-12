import * as vscode from 'vscode';
import type { CollaborationManager } from './collaborationManager';

interface CollaboratorItem {
    id: string;
    label: string;
}

export class CollaboratorsProvider implements vscode.TreeDataProvider<CollaboratorItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CollaboratorItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private participants: string[] = [];
    private disposable: vscode.Disposable | null = null;

    bind(manager: CollaborationManager): void {
        this.disposable?.dispose();
        this.disposable = manager.onParticipantsChanged((ps) => {
            this.participants = ps;
            this._onDidChangeTreeData.fire(undefined);
        });
    }

    unbind(): void {
        this.disposable?.dispose();
        this.disposable = null;
        this.participants = [];
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: CollaboratorItem): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('account');
        return item;
    }

    getChildren(): CollaboratorItem[] {
        return this.participants.map((id) => ({ id, label: id }));
    }
}
