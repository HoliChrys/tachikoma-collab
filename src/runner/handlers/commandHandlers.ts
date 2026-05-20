// VI-1c command.* RPC handlers.
//
// command.execute -> vscode.commands.executeCommand
// command.list    -> vscode.commands.getCommands
//
// Spec: .agents/specs/to_do/VI-1c-runner-rpc.md.
// ASCII only, 4-space indent.

import * as vscode from 'vscode';
import { RpcDispatcher } from '../rpcDispatcher';

interface ExecuteParams {
    commandId: string;
    args?: any[];
}

interface ListParams {
    filter?: string;       // case-insensitive substring filter
    includeInternal?: boolean;
}

export function registerCommandHandlers(disp: RpcDispatcher): void {
    disp.register('command.execute', async (params: ExecuteParams) => {
        if (!params?.commandId) throw new Error('commandId required');
        const args = Array.isArray(params.args) ? params.args : [];
        const result = await vscode.commands.executeCommand(
            params.commandId,
            ...args,
        );
        return { result: result ?? null };
    });

    disp.register('command.list', async (params: ListParams = {}) => {
        const all = await vscode.commands.getCommands(!params.includeInternal);
        const filter = params.filter?.toLowerCase();
        const commands = filter
            ? all.filter((c) => c.toLowerCase().includes(filter))
            : all;
        return { commands };
    });
}
