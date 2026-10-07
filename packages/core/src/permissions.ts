interface OpenRequest {
  conversationId: string | undefined
  at: number
}

export class PermissionStore {
  private open_ = new Map<string, OpenRequest>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(ttlMs: number, now: () => number) {
    this.ttlMs = ttlMs
    this.now = now
  }

  open(requestId: string, conversationId: string | undefined): void {
    this.open_.set(requestId, { conversationId, at: this.now() })
  }

  has(requestId: string): boolean {
    const entry = this.open_.get(requestId)
    if (!entry) return false
    if (this.now() - entry.at > this.ttlMs) {
      this.open_.delete(requestId)
      return false
    }
    return true
  }

  getConversation(requestId: string): string | undefined {
    return this.open_.get(requestId)?.conversationId
  }

  close(requestId: string): void {
    this.open_.delete(requestId)
  }
}
