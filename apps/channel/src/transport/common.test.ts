import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { isAllowed, Deduper, verifyHmac, renderPrompt } from './common.ts'

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
