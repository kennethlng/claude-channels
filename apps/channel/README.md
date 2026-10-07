# `channel` — iMessage bridge for Claude Code

## 1. What it is

`channel` is a Claude Code "channel" — an MCP server that runs over stdio alongside
a Claude Code session and bridges it to iMessage via Photon Cloud (`chat` / Spectrum
Cloud) and the Vercel Chat SDK. It lets you text your running Claude Code session
from iMessage and, more importantly, lets you **approve or deny permission prompts
from your phone**: when the session wants to run a Bash command or other gated tool,
a prompt with a 5-letter code is relayed to iMessage, and replying `yes <code>` or
`no <code>` answers it — whichever of the terminal or your phone answers first wins.

## 2. Status / known limitations

The **local, no-phone path** (`CHANNEL_INTEGRATION=dev`, the `DevBridge` described
in §9) is tested end-to-end: the automated test suite (41/41 passing) covers it,
and it has also been manually smoke-tested with `curl` against the dev
integration as shown in §9.

The **real Photon Cloud + iMessage + phone path** (`CHANNEL_INTEGRATION=photon`)
has **not yet been manually verified end-to-end** by a human running a live
`claude` CLI session against a real Photon Cloud account and a real phone.
That verification is still outstanding — treat the real-iMessage path as
implemented and unit/integration-tested, but not yet proven in live use,
until someone runs it for real and this note is updated.

## 3. Prerequisites

- Node.js **>= 24**.
- A [Photon Cloud](https://app.photon.codes) project (gives you an iMessage-connected
  phone number/account plus a project id/secret for the Chat SDK).
- [ngrok](https://ngrok.com) (or another tunnel) to expose your local webhook
  listener to Photon's cloud over HTTPS.
- Claude Code itself, authenticated either with your claude.ai account or a Console
  API key.

## 4. Setup

```bash
pnpm install
cp apps/channel/.env.example .env
```

The channel loads its config from the first of these that exists: `$CHANNEL_ENV_FILE`,
a `.env` in the directory you launch from, then `~/.claude/channels/photon/.env`.
For clone-and-run, keep `.env` at the repo root and launch from there. Fill it in:

| Variable | Meaning |
| --- | --- |
| `SPECTRUM_PROJECT_ID` | Your Photon / Spectrum Cloud project id (`app.photon.codes`). |
| `SPECTRUM_PROJECT_SECRET` | Your Photon / Spectrum Cloud project secret. |
| `WEBHOOK_PORT` | Local port the webhook listener binds to (default `8787`). |
| `WEBHOOK_PUBLIC_URL` | The public HTTPS URL Photon will POST webhooks to — this is your ngrok URL. |
| `SPECTRUM_WEBHOOK_SECRET` | HMAC secret used to verify inbound webhooks really came from Photon. |
| `CHANNEL_ALLOWLIST` | Comma-separated iMessage handles (phone numbers/emails) allowed to drive the session or approve permissions. Everyone else is silently ignored. |
| `PERMISSION_TTL_MINUTES` | How long a relayed permission prompt stays answerable from iMessage (default `15`). |
| `CHANNEL_INTEGRATION` | `photon` for real iMessage, or `dev` for the local curl/SSE test integration (see §9). |

Then:

1. Start the tunnel: `ngrok http $WEBHOOK_PORT` (use the same port as `WEBHOOK_PORT`).
2. Copy the `https://...ngrok...` forwarding URL ngrok prints.
3. In the Photon dashboard, register that HTTPS URL as your project's webhook
   target, and register/confirm the `SPECTRUM_WEBHOOK_SECRET` there too so Photon
   signs its webhook deliveries with the same secret you put in `.env`.
4. Set `WEBHOOK_PUBLIC_URL` in `.env` to that same ngrok URL.

## 5. Register the channel

Copy `example.mcp.json` to a `.mcp.json` in your project root (or merge it into
`~/.claude.json` for a user-level channel), and replace the placeholder path with
the **absolute** path to this package's `src/index.ts`:

```json
{
  "mcpServers": {
    "claude-channels": { "command": "node", "args": ["/absolute/path/to/apps/channel/src/index.ts"] }
  }
}
```

Claude Code spawns this file directly with `node` — there is no build step, so the
path must point at the TypeScript source, not a compiled artifact.

## 6. Run

```bash
claude --dangerously-load-development-channels server:claude-channels
```

The channel name (`server:claude-channels`, matching the `"claude-channels"` key in
`.mcp.json` above) is a direct argument to the flag — there is no separate
step to select or invoke it from within the session. The channel registers
as soon as the process starts with that argument. (If you registered the
channel via a plugin instead, use the `plugin:<name>@<marketplace>` form.)

**Important caveats:**

- Custom channels are not yet on Anthropic's allowlist during this research
  preview, so `--dangerously-load-development-channels` is **required** to load
  this (or any) custom channel at all. Without it, Claude Code will not load
  `.mcp.json` entries that define channels.
- This flag only works in the **interactive** CLI. It is silently ignored when
  running Claude Code non-interactively (e.g. under `-p`/`--print`).
- On Team/Enterprise plans, loading custom channels is additionally gated by the
  organization's `channelsEnabled` policy — if your org has it disabled, the flag
  will not help.

## 7. Permission approvals

When the session needs to run a gated tool (e.g. Bash) and you're in manual
permission mode, a prompt is relayed to iMessage containing a human-readable
description of the tool call, the raw command/input, and a 5-letter code, e.g.:

```
Claude wants to run Bash: Run shell command
rm -rf build/

Reply "yes abcde" or "no abcde"
```

Reply from iMessage with `yes <code>` to allow it, or `no <code>` to deny it.
Only replies from a sender in `CHANNEL_ALLOWLIST` are honored. The terminal's own
confirmation dialog and the iMessage prompt race each other — whichever one you
answer first (phone or keyboard) wins, and the other is closed out automatically.

## 8. Troubleshooting

- **A free ngrok URL changes every time you restart ngrok.** Each time that
  happens you must re-register the new URL with Photon and update
  `WEBHOOK_PUBLIC_URL`. Use an ngrok reserved/custom domain (paid) if you want a
  stable URL across restarts.
- **`/mcp` shows the channel as `failed`.** This usually means `loadConfig()`
  threw (a required env var is missing/malformed) or the process crashed on
  startup. Check the channel's stderr output, or re-run Claude Code with
  `claude --debug` for more detail. Nothing from this process is ever written to
  stdout — stdout is reserved for the MCP protocol itself — so all diagnostics
  land on stderr.
- **`/mcp` shows the channel as broken in a way that doesn't match the above.**
  Our own code never writes to stdout, but the third-party `chat` / Photon
  integration libraries run in the same process, whose stdout is reserved for the
  MCP transport. An unexpected stdout write from one of those dependencies is
  a rare but possible cause if the failure mode doesn't look like a
  `loadConfig()`/startup crash.
- **Messages or `yes`/`no` replies seem to be ignored.** Only senders listed in
  `CHANNEL_ALLOWLIST` can send chat messages into the session or answer permission
  prompts. Double check the handle format matches exactly what Photon reports as
  the sender id (typically E.164 phone number or email).

## 9. Local testing without a phone

You don't need Photon, ngrok, or a phone to exercise most of this bridge. Set:

```
CHANNEL_INTEGRATION=dev
CHANNEL_ALLOWLIST=me
WEBHOOK_PORT=8787
```

then run the channel
(`claude --dangerously-load-development-channels server:claude-channels`, or just
`node src/index.ts` directly to test the integration in isolation). The
`DevBridge` listens on `http://127.0.0.1:$WEBHOOK_PORT` instead of talking to
Photon.

In a second terminal, watch the outbound stream (replies and permission prompts):

```bash
curl -N http://127.0.0.1:8787/events
```

In a third terminal, send an inbound chat message as an allowlisted sender:

```bash
curl -XPOST http://127.0.0.1:8787/ -d '{"conversationId":"c1","senderId":"me","text":"hi"}'
```

That message is delivered to the running session as a `<channel>` event, exactly
as a real iMessage would be. Any `senderId` not in `CHANNEL_ALLOWLIST` is accepted
by the HTTP endpoint (it still returns `200`) but is silently dropped before it
reaches the session — nothing is relayed and nothing is logged as processed chat.
