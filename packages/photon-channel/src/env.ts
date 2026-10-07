import type { Config } from '@repo/contract'

export class ConfigError extends Error {}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]
  if (!v || v.trim() === '') throw new ConfigError(`Missing required env var ${key}`)
  return v.trim()
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const integration = (env.CHANNEL_INTEGRATION ?? 'photon').trim() === 'dev' ? 'dev' : 'photon'

  const portRaw = required(env, 'WEBHOOK_PORT')
  const webhookPort = Number(portRaw)
  if (!Number.isInteger(webhookPort) || webhookPort <= 0) {
    throw new ConfigError(`WEBHOOK_PORT must be a positive integer, got "${portRaw}"`)
  }

  const allowlist = (env.CHANNEL_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const ttlMin = Number(env.PERMISSION_TTL_MINUTES ?? '15')
  if (!Number.isFinite(ttlMin) || ttlMin <= 0) {
    throw new ConfigError(`PERMISSION_TTL_MINUTES must be a positive number, got "${env.PERMISSION_TTL_MINUTES}"`)
  }

  if (integration === 'dev') {
    return {
      integration, webhookPort, allowlist, permissionTtlMs: ttlMin * 60_000,
      spectrumProjectId: '', spectrumProjectSecret: '', webhookPublicUrl: '', spectrumWebhookSecret: '',
    }
  }

  return {
    integration,
    spectrumProjectId: required(env, 'SPECTRUM_PROJECT_ID'),
    spectrumProjectSecret: required(env, 'SPECTRUM_PROJECT_SECRET'),
    webhookPort,
    webhookPublicUrl: required(env, 'WEBHOOK_PUBLIC_URL'),
    spectrumWebhookSecret: required(env, 'SPECTRUM_WEBHOOK_SECRET'),
    allowlist,
    permissionTtlMs: ttlMin * 60_000,
  }
}

export function secretsOf(config: Config): string[] {
  return [config.spectrumProjectSecret, config.spectrumWebhookSecret].filter((s) => s.length > 0)
}
