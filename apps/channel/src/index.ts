import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig, secretsOf, ConfigError } from './config/env.ts'
import { createLogger } from './channel/logger.ts'
import { PermissionStore } from './channel/permissions.ts'
import { createChannelServer } from './channel/server.ts'
import { createPhotonBridge } from './transport/photon.ts'
import { createDevBridge } from './transport/dev.ts'
import type { ChannelBridge } from './bridge/types.ts'

async function main(): Promise<void> {
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
    config.transport === 'dev'
      ? createDevBridge({ port: config.webhookPort, allowlist: config.allowlist, logger })
      : createPhotonBridge(config, logger)

  const { core, connect } = createChannelServer({ bridge, store, logger })
  await bridge.start({ onMessage: (m) => core.handleInbound(m) })
  await connect(new StdioServerTransport())
  logger.info('channel connected', { transport: config.transport })

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
