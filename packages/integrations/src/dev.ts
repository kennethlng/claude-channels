import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { BridgeHandlers, ChannelBridge, PermissionPrompt, Logger } from '@repo/contract'
import { isAllowed, readBody, renderPrompt } from './common.ts'

// The DevBridge is localhost-only, but keep the same bounded, UTF-8-safe read.
const MAX_DEV_BODY_BYTES = 1_000_000

export interface DevBridgeOptions {
  port: number
  allowlist: string[]
  logger: Logger
}

export function createDevBridge(opts: DevBridgeOptions): ChannelBridge & { address(): string } {
  let handlers: BridgeHandlers | undefined
  const subscribers = new Set<ServerResponse>()
  let server: Server | undefined

  const broadcast = (payload: Record<string, unknown>) => {
    const line = `data: ${JSON.stringify(payload)}\n\n`
    for (const res of subscribers) res.write(line)
  }

  return {
    address() {
      const addr = server?.address() as AddressInfo
      return `http://127.0.0.1:${addr.port}`
    },
    async start(h: BridgeHandlers) {
      handlers = h
      server = createServer((req, res) => {
        void (async () => {
          if (req.method === 'GET' && req.url === '/events') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            })
            res.write(': connected\n\n')
            subscribers.add(res)
            req.on('close', () => subscribers.delete(res))
            return
          }
          if (req.method === 'POST') {
            const raw = (await readBody(req, MAX_DEV_BODY_BYTES)).toString('utf8')
            let msg: { conversationId: string; senderId: string; text: string }
            try {
              msg = JSON.parse(raw)
            } catch {
              res.writeHead(400).end('bad json')
              return
            }
            if (!isAllowed(opts.allowlist, msg.senderId)) {
              res.writeHead(200).end('ok')
              return
            }
            res.writeHead(200).end('ok')
            try {
              await handlers!.onMessage(msg)
            } catch (err) {
              opts.logger.error('onMessage handler threw', { error: String(err) })
            }
            return
          }
          res.writeHead(404).end()
        })().catch((err: unknown) => {
          opts.logger.error('DevBridge request handler failed', { error: String(err) })
          if (!res.writableEnded) res.writeHead(500).end()
        })
      })
      await new Promise<void>((resolve) => {
        server!.listen(opts.port, '127.0.0.1', resolve)
      })
      opts.logger.info('DevBridge listening', { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
    },
    async stop() {
      for (const res of subscribers) res.end()
      subscribers.clear()
      await new Promise<void>((resolve) => {
        if (server) server.close(() => resolve())
        else resolve()
      })
    },
    async sendMessage(conversationId: string, text: string) {
      broadcast({ type: 'message', conversationId, text })
    },
    async sendPermissionPrompt(conversationId: string, prompt: PermissionPrompt) {
      broadcast({ type: 'prompt', conversationId, text: renderPrompt(prompt) })
    },
  }
}
