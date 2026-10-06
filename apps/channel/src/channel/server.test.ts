import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import { createChannelServer } from './server.ts'
import { PermissionStore } from './permissions.ts'
import { FakeBridge } from '../testing/fake-bridge.ts'
import { createLogger } from './logger.ts'

const nullLog = () => createLogger([], new Writable({ write(_c, _e, cb) { cb() } }))

async function connectPair() {
  const bridge = new FakeBridge()
  const store = new PermissionStore(60_000, () => 0)
  const { server, core, connect } = createChannelServer({ bridge, store, logger: nullLog() })
  await bridge.start({ onMessage: (m) => core.handleInbound(m) })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-claude-code', version: '0' }, { capabilities: {} })
  await Promise.all([connect(serverTransport), client.connect(clientTransport)])
  return { client, bridge, store }
}

test('exposes a reply tool that routes to bridge.sendMessage', async () => {
  const { client, bridge } = await connectPair()
  const tools = await client.listTools()
  assert.ok(tools.tools.some((t) => t.name === 'reply'))
  const res = await client.callTool({ name: 'reply', arguments: { chat_id: 'c1', text: 'hello' } })
  assert.deepEqual(bridge.sent, [{ conversationId: 'c1', text: 'hello' }])
  assert.equal((res.content as Array<{ text: string }>)[0]!.text, 'sent')
})

test('a failed reply send returns an error result to the caller', async () => {
  const { client, bridge } = await connectPair()
  bridge.failSend = true
  const res = await client.callTool({ name: 'reply', arguments: { chat_id: 'c1', text: 'hello' } })
  assert.equal(res.isError, true)
})

test('a permission_request notification produces an outbound prompt on the active conversation', async () => {
  const { client, bridge } = await connectPair()
  await bridge.emit({ conversationId: 'c1', senderId: 'me', text: 'hi' }) // set active conversation
  await client.notification({
    method: 'notifications/claude/channel/permission_request',
    params: { request_id: 'abcde', tool_name: 'Bash', description: 'Run shell command', input_preview: 'ls -la' },
  })
  await new Promise((r) => setTimeout(r, 20)) // let the notification propagate
  assert.equal(bridge.prompts.length, 1)
  assert.equal(bridge.prompts[0]!.prompt.requestId, 'abcde')
})

test('an allowed inbound verdict emits a permission notification to Claude Code', async () => {
  const { client, bridge, store } = await connectPair()
  store.open('abcde', 'c1')
  const received: Array<{ request_id: string; behavior: string }> = []
  client.setNotificationHandler(
    z.object({
      method: z.literal('notifications/claude/channel/permission'),
      params: z.object({ request_id: z.string(), behavior: z.string() }),
    }),
    async (n) => { received.push(n.params) },
  )
  await bridge.emit({ conversationId: 'c1', senderId: 'me', text: 'yes abcde' })
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(received, [{ request_id: 'abcde', behavior: 'allow' }])
})
