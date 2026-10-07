import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig, secretsOf, ConfigError } from './env.ts'
import { createLogger } from '@repo/core/logger'
import { PermissionStore } from '@repo/core/permissions'
import { createChannelServer } from '@repo/core/server'
import { createPhotonBridge } from '@repo/integrations/photon'
import { createDevBridge } from '@repo/integrations/dev'
import type { ChannelBridge } from '@repo/contract'

// When installed (via npx/a plugin), Claude Code spawns this with its own
// environment, not the shell where you set your vars. Load config from a
// well-known per-user file first; real process.env still wins over it.
function loadEnvFile(): void {
  // First existing wins: explicit override, then a .env in the working directory
  // (clone-and-run / `cp .env.example .env`), then the per-user install location.
  const candidates = [
    process.env.CHANNEL_ENV_FILE,
    join(process.cwd(), '.env'),
    join(homedir(), '.claude', 'channels', 'photon', '.env'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      process.loadEnvFile(path)
    } catch (err) {
      process.stderr.write(`failed to load env file ${path}: ${String(err)}\n`)
    }
    return
  }
}

async function main(): Promise<void> {
  loadEnvFile()
  let config
  try {
    config = loadConfig()
  } catch (err) {
    process.stderr.write((err instanceof ConfigError ? err.message : String(err)) + '\n')
    process.exit(1)
  }

  const logger = createLogger(secretsOf(config))
  const store = new PermissionStore(config.permissionTtlMs, () => Date.now())
  const bridge: ChannelBridge =
    config.integration === 'dev'
      ? createDevBridge({ port: config.webhookPort, allowlist: config.allowlist, logger })
      : createPhotonBridge(config, logger)

  const { core, connect } = createChannelServer({ name: config.integration, bridge, store, logger })
  await bridge.start({ onMessage: (m) => core.handleInbound(m) })
  await connect(new StdioServerTransport())
  logger.info('channel connected', { transport: config.integration })

  const shutdown = async () => {
    logger.info('shutting down')
    await bridge.stop().catch(() => {})
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  process.stdin.on('close', shutdown) // Claude Code closed stdio
}

process.on('uncaughtException', (err) => {
  process.stderr.write(`uncaughtException: ${err?.stack ?? err}\n`)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`unhandledRejection: ${String(reason)}\n`)
  process.exit(1)
})

void main()
