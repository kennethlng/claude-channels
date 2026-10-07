import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { createLogger } from './logger.ts'

function capture() {
  const lines: string[] = []
  const stream = new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb() } })
  return { stream, lines }
}

test('writes a JSON line with level and message to the given stream', () => {
  const { stream, lines } = capture()
  createLogger([], stream).info('hello', { n: 1 })
  assert.equal(lines.length, 1)
  const parsed = JSON.parse(lines[0]!)
  assert.equal(parsed.level, 'info')
  assert.equal(parsed.msg, 'hello')
  assert.equal(parsed.n, 1)
})

test('redacts configured secret values anywhere in the line', () => {
  const { stream, lines } = capture()
  createLogger(['supersecret', ''], stream).error('token=supersecret failed')
  assert.ok(!lines[0]!.includes('supersecret'))
  assert.ok(lines[0]!.includes('[REDACTED]'))
})
