import { parseVerdictReply, type ChannelBridge, type InboundMessage, type PermissionPrompt } from '../bridge/types.ts'
import type { PermissionStore } from './permissions.ts'
import type { Logger } from './logger.ts'

export interface Notifier {
  channelEvent(content: string, meta: Record<string, string>): Promise<void>
  permissionVerdict(requestId: string, behavior: 'allow' | 'deny'): Promise<void>
}

export interface ChannelCoreDeps {
  bridge: ChannelBridge
  notifier: Notifier
  store: PermissionStore
  logger: Logger
}

export class ChannelCore {
  private activeConversationId: string | undefined
  private readonly deps: ChannelCoreDeps

  constructor(deps: ChannelCoreDeps) {
    this.deps = deps
  }

  async handleInbound(msg: InboundMessage): Promise<void> {
    const verdict = parseVerdictReply(msg.text)
    if (verdict) {
      if (this.deps.store.has(verdict.requestId)) {
        this.deps.store.close(verdict.requestId)
        await this.deps.notifier.permissionVerdict(verdict.requestId, verdict.behavior)
      } else {
        this.deps.logger.warn('verdict for unknown or expired request; dropping', { requestId: verdict.requestId })
      }
      return
    }
    this.activeConversationId = msg.conversationId
    await this.deps.notifier.channelEvent(msg.text, { chat_id: msg.conversationId, sender: msg.senderId })
  }

  async handleReply(args: { chat_id: string; text: string }): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.deps.bridge.sendMessage(args.chat_id, args.text)
      return { ok: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.deps.logger.error('reply send failed', { chat_id: args.chat_id, error })
      return { ok: false, error }
    }
  }

  async handlePermissionRequest(prompt: PermissionPrompt): Promise<void> {
    const conversationId = this.activeConversationId
    this.deps.store.open(prompt.requestId, conversationId)
    if (!conversationId) {
      this.deps.logger.warn('permission request with no active conversation; local dialog is the only path', { requestId: prompt.requestId })
      return
    }
    try {
      await this.deps.bridge.sendPermissionPrompt(conversationId, prompt)
    } catch (err) {
      this.deps.logger.error('failed to send permission prompt; local dialog is the backstop', {
        requestId: prompt.requestId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
