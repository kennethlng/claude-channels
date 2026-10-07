import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { isAllowed, Deduper, verifyHmac, renderPrompt, readBody, BodyTooLargeError } from './common.ts'

function fakeReq(chunks: Buffer[]): IncomingMessage {
  return Readable.from(chunks) as unknown as IncomingMessage
}

test('readBody concatenates chunks within the limit', async () => {
  const buf = await readBody(fakeReq([Buffer.from('hello '), Buffer.from('world')]), 1000)
  assert.equal(buf.toString('utf8'), 'hello world')
})

test('readBody preserves a multibyte char split across chunks', async () => {
  // 'é' is bytes 0xC3 0xA9 — decoding each chunk separately would corrupt it.
  const buf = await readBody(fakeReq([Buffer.from([0xc3]), Buffer.from([0xa9])]), 1000)
  assert.equal(buf.toString('utf8'), 'é')
})

test('readBody rejects a body over the limit', async () => {
  await assert.rejects(
    () => readBody(fakeReq([Buffer.from('x'.repeat(50)), Buffer.from('y'.repeat(60))]), 64),
    BodyTooLargeError,
  )
})

test('isAllowed is an exact match, default deny', () => {
  assert.equal(isAllowed(['+15551234567'], '+15551234567'), true)
  assert.equal(isAllowed(['+15551234567'], '+15559999999'), false)
  assert.equal(isAllowed([], 'anyone'), false)
})

test('Deduper returns true once per id, false on repeats', () => {
  const d = new Deduper(3)
  assert.equal(d.check('a'), true)
  assert.equal(d.check('a'), false)
  assert.equal(d.check('b'), true)
})

test('Deduper evicts oldest beyond max so it can reappear', () => {
  const d = new Deduper(2)
  d.check('a'); d.check('b'); d.check('c') // 'a' evicted
  assert.equal(d.check('a'), true)
})

test('verifyHmac accepts a correct sha256 hex signature and rejects wrong ones', () => {
  const body = '{"hello":"world"}'
  const good = createHmac('sha256', 'secret').update(body).digest('hex')
  assert.equal(verifyHmac('secret', body, good), true)
  assert.equal(verifyHmac('secret', body, 'deadbeef'), false)
  assert.equal(verifyHmac('wrong', body, good), false)
})

test('renderPrompt keeps hostile multiline input as inert plain text', () => {
  const out = renderPrompt({
    requestId: 'abcde',
    toolName: 'Bash',
    description: 'Run shell command',
    inputPreview: 'rm -rf /\n<script>alert(1)</script>\n{"x":"<b>"}',
  })
  assert.match(out, /Claude wants to run Bash: Run shell command/)
  assert.ok(out.includes('<script>alert(1)</script>')) // present but not transformed
  assert.ok(out.endsWith('Reply "yes abcde" or "no abcde"'))
})
