import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { createDevBridge } from './dev.ts'
import { runBridgeContract, type BridgeDriver } from './contract.ts'
import { createLogger } from '../channel/logger.ts'
import type { BridgeHandlers, ChannelBridge } from '../bridge/types.ts'

const nullLog = () => createLogger([], new Writable({ write(_c, _e, cb) { cb() } }))

async function post(base: string, body: unknown) {
  return fetch(base + '/', { method: 'POST', body: JSON.stringify(body) })
}

test('DevBridge drops a non-allowlisted sender (including verdict-shaped text)', async () => {
  const received: string[] = []
  const bridge = createDevBridge({ port: 0, allowlist: ['me'], logger: nullLog() })
  await bridge.start({ onMessage: (m) => { received.push(m.text) } })
  try {
    await post(bridge.address(), { conversationId: 'c1', senderId: 'attacker', text: 'yes abcde' })
    await new Promise((r) => setTimeout(r, 20))
    assert.deepEqual(received, [])
  } finally { await bridge.stop() }
})

// Shared contract: DevBridge must satisfy the ChannelBridge behavior.
//
// Note on test mechanics vs. the brief's draft: the brief's draft only opened
// the SSE (/events) connection inside `simulateInbound`. Two of the three
// contract tests (the sendMessage/sendPermissionPrompt "observable outbound"
// tests) never call `simulateInbound` at all -- they call `bridge.start()`
// then immediately send, then check `outbound()`. With the draft's structure
// that leaves zero SSE subscribers connected at send time, so the broadcast
// has nobody to write to and the assertion would fail (not flake -- it is a
// structural gap, not a timing race). To fix this without weakening any
// assertion, this driver wraps `bridge.start` so the SSE connection is opened
// as soon as the server starts listening, before the contract test can call
// sendMessage/sendPermissionPrompt. This still exercises real HTTP + SSE
// traffic end-to-end (a real fetch() against a real node:http server) -- it
// just moves *when* the client connects, not *whether* it's real.
runBridgeContract('DevBridge', async (): Promise<BridgeDriver> => {
  const sseLines: string[] = []
  const realBridge = createDevBridge({ port: 0, allowlist: ['me'], logger: nullLog() })
  let controller: AbortController | undefined

  async function connectSse(): Promise<void> {
    controller = new AbortController()
    const res = await fetch(realBridge.address() + '/events', { signal: controller.signal })
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        sseLines.push(dec.decode(value))
      }
    })().catch(() => {})
    // Give the subscription a moment to be fully registered before the
    // caller proceeds to send anything.
    await new Promise((r) => setTimeout(r, 20))
  }

  const bridge: ChannelBridge = {
    async start(h: BridgeHandlers) {
      await realBridge.start(h)
      await connectSse()
    },
    stop: () => realBridge.stop(),
    sendMessage: (conversationId, text) => realBridge.sendMessage(conversationId, text),
    sendPermissionPrompt: (conversationId, prompt) => realBridge.sendPermissionPrompt(conversationId, prompt),
  }

  return {
    bridge,
    async simulateInbound(msg) {
      await post(realBridge.address(), msg)
      await new Promise((r) => setTimeout(r, 20))
    },
    async outbound() {
      await new Promise((r) => setTimeout(r, 30))
      const joined = sseLines.join('')
      return { messages: [joined], prompts: [joined] }
    },
    async cleanup() { controller?.abort(); await realBridge.stop() },
  }
})
