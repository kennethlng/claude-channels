export class ConfigError extends Error {}

export interface Config {
  transport: 'photon' | 'dev'
  imessageProjectId: string
  imessageProjectSecret: string
  webhookPort: number
  webhookPublicUrl: string
  webhookSigningSecret: string
  allowlist: string[]
  permissionTtlMs: number
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]
  if (!v || v.trim() === '') throw new ConfigError(`Missing required env var ${key}`)
  return v.trim()
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const transport = (env.CHANNEL_TRANSPORT ?? 'photon').trim() === 'dev' ? 'dev' : 'photon'

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

  if (transport === 'dev') {
    return {
      transport, webhookPort, allowlist, permissionTtlMs: ttlMin * 60_000,
      imessageProjectId: '', imessageProjectSecret: '', webhookPublicUrl: '', webhookSigningSecret: '',
    }
  }

  return {
    transport,
    imessageProjectId: required(env, 'IMESSAGE_PROJECT_ID'),
    imessageProjectSecret: required(env, 'IMESSAGE_PROJECT_SECRET'),
    webhookPort,
    webhookPublicUrl: required(env, 'WEBHOOK_PUBLIC_URL'),
    webhookSigningSecret: required(env, 'WEBHOOK_SIGNING_SECRET'),
    allowlist,
    permissionTtlMs: ttlMin * 60_000,
  }
}

export function secretsOf(config: Config): string[] {
  return [config.imessageProjectSecret, config.webhookSigningSecret].filter((s) => s.length > 0)
}
