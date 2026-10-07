import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChannelCore, type Notifier } from './core.ts'
import { PermissionStore } from './permissions.ts'
import { FakeBridge } from './testing/fake-bridge.ts'
import { createLogger } from './logger.ts'
import { Writable } from 'node:stream'

const nullLog = () => createLogger([], new Writable({ write(_c, _e, cb) { cb() } }))

function makeNotifier() {
  const events: Array<{ content: string; meta: Record<string, string> }> = []
  const verdicts: Array<{ requestId: string; behavior: string }> = []
  const notifier: Notifier = {
    async channelEvent(content, meta) { events.push({ content, meta }) },
    async permissionVerdict(requestId, behavior) { verdicts.push({ requestId, behavior }) },
  }
  return { notifier, events, verdicts }
}

function setup() {
  const bridge = new FakeBridge()
  const store = new PermissionStore(60_000, () => 0)
  const { notifier, events, verdicts } = makeNotifier()
  const core = new ChannelCore({ bridge, notifier, store, logger: nullLog() })
  return { bridge, store, core, events, verdicts }
}

test('forwards normal chat as a channel event with chat_id and sender meta', async () => {
  const { core, events } = setup()
  await core.handleInbound({ conversationId: 'c1', senderId: '+1', text: 'what changed?' })
  assert.deepEqual(events, [{ content: 'what changed?', meta: { chat_id: 'c1', sender: '+1' } }])
})

test('a verdict for an OPEN request emits a verdict and is NOT forwarded as chat', async () => {
  const { core, store, events, verdicts } = setup()
  store.open('abcde', 'c1')
  await core.handleInbound({ conversationId: 'c1', senderId: '+1', text: 'yes abcde' })
  assert.deepEqual(verdicts, [{ requestId: 'abcde', behavior: 'allow' }])
  assert.equal(events.length, 0)
  assert.equal(store.has('abcde'), false) // closed
})

test('a verdict-shaped reply with NO open request is dropped (not forwarded)', async () => {
  const { core, events, verdicts } = setup()
  await core.handleInbound({ conversationId: 'c1', senderId: '+1', text: 'yes abcde' })
  assert.equal(verdicts.length, 0)
  assert.equal(events.length, 0)
})

test('handleReply calls bridge.sendMessage and returns ok', async () => {
  const { core, bridge } = setup()
  const res = await core.handleReply({ chat_id: 'c1', text: 'done' })
  assert.deepEqual(res, { ok: true })
  assert.deepEqual(bridge.sent, [{ conversationId: 'c1', text: 'done' }])
})

test('handleReply returns an error result when the send fails', async () => {
  const { core, bridge } = setup()
  bridge.failSend = true
  const res = await core.handleReply({ chat_id: 'c1', text: 'done' })
  assert.equal(res.ok, false)
  assert.match((res as { error: string }).error, /send failed/)
})

test('a permission request routes a prompt to the active conversation', async () => {
  const { core, bridge } = setup()
  await core.handleInbound({ conversationId: 'c9', senderId: '+1', text: 'hi' })
  await core.handlePermissionRequest({ requestId: 'abcde', toolName: 'Bash', description: 'Run shell command', inputPreview: 'ls' })
  assert.equal(bridge.prompts.length, 1)
  assert.equal(bridge.prompts[0]!.conversationId, 'c9')
})

test('a permission request with no prior inbound does not crash and sends nothing', async () => {
  const { core, bridge, store } = setup()
  await core.handlePermissionRequest({ requestId: 'abcde', toolName: 'Bash', description: 'x', inputPreview: 'y' })
  assert.equal(bridge.prompts.length, 0)
  assert.equal(store.has('abcde'), true) // still tracked so the terminal answer path is unaffected
})
