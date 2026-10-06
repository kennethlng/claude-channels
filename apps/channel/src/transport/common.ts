import { createHmac, timingSafeEqual } from 'node:crypto'
import { formatVerdictInstruction, type PermissionPrompt } from '../bridge/types.ts'

export function isAllowed(allowlist: string[], senderId: string): boolean {
  return allowlist.includes(senderId)
}

export class Deduper {
  private seen = new Set<string>()
  private order: string[] = []
  private readonly max: number
  constructor(max = 1000) {
    this.max = max
  }
  /** Returns true if `id` is new (and records it); false if already seen. */
  check(id: string): boolean {
    if (this.seen.has(id)) return false
    this.seen.add(id)
    this.order.push(id)
    if (this.order.length > this.max) {
      const oldest = this.order.shift()!
      this.seen.delete(oldest)
    }
    return true
  }
}

/** Verifies a hex-encoded HMAC-SHA256 signature in constant time. */
export function verifyHmac(secret: string, rawBody: string, signatureHex: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHex)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function renderPrompt(p: PermissionPrompt): string {
  return (
    `Claude wants to run ${p.toolName}: ${p.description}\n` +
    `${p.inputPreview}\n\n` +
    formatVerdictInstruction(p.requestId)
  )
}
