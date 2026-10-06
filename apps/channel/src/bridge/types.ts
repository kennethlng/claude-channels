export interface InboundMessage {
  conversationId: string
  senderId: string
  text: string
}

export interface PermissionPrompt {
  requestId: string
  toolName: string
  description: string
  inputPreview: string
}

export interface PermissionVerdict {
  requestId: string
  behavior: 'allow' | 'deny'
}

export interface BridgeHandlers {
  onMessage(msg: InboundMessage): void | Promise<void>
}

export interface ChannelBridge {
  start(handlers: BridgeHandlers): Promise<void>
  stop(): Promise<void>
  sendMessage(conversationId: string, text: string): Promise<void>
  sendPermissionPrompt(conversationId: string, prompt: PermissionPrompt): Promise<void>
}

// Five letters, excluding 'l'. Case-insensitive to tolerate phone autocorrect.
export const VERDICT_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

export function parseVerdictReply(text: string): PermissionVerdict | null {
  const m = VERDICT_REPLY_RE.exec(text)
  if (!m) return null
  const requestId = m[2]!.toLowerCase()
  const behavior = m[1]!.toLowerCase().startsWith('y') ? 'allow' : 'deny'
  return { requestId, behavior }
}

export function formatVerdictInstruction(requestId: string): string {
  return `Reply "yes ${requestId}" or "no ${requestId}"`
}
