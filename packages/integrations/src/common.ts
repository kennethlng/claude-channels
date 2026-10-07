import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { formatVerdictInstruction, type PermissionPrompt } from '@repo/contract'

export function isAllowed(allowlist: string[], senderId: string): boolean {
  return allowlist.includes(senderId)
}

export class BodyTooLargeError extends Error {}

/**
 * Reads an HTTP request body into a Buffer, aborting once it exceeds `maxBytes`
 * (the endpoint is internet-facing and unauthenticated until the body is read,
 * so an unbounded read is a memory-exhaustion vector). Raw bytes are collected
 * and concatenated so the caller can decode once — decoding each chunk
 * separately corrupts a multibyte character whose bytes span two `data` events.
 */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let done = false
    const settle = (fn: () => void) => {
      if (done) return
      done = true
      fn()
    }
    req.on('data', (c: Buffer) => {
      if (done) return
      total += c.length
      if (total > maxBytes) {
        settle(() => reject(new BodyTooLargeError(`request body exceeds ${maxBytes} bytes`)))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => settle(() => resolve(Buffer.concat(chunks))))
    req.on('error', (err) => settle(() => reject(err)))
  })
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
