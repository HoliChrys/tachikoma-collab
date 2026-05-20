import * as vscode from 'vscode';
import { AuthManager } from '../auth/authManager';
import { log } from '../log';

/**
 * @tachikoma chat participant (VS Code 1.95+ chat API).
 *
 * Flow :
 *   1. POST /api/agent/chat → synchronous ACK { message_id, status, ... }
 *   2. Subscribe SSE channel user.{user_id}.chat (via TachikomaClient.subscribeUserChatSse)
 *   3. Stream events :
 *      - agent.thinking → stream.progress
 *      - agent.message  → stream.markdown (intermediate)
 *      - agent.response → stream.markdown (final, end)
 *      - agent.error    → stream.markdown error, end
 */
export function registerTachikomaChatParticipant(
    context: vscode.ExtensionContext,
    authManager: AuthManager,
): vscode.Disposable {
    const participant = vscode.chat.createChatParticipant('tachikoma', async (request, _ctx, stream, token) => {
        if (!authManager.isConnected()) {
            stream.markdown('**Not connected to Tachikoma.** Run `Tachikoma: Connect with Token` first.');
            return;
        }
        const client = authManager.getClient()!;
        const userId = authManager.getUserId();
        if (!userId) {
            stream.markdown('**No user context.**');
            return;
        }

        stream.progress('Sending to Tachikoma...');
        let ack;
        try {
            ack = await client.sendChatMessage(request.prompt, '');
        } catch (err) {
            stream.markdown(`**Backend error:** ${(err as Error).message}`);
            return;
        }

        if (ack.status === 'unknown_action') {
            stream.markdown(`Unknown action \`${ack.action ?? ''}\``);
            return;
        }
        if (ack.status === 'completed' && ack.action) {
            stream.markdown(`Action \`${ack.action}\` completed.`);
            return;
        }

        // Subscribe to SSE and stream responses until agent.response or agent.error
        stream.progress('Thinking...');
        const targetMessageId = ack.message_id;
        let finished = false;
        const events: Array<{ type: string; [k: string]: unknown }> = [];
        let resolveEnd: () => void = () => { };
        const ended = new Promise<void>((r) => { resolveEnd = r; });

        const sub = client.subscribeUserChatSse(userId, (evt) => {
            const ty = String(evt.type ?? '');
            // Best-effort correlation : if the event carries a message_id, only handle matching ones.
            const evtMsgId = (evt as { message_id?: string }).message_id;
            if (evtMsgId && targetMessageId && evtMsgId !== targetMessageId) return;
            events.push(evt);
            if (ty === 'agent.response' || ty === 'agent.error') {
                finished = true;
                resolveEnd();
            } else if (ty === 'agent.message' || ty === 'agent.thinking') {
                // intermediate, keep waiting
            }
        });

        // Wait up to 60 seconds, or until cancelled
        const tokenSub = token.onCancellationRequested(() => {
            log('Chat cancelled by user');
            resolveEnd();
        });
        const timeoutMs = 60_000;
        const timeoutHandle = setTimeout(() => {
            if (!finished) {
                log('Chat timed out waiting for agent.response');
                resolveEnd();
            }
        }, timeoutMs);

        try {
            await ended;
        } finally {
            clearTimeout(timeoutHandle);
            sub.dispose();
            tokenSub.dispose();
        }

        // Render all collected events
        for (const evt of events) {
            const ty = String(evt.type ?? '');
            const content = String(evt.content ?? evt.message ?? '');
            if (ty === 'agent.message' && content) {
                stream.markdown(content + '\n\n');
            } else if (ty === 'agent.response' && content) {
                stream.markdown(content);
            } else if (ty === 'agent.error') {
                stream.markdown(`**Error:** ${String(evt.error ?? evt.content ?? 'unknown')}`);
            }
        }

        if (!finished && events.length === 0) {
            stream.markdown('_No response yet — try again or check the agent logs._');
        }
    });

    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'tachikoma-icon.svg');
    return participant;
}
