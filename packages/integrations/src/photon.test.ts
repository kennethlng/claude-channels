import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapPhotonEvent } from './photon.ts'

// Payload shape confirmed by extracting the published `@photon-ai/chat-adapter-imessage@3.2.0`
// tarball from npm and reading its compiled `dist/index.js` (function `buildChatMessage` /
// `buildChatMessageFromWebhook` in src/internal/thread.ts, and `handleWebhook` in the adapter
// class). The real Spectrum Cloud "messages" webhook delivers:
//   { event: "messages", message: { id, content: { type: "text", text }, sender: { id }, direction }, space: { id, phone? } }
// `space.id` is the iMessage chat GUID (e.g. "iMessage;-;+15551234567") and is what the Chat SDK
// calls the thread's `chatGuid`. `message.direction` is `"inbound"` for messages from the user and
// `"outbound"` for messages the bot itself sent (which must NOT be re-delivered to onMessage).

test('maps a Photon "messages" webhook payload to an InboundMessage', () => {
  const raw = {
    event: 'messages',
    message: {
      id: 'msg-1',
      content: { type: 'text', text: 'ship it' },
      sender: { id: '+15551234567' },
      direction: 'inbound',
    },
    space: { id: 'iMessage;-;+15551234567' },
  }
  assert.deepEqual(mapPhotonEvent(raw), {
    conversationId: 'iMessage;-;+15551234567',
    senderId: '+15551234567',
    text: 'ship it',
  })
})

test('returns null for a payload with no text content (e.g. an attachment-only message)', () => {
  const raw = {
    event: 'messages',
    message: {
      id: 'msg-2',
      content: { type: 'attachment', name: 'photo.jpg' },
      sender: { id: '+15551234567' },
      direction: 'inbound',
    },
    space: { id: 'iMessage;-;+15551234567' },
  }
  assert.equal(mapPhotonEvent(raw), null)
})

test('returns null for a non-"messages" event (e.g. a reaction/tapback delivery)', () => {
  const raw = { event: 'reactions', message: {}, space: { id: 'x' } }
  assert.equal(mapPhotonEvent(raw), null)
})

test('returns null for the bot\'s own outbound message (avoids echo loops)', () => {
  const raw = {
    event: 'messages',
    message: {
      id: 'msg-3',
      content: { type: 'text', text: 'Hello from iMessage!' },
      sender: { id: 'bot-line' },
      direction: 'outbound',
    },
    space: { id: 'iMessage;-;+15551234567' },
  }
  assert.equal(mapPhotonEvent(raw), null)
})

test('returns null when required fields are missing or malformed', () => {
  assert.equal(mapPhotonEvent({}), null)
  assert.equal(mapPhotonEvent(null), null)
  assert.equal(mapPhotonEvent({ event: 'messages', message: { sender: {} }, space: {} }), null)
})
