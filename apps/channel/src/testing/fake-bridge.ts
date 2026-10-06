import type { BridgeHandlers, ChannelBridge, InboundMessage, PermissionPrompt } from '../bridge/types.ts'

export class FakeBridge implements ChannelBridge {
  sent: Array<{ conversationId: string; text: string }> = []
  prompts: Array<{ conversationId: string; prompt: PermissionPrompt }> = []
  failSend = false
  private handlers: BridgeHandlers | undefined

  async start(handlers: BridgeHandlers): Promise<void> {
    this.handlers = handlers
  }
  async stop(): Promise<void> {}
  async sendMessage(conversationId: string, text: string): Promise<void> {
    if (this.failSend) throw new Error('send failed')
    this.sent.push({ conversationId, text })
  }
  async sendPermissionPrompt(conversationId: string, prompt: PermissionPrompt): Promise<void> {
    if (this.failSend) throw new Error('prompt send failed')
    this.prompts.push({ conversationId, prompt })
  }
  /** Simulate an allowed inbound message arriving from the platform. */
  async emit(msg: InboundMessage): Promise<void> {
    await this.handlers!.onMessage(msg)
  }
}
