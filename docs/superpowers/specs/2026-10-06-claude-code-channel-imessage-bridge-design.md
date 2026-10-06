# Claude Code ↔ iMessage Channel Bridge — Design

**Date:** 2026-10-06
**Status:** Approved design, pending implementation plan
**Author:** Kenneth Ng (with Claude)

## Summary

A developer tool that lets you talk to a running Claude Code session from a
messaging platform — ask questions, give instructions, get replies, and
**approve or deny Claude's permission prompts remotely** while you are away
from your keyboard. v1 targets **iMessage** via the Vercel Chat SDK's Photon
adapter. The tool is built as a **Claude Code channel** (an MCP server Claude
Code spawns over stdio) and is designed so other Chat SDK platforms
(Slack, WhatsApp, …) are future adapters rather than rewrites.

It ships as an open-source project a developer clones and runs on their own
machine with their own credentials. No central service is required for v1.

## Goals

- **A — Conversational bridge:** two-way chat between a messaging platform and
  a running local Claude Code session, operating against the developer's real
  local files.
- **B — Remote permission approval (primary goal):** when Claude needs approval
  to run a tool (Bash/Write/Edit), the prompt is relayed to the developer's
  phone and they can reply `yes`/`no` to unblock the session remotely.
- **C — (nice to have, not in v1 scope):** proactive notifications (task done,
  tests failed, blocked).
- **Self-hostable:** "clone, set a few env vars, run." No mandatory SaaS.
- **Evolvable:** a clean internal seam so the tool can later become a hosted,
  multi-tenant paid service (see "Evolvability" / Approach 2) without changing
  the channel core.

## Non-goals (v1)

- Platforms other than iMessage (the architecture anticipates them; the code
  does not ship them).
- Proactive notifications (goal C), task hand-off ("go fix CI").
- A hosted relay / multi-tenant service (Approach 2) — only the *seam* for it.
- A pairing-code bootstrap flow for the sender allowlist (explicit env config
  instead).
- Persisting state across session restarts (in-memory is sufficient; a channel
  only lives for the duration of a session).

## Background: how the two building blocks work

### Claude Code Channels (research preview)

A *channel* is an **MCP server that Claude Code spawns as a local subprocess and
talks to over stdio**, on the same machine as the session. It pushes events into
the session and can receive replies back:

- **Inbound:** the server emits `notifications/claude/channel` with
  `{ content, meta }`. Claude sees it as `<channel source="..." <meta-as-attrs>>…</channel>`.
- **Outbound (two-way):** the server exposes a standard MCP tool (e.g. `reply`)
  that Claude calls to send a message back out.
- **Permission relay:** if the server declares the
  `claude/channel/permission` capability, Claude Code forwards tool-approval
  prompts to it in parallel with the local terminal dialog.

Capabilities set in the MCP `Server` constructor:
`experimental: { 'claude/channel': {}, 'claude/channel/permission': {} }` plus
`tools: {}`, and an `instructions` string delivered to Claude as context.

**Permission relay protocol:**

1. Claude Code → server: `notifications/claude/channel/permission_request` with
   `{ request_id, tool_name, description, input_preview }`.
   - `request_id` is **five lowercase letters from `a`–`z` excluding `l`** (so it
     never reads as `1`/`I` on a phone). The local terminal dialog does **not**
     display this ID — the channel server is the only place it is visible.
   - `description` and `input_preview` are **untrusted** (may contain
     repo-influenced text). Claude Code sanitizes control/invisible chars, folds
     whitespace, truncates very long values, and masks recognizable credentials —
     but the server must still treat them as untrusted.
2. Server → platform: format and send the prompt, including the ID.
3. Human replies with a verdict carrying the ID.
4. Server → Claude Code: `notifications/claude/channel/permission` with
   `{ request_id, behavior: 'allow' | 'deny' }`. Claude Code applies it only if
   the ID matches an open request. The local dialog stays live the whole time;
   **whichever answer (terminal or remote) arrives first wins**, the other is
   dropped.

**Distribution caveat (research preview):** a custom channel is **not** on
Anthropic's approved allowlist, so it must be launched with
`claude --dangerously-load-development-channels server:<name>` (or the
`plugin:<name>@<marketplace>` form). This flag is **interactive-only** (ignored
under `-p` / the Agent SDK) and is still subject to the `channelsEnabled`
organization policy. This is the single biggest operational footgun and is
documented prominently in the README.

### Vercel Chat SDK + Photon iMessage adapter

The Chat SDK provides a unified `Chat` object that routes inbound platform
webhooks to typed handlers and sends outbound via a `thread` object
(`thread.post(...)`), with per-platform adapters handling signature verification
and payload quirks. Rich rendering (JSX cards, buttons) is supported per
platform.

The **Photon iMessage adapter** (`@photon-hq/vercel-chat-adapter-imessage`) no
longer supports on-device "local" mode. Current modes:

- **Cloud (Spectrum Cloud):** `IMESSAGE_PROJECT_ID` + `IMESSAGE_PROJECT_SECRET`
  from app.photon.codes. Inbound via **webhooks** or a gateway listener (poll).
- **Self-hosted gRPC:** your own endpoint; gateway listener only.

**v1 uses Photon Cloud with webhooks + ngrok.** Inbound iMessages flow
Photon Cloud → ngrok → local HTTP listener → (HMAC verify) → handler. Outbound
(replies, permission prompts) uses Photon's Cloud API via `thread.post()` and
needs no public URL.

## Approaches considered

- **Approach 1 — Single local process: the channel *is* the Chat SDK host.**
  One Node process, spawned by Claude Code over stdio, embeds the Chat SDK +
  Photon adapter. **Chosen.** Smallest thing that fully satisfies A + B for
  iMessage today, genuinely self-hostable, and keeps multi-channel as a clean
  extension point.
- **Approach 2 — Split: local channel shim + deployed Chat SDK app joined by a
  relay.** Stable public webhook URL, Chat SDK in its native serverless home,
  multi-tenant fan-out — the seed of a hosted paid product. **Deferred;** it is
  the migration target, not v1.
- **Approach 3 — Fork Anthropic's official iMessage channel, skip the Chat SDK.**
  Free/local but iMessage-only and does not generalize. **Rejected** — defeats
  the multi-channel purpose.

## Architecture (Approach 1)

A single Node process is the entire tool. Claude Code reads `.mcp.json`, spawns
it, and communicates over stdio. The process has two halves joined by one
interface, `ChannelBridge`, and they must never import each other's internals.

```
apps/channel/
  src/
    index.ts            # composition root: build transport, inject, start stdio
    channel/            # Claude Code contract ONLY — no Chat SDK / Photon imports
      server.ts         #   MCP Server, capabilities, reply tool, permission handler, routing
      permissions.ts    #   open-request tracking; "yes/no <id>" verdict parsing; TTL
    bridge/
      types.ts          # ChannelBridge interface + shared DTOs + reply grammar. The seam.
    transport/
      photon.ts         # Chat SDK + Photon adapter; IMPLEMENTS ChannelBridge
      dev.ts            # DevBridge: localhost HTTP+SSE test transport; IMPLEMENTS ChannelBridge
    config/
      env.ts            # load + validate env; fail fast with human-readable errors
```

**Runtime:** Node 24 (matches the repo `engines` requirement), pnpm workspace,
TypeScript. Placed as a new `apps/channel` workspace sharing the repo's
`typescript-config` and `eslint-config`. It is also publishable to npm for
others to install.

**Hard rule:** `channel/` never imports from `transport/`. They meet only
through `bridge/types.ts`. Swapping in a future `RelayBridge` (Approach 2)
touches nothing in `channel/`.

### The `ChannelBridge` seam

```ts
// bridge/types.ts
interface InboundMessage    { conversationId: string; senderId: string; text: string }
interface PermissionPrompt  { requestId: string; toolName: string; description: string; inputPreview: string }
interface PermissionVerdict { requestId: string; behavior: 'allow' | 'deny' }

interface BridgeHandlers {
  onMessage(msg: InboundMessage): void | Promise<void>
}

interface ChannelBridge {
  start(handlers: BridgeHandlers): Promise<void>   // transport begins delivering inbound
  stop(): Promise<void>
  sendMessage(conversationId: string, text: string): Promise<void>
  sendPermissionPrompt(conversationId: string, prompt: PermissionPrompt): Promise<void>
}

// Shared reply grammar so the channel's parser and the transport's rendered
// instruction never drift. Verdict IDs are 5 letters, excluding 'l'.
const VERDICT_ID_RE = /^[a-km-z]{5}$/
const VERDICT_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i
```

Note there is intentionally **no** `onPermissionReply` on the interface. Verdicts
arrive as ordinary inbound messages; the *channel* disambiguates them from chat.
This keeps the transport free of any permission-protocol knowledge, which is what
lets a future Slack/WhatsApp adapter be written without touching permission logic.

### Boundary decisions

- **Sender gating lives in the transport.** Only the transport has the raw
  platform `message.from.id`. The allowlist values come from config; the
  transport drops a non-allowlisted sender **before** calling `onMessage`. This
  stops prompt injection at the edge.
- **Verdict parsing lives in the channel** (`permissions.ts`). Request IDs are a
  Claude Code protocol concept; the channel tracks open requests and decides
  "verdict vs. chat."
- **Prompt rendering lives in the transport.** `sendPermissionPrompt` takes the
  *structured* `PermissionPrompt`; the transport decides how to present it (plain
  text + "reply yes/no" for iMessage; later, Approve/Deny buttons for Slack).

## Data flow

### Flow 1 — Inbound chat (phone → Claude)

```
Photon webhook → ngrok → local listener → (HMAC verify) → Chat SDK handler
  → [gate sender against allowlist; drop if not allowed]
  → onMessage(InboundMessage{ conversationId, senderId, text })
  → channel: does text match VERDICT_REPLY_RE for an OPEN request?
       yes → emit permission verdict (Flow 3, step 4); do NOT forward as chat
       no  → mcp.notification('notifications/claude/channel',
                { content: text, meta: { chat_id: conversationId, sender: senderId } })
  → Claude sees <channel source="imessage" chat_id="..." sender="..."> and acts
```

Every inbound message also updates `activeConversationId` (used by Flow 3).

### Flow 2 — Outbound reply (Claude → phone)

```
Claude calls reply tool { chat_id, text }
  → CallTool handler → bridge.sendMessage(chat_id, text)
  → transport resolves conversation from chat_id → thread.post(text)
  → on success returns "sent"; on failure (after retries) returns an ERROR result
    so Claude knows the human did not receive it
```

The transport resolves `conversationId → thread` via the SDK's address-by-id
where available, else an in-memory cache populated on inbound. In-memory is
sufficient because the channel only lives for the session and iMessage chat
GUIDs are stable.

### Flow 3 — Permission relay (primary goal)

```
1. Claude calls a gated tool (Bash/Write/Edit). Claude Code opens the LOCAL
   dialog AND sends notifications/claude/channel/permission_request
   { request_id, tool_name, description, input_preview } to our server.
2. channel/permissions.ts records request_id as OPEN
   { at: now, conversationId: activeConversationId } and calls
   bridge.sendPermissionPrompt(activeConversationId, prompt).
3. transport RENDERS the prompt and posts it, e.g.:
     "Claude wants to run Bash: <description>
      <input_preview>
      Reply "yes abcde" or "no abcde""
4. Human replies "yes abcde" → Flow 1 → onMessage → channel matches OPEN id →
   mcp.notification('notifications/claude/channel/permission',
     { request_id: 'abcde', behavior: 'allow' }) → request CLOSED, NOT forwarded.
5. Claude Code applies whichever answer (terminal or remote) arrived first.
```

**Active-conversation routing.** The `permission_request` notification carries no
conversation id, so the channel routes the prompt to the conversation of the
most recent inbound message (`activeConversationId`). This is correct for the
single-developer ("mainly me") use case. Limitation: if the developer is
chatting from two iMessage threads simultaneously, prompts go to the most recent
one. Accepted for v1.

## Configuration & security

Config lives in a gitignored `.env` loaded and validated by `config/env.ts`
(fail-fast, human-readable errors). `.mcp.json` holds only the spawn command —
no secrets. `.env.example` ships with blank placeholders.

**Environment variables (v1 — Photon Cloud + ngrok / webhook mode):**

| Var | Purpose |
| --- | --- |
| `IMESSAGE_PROJECT_ID` / `IMESSAGE_PROJECT_SECRET` | Photon Cloud creds (inbound auth + outbound sending) |
| `WEBHOOK_PORT` | local port the process listens on; ngrok targets this |
| `WEBHOOK_PUBLIC_URL` | the ngrok HTTPS URL, registered with Photon as the webhook target |
| `WEBHOOK_SIGNING_SECRET` | HMAC secret used to verify inbound webhooks are from Photon |
| `CHANNEL_ALLOWLIST` | comma-separated iMessage handles allowed to drive the session (e.g. `+15551234567,you@icloud.com`) |

**Security model (in priority order):**

1. **Sender allowlist, default-deny (primary defense).** The transport checks
   each inbound message's sender *handle* (`message.from.id`, never the chat/room
   id) against `CHANNEL_ALLOWLIST` before anything reaches `onMessage`. An
   ungated channel is a direct prompt-injection pipe into a session that can run
   Bash.
2. **The same gate is the permission-approval authority.** Anyone who can send
   through the channel can authorize `Bash`/`Write`/`Edit` in the session, so the
   allowlist must be tight (ideally just the developer's own handle). The
   permission capability is only declared because this gate exists.
3. **Untrusted content stays inert.** `description` / `input_preview` are rendered
   as plain, non-executable text and never interpolated into platform
   markup/commands.
4. **Webhook signature verification.** The Photon adapter verifies the HMAC on
   inbound webhooks using `WEBHOOK_SIGNING_SECRET`; unsigned/invalid posts are
   rejected.
5. **Secrets hygiene.** `.env` gitignored; the logger redacts known secret keys;
   nothing secret is logged.

**Allowlist bootstrap:** explicit via `CHANNEL_ALLOWLIST`. (No pairing flow in
v1 — Photon Cloud has no "self-chat bypass" and there is no local DB to detect
the user's own handle.)

**Operational caveat (README, prominent):** launch with
`claude --dangerously-load-development-channels server:imessage`. Interactive
only; subject to `channelsEnabled` org policy. A free ngrok URL changes on each
restart and must be re-registered with Photon; a reserved ngrok domain avoids
this.

## Error handling & lifecycle

- **Lifecycle:** the process lives and dies with the session (spawned on start,
  stdio closed on exit). On stdio-close / SIGTERM: stop the HTTP listener, close
  the Photon connection, exit 0. Startup failures (bad config, port in use, bad
  creds) **fail fast** — human-readable reason to stderr, non-zero exit — so
  `/mcp` shows `failed` rather than silently doing nothing.
- **stderr-only logging (hard protocol requirement):** stdout *is* the MCP stdio
  transport; any stray stdout write corrupts the protocol and breaks the channel.
  The logger writes exclusively to stderr (visible in Claude Code's `--debug`
  log) and redacts secrets.
- **Inbound webhook robustness:** bad/missing HMAC → `401` + drop; malformed
  payload → `400` + log; un-allowlisted sender → `200` but drop (don't leak
  allowlist membership via status). **Ack Photon fast (`200`) then process
  async** to avoid retry storms. **Dedup** inbound by message ID (in-memory set)
  so a webhook redelivery never double-injects.
- **Outbound truthfulness:** `mcp.notification()` resolves on write, not on
  Claude reading it — no delivery ack exists, so no logic waits for one. The
  `reply` tool retries `thread.post()` with short backoff and, if still failing,
  returns an **error** result to Claude rather than a false "sent."
- **Permission-relay edge cases:**
  - Terminal answered first → our later verdict references a closed request;
    Claude Code drops it silently. Expected.
  - **Verdict grammar but no matching open request → DROP; do NOT forward as
    chat.** Prevents a stray `yes abcde` from being injected into Claude as a
    prompt. Optionally reply "no pending approval for code `abcde`."
  - Request never answered → the local dialog stays open and the session blocks
    (inherent). The open-request record has a generous TTL so a late legit
    `yes <id>` still matches; after TTL the record is dropped and any later reply
    for it is dropped-not-forwarded.
  - Duplicate verdict → first closes the request; second matches no open request
    and is dropped.
  - Photon outbound down when sending a prompt → remote prompt never arrives, but
    the **local terminal dialog is the backstop**; the send failure is logged
    loudly to stderr.
- **Crashes:** uncaught exceptions / unhandled rejections are logged to stderr
  and the process exits non-zero (never a connected-but-deaf zombie).
- **Concurrency:** handled by JS's single-threaded event loop; the open-requests
  map and dedup set need no locking. Queued notifications are delivered together
  on Claude's next turn, which is fine for these event shapes.

## Testing strategy

Follows TDD (failing test first). The `ChannelBridge` seam makes the channel half
(goal B logic) testable with no Photon/Claude Code dependency.

1. **Unit — channel half against a `FakeBridge`** (records
   `sendMessage`/`sendPermissionPrompt`; drives `onMessage`; spies on
   `mcp.notification`):
   - `permissions.ts`: grammar parsing (`y`/`yes`/`n`/`no` + `[a-km-z]{5}`,
     case-insensitive, whitespace, autocorrect caps); open-request tracking; TTL
     expiry; the **drop-don't-forward** rule; duplicate verdict.
   - `server.ts` routing: inbound chat → `claude/channel` notification with
     correct `chat_id`/`sender` meta; verdict → `claude/channel/permission` and
     not forwarded; `reply` tool → `bridge.sendMessage`; `permission_request` →
     records open + `sendPermissionPrompt` to the active conversation;
     active-conversation updates on each inbound.
2. **Bridge contract test:** one reusable suite every `ChannelBridge`
   implementation must pass (start/stop, `sendMessage` delivers,
   `sendPermissionPrompt` delivers, inbound invokes `onMessage`). v1's Photon
   bridge and the future `RelayBridge` both run against it.
3. **Transport (Photon) unit tests with the network mocked:** HMAC accept/reject,
   Photon-event → `InboundMessage` mapping, sender gating, webhook dedup,
   `conversationId → thread` resolution.
4. **`DevBridge` harness (built in v1):** a localhost HTTP+SSE transport
   implementing `ChannelBridge` (mirrors Anthropic's `fakechat`). `curl` a
   message in, watch replies/prompts stream out — exercises the entire channel
   half end-to-end, including the full permission loop, with no Photon account,
   no ngrok, no phone. Triples as fast local QA, the contract-test fixture, and a
   reference adapter.
5. **Manual acceptance against real iMessage** (documented checklist, local, not
   CI): launch with the dev flag; text yourself → inbound arrives; Claude replies
   → lands in Messages; in manual mode ask Claude to run Bash → prompt arrives
   with its 5-letter code → `yes <code>` runs the tool and closes the terminal
   dialog; repeat the `no` path; confirm an un-allowlisted sender is dropped.

**CI** runs 1–4 (no external deps); 5 is the pre-release manual gate.

## Evolvability → Approach 2 (future paid service)

The seam is the whole story. To become a hosted multi-tenant service:

- Keep the **channel half byte-for-byte identical** on the developer's machine.
- Swap the transport half for a `RelayBridge` that forwards the same four
  `ChannelBridge` methods over a WebSocket to a deployed Chat SDK app.
- The cloud app runs the Chat SDK against stable webhook URLs and multiplexes to
  many developers' laptops; accounts, billing, and fan-out are additive and live
  entirely in the cloud app.

Two cheap things done in v1 keep this door open without building any of it now:
the explicit `ChannelBridge` module boundary, and carrying a stable
conversation/session identifier (`chat_id` meta) through inbound→channel and
reply→outbound so a future multi-tenant relay can route correctly. The in-memory
dedup set is the natural slot for the Chat SDK's Redis state adapter later.

## Open questions / risks

- **Photon Cloud cost & limits** for the account used — to confirm during setup
  (out of scope for the design, but a prerequisite to running v1).
- **Photon adapter API specifics** (exact handler names, `thread` address-by-id
  support, webhook payload shape) must be confirmed against the adapter's current
  version at implementation time; the design depends only on the generic Chat SDK
  shape, not a specific symbol.
- **Research-preview protocol drift:** the `--channels` flag syntax and channel
  contract may change during the preview; pin tested Claude Code versions in the
  README.
