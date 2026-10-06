import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'
import { ChannelCore, type Notifier } from './core.ts'
import type { PermissionStore } from './permissions.ts'
import type { Logger } from './logger.ts'
import type { ChannelBridge } from '../bridge/types.ts'

const INSTRUCTIONS =
  'Messages arrive as <channel source="imessage" chat_id="..." sender="...">. ' +
  'To reply, call the reply tool and pass the chat_id from the inbound tag. ' +
  'Permission prompts are handled out of band; do not mention request IDs to the user.'

const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})

export interface ChannelServerDeps {
  bridge: ChannelBridge
  store: PermissionStore
  logger: Logger
}

export function createChannelServer(deps: ChannelServerDeps): {
  server: Server
  core: ChannelCore
  connect(transport: Transport): Promise<void>
} {
  const server = new Server(
    { name: 'imessage', version: '0.1.0' },
    {
      capabilities: {
        experimental: { 'claude/channel': {}, 'claude/channel/permission': {} },
        tools: {},
      },
      instructions: INSTRUCTIONS,
    },
  )

  const notifier: Notifier = {
    async channelEvent(content, meta) {
      await server.notification({ method: 'notifications/claude/channel', params: { content, meta } })
    },
    async permissionVerdict(request_id, behavior) {
      await server.notification({ method: 'notifications/claude/channel/permission', params: { request_id, behavior } })
    },
  }

  const core = new ChannelCore({ bridge: deps.bridge, notifier, store: deps.store, logger: deps.logger })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'reply',
        description: 'Send a message back over the iMessage channel',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'The conversation to reply in (from the inbound tag)' },
            text: { type: 'string', description: 'The message to send' },
          },
          required: ['chat_id', 'text'],
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== 'reply') throw new Error(`unknown tool: ${req.params.name}`)
    const { chat_id, text } = req.params.arguments as { chat_id: string; text: string }
    const result = await core.handleReply({ chat_id, text })
    if (result.ok) return { content: [{ type: 'text', text: 'sent' }] }
    return { content: [{ type: 'text', text: `send failed: ${result.error}` }], isError: true }
  })

  server.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
    await core.handlePermissionRequest({
      requestId: params.request_id,
      toolName: params.tool_name,
      description: params.description,
      inputPreview: params.input_preview,
    })
  })

  return { server, core, connect: (transport) => server.connect(transport) }
}
