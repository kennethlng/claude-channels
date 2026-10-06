import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig, ConfigError, secretsOf } from './env.ts'

const base = {
  IMESSAGE_PROJECT_ID: 'pid',
  IMESSAGE_PROJECT_SECRET: 'psecret',
  WEBHOOK_PORT: '8787',
  WEBHOOK_PUBLIC_URL: 'https://x.ngrok.app',
  WEBHOOK_SIGNING_SECRET: 'hmac',
  CHANNEL_ALLOWLIST: '+15551234567, you@icloud.com',
}

test('loads and normalizes a valid photon config', () => {
  const c = loadConfig(base)
  assert.equal(c.transport, 'photon')
  assert.equal(c.webhookPort, 8787)
  assert.deepEqual(c.allowlist, ['+15551234567', 'you@icloud.com'])
  assert.equal(c.permissionTtlMs, 15 * 60 * 1000)
})

test('throws ConfigError naming the first missing required var', () => {
  const { IMESSAGE_PROJECT_SECRET, ...partial } = base
  assert.throws(() => loadConfig(partial), (e: unknown) => e instanceof ConfigError && /IMESSAGE_PROJECT_SECRET/.test((e as Error).message))
})

test('throws on a non-numeric port', () => {
  assert.throws(() => loadConfig({ ...base, WEBHOOK_PORT: 'abc' }), ConfigError)
})

test('dev transport does not require photon/webhook vars', () => {
  const c = loadConfig({ CHANNEL_TRANSPORT: 'dev', WEBHOOK_PORT: '8787', CHANNEL_ALLOWLIST: 'me' })
  assert.equal(c.transport, 'dev')
  assert.deepEqual(c.allowlist, ['me'])
})

test('secretsOf returns values that must never be logged', () => {
  const s = secretsOf(loadConfig(base))
  assert.ok(s.includes('psecret'))
  assert.ok(s.includes('hmac'))
})
