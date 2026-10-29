import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig, ConfigError, secretsOf } from './env.ts'

const base = {
  SPECTRUM_PROJECT_ID: 'pid',
  SPECTRUM_PROJECT_SECRET: 'psecret',
  WEBHOOK_PORT: '8787',
  WEBHOOK_PUBLIC_URL: 'https://x.ngrok.app',
  SPECTRUM_WEBHOOK_SECRET: 'hmac',
  CHANNEL_ALLOWLIST: '+15551234567, you@icloud.com',
}

test('loads and normalizes a valid photon config', () => {
  const c = loadConfig(base)
  assert.equal(c.integration, 'photon')
  assert.equal(c.webhookPort, 8787)
  assert.deepEqual(c.allowlist, ['+15551234567', 'you@icloud.com'])
  assert.equal(c.permissionTtlMs, 15 * 60 * 1000)
})

test('throws ConfigError naming the first missing required var', () => {
  const { SPECTRUM_PROJECT_SECRET, ...partial } = base
  assert.throws(() => loadConfig(partial), (e: unknown) => e instanceof ConfigError && /SPECTRUM_PROJECT_SECRET/.test((e as Error).message))
})

const devBase = { CHANNEL_INTEGRATION: 'dev', WEBHOOK_PORT: '8787', CHANNEL_ALLOWLIST: 'me' }

const portConfigs = [
  ['photon', base],
  ['dev', devBase],
] as const

for (const [mode, env] of portConfigs) {
  test(`${mode}: accepts the lowest and highest valid WEBHOOK_PORT`, () => {
    assert.equal(loadConfig({ ...env, WEBHOOK_PORT: '1' }).webhookPort, 1)
    assert.equal(loadConfig({ ...env, WEBHOOK_PORT: '65535' }).webhookPort, 65535)
  })

  test(`${mode}: rejects invalid WEBHOOK_PORT values with a clear ConfigError`, () => {
    const invalid = ['0', '65536', '-1', '1.5', '8787.0', 'abc', '80abc', '1e3', '0x10', '+80', '99999999999999999999']
    for (const WEBHOOK_PORT of invalid) {
      assert.throws(
        () => loadConfig({ ...env, WEBHOOK_PORT }),
        (e: unknown) =>
          e instanceof ConfigError &&
          e.message === `WEBHOOK_PORT must be an integer from 1 to 65535, got "${WEBHOOK_PORT}"`,
        `expected ${WEBHOOK_PORT} to be rejected`,
      )
    }
  })

  test(`${mode}: still reports a missing WEBHOOK_PORT`, () => {
    const { WEBHOOK_PORT, ...rest } = env
    assert.throws(() => loadConfig(rest), (e: unknown) => e instanceof ConfigError && /WEBHOOK_PORT/.test((e as Error).message))
  })
}

test('dev transport does not require photon/webhook vars', () => {
  const c = loadConfig({ CHANNEL_INTEGRATION: 'dev', WEBHOOK_PORT: '8787', CHANNEL_ALLOWLIST: 'me' })
  assert.equal(c.integration, 'dev')
  assert.deepEqual(c.allowlist, ['me'])
})

test('secretsOf returns values that must never be logged', () => {
  const s = secretsOf(loadConfig(base))
  assert.ok(s.includes('psecret'))
  assert.ok(s.includes('hmac'))
})
