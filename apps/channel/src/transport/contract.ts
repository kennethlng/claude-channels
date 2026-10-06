import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ChannelBridge, InboundMessage } from '../bridge/types.ts'

export interface BridgeDriver {
  bridge: ChannelBridge
  /** Make an allowed inbound message arrive through the real transport path. */
  simulateInbound(msg: InboundMessage): Promise<void>
  /** Everything the bridge has sent outbound so far. */
  outbound(): Promise<{ messages: string[]; prompts: string[] }>
  cleanup(): Promise<void>
}

export function runBridgeContract(name: string, makeDriver: () => Promise<BridgeDriver>): void {
  test(`${name}: delivers inbound to the handler`, async () => {
    const received: InboundMessage[] = []
    const d = await makeDriver()
    try {
      await d.bridge.start({ onMessage: (m) => { received.push(m) } })
      await d.simulateInbound({ conversationId: 'c1', senderId: 'me', text: 'hello' })
      assert.equal(received.at(-1)?.text, 'hello')
    } finally { await d.cleanup() }
  })

  test(`${name}: sendMessage is observable outbound`, async () => {
    const d = await makeDriver()
    try {
      await d.bridge.start({ onMessage: () => {} })
      await d.bridge.sendMessage('c1', 'a reply')
      const out = await d.outbound()
      assert.ok(out.messages.some((m) => m.includes('a reply')))
    } finally { await d.cleanup() }
  })

  test(`${name}: sendPermissionPrompt is observable outbound and includes the id`, async () => {
    const d = await makeDriver()
    try {
      await d.bridge.start({ onMessage: () => {} })
      await d.bridge.sendPermissionPrompt('c1', { requestId: 'abcde', toolName: 'Bash', description: 'Run shell command', inputPreview: 'ls' })
      const out = await d.outbound()
      assert.ok(out.prompts.some((p) => p.includes('abcde')))
    } finally { await d.cleanup() }
  })
}
