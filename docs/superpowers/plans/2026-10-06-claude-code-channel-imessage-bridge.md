# Claude Code ↔ iMessage Channel Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code channel (MCP-over-stdio) that bridges a running session to iMessage via the Vercel Chat SDK Photon adapter, so a developer can chat with the session and approve/deny its permission prompts from their phone.

**Architecture:** A single Node process that Claude Code spawns over stdio. It has two halves joined by one interface, `ChannelBridge`: the **channel half** (`src/channel/*`) speaks the Claude Code protocol and knows nothing about messaging platforms; the **transport half** (`src/transport/*`) implements `ChannelBridge` using the Chat SDK + Photon adapter. The seam keeps a future hosted multi-tenant service a drop-in swap.

**Tech Stack:** Node 24 (runs TypeScript directly via type-stripping — no build step), TypeScript 7 (`@repo/typescript-config`), `@modelcontextprotocol/sdk`, `zod`, Vercel Chat SDK + `@photon-hq/vercel-chat-adapter-imessage`, Node's built-in test runner (`node --test`). pnpm workspace at `apps/channel`.

**Spec:** `docs/superpowers/specs/2026-10-06-claude-code-channel-imessage-bridge-design.md` (read it alongside this plan).

## Global Constraints

- **Runtime:** Node `>=24` (repo `engines`). The process must run via `node src/index.ts` with no build step (Node 24 strips TS types at runtime). No `tsx`, `ts-node`, or bundler.
- **Module system:** `"type": "module"`, `module`/`moduleResolution` = `NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true` (inherited from `@repo/typescript-config/base.json`). Relative imports use explicit `.ts` extensions; tsconfig sets `allowImportingTsExtensions: true` and `noEmit: true`.
- **stdout is the MCP transport.** Nothing may ever write to `process.stdout` except the MCP SDK. All logging goes to `process.stderr`.
- **Secrets never logged in the clear.** The logger redacts configured secret values. `.env` is gitignored (already covered by root `.gitignore`).
- **Sender gating is default-deny** and happens in the transport before any message reaches the channel half.
- **Verdict request IDs** are exactly five lowercase letters from `a`–`z` excluding `l` (`/[a-km-z]{5}/`). Parser is case-insensitive (phone autocorrect) and lowercases before use.
- **`description` and `input_preview`** from permission requests are untrusted; render them as inert plain text only.
- **Test command:** `pnpm --filter channel test` → `node --test`. **Type check:** `pnpm --filter channel check-types` → `tsc --noEmit`.
- Package name for the workspace is `channel` (bare, matching `web`/`docs`).

## Review Focus

- **Non-allowlisted sender sends a verdict-shaped message (`yes abcde`):** must be dropped at the transport edge before verdict parsing ever runs — an attacker must not be able to approve tool use. (Owned by the Task 8 DevBridge gating test, which drives the real inbound path with verdict-shaped text from a non-allowlisted sender; Task 2's `isAllowed` test covers the helper the Photon transport reuses for the same gate.)
- **`reply` called with an unknown/never-seen `chat_id`:** `sendMessage` must fail gracefully and the tool must return an *error* result, not crash the process or falsely report "sent." (Owned by Task 6 core error-path test and Task 7 tool-result test.)
- **`permission_request` arrives before any inbound message (no active conversation):** must not crash; open the request, skip the remote send, and log — the local terminal dialog is the backstop. (Owned by Task 6 core test.)
- **Hostile/multiline `input_preview`** (angle brackets, newlines, long text): must render as inert plain text without throwing or being interpreted as markup. (Owned by Task 2 `renderPrompt` test.)
- **Duplicate webhook delivery** (same provider message id twice): must be deduped so Claude's session is not double-fed. (Owned by the Task 2 `Deduper` test; the Photon webhook handler in Task 9 calls `dedup.check(messageId)` before forwarding, reusing that tested helper.)

---

## Task 1: Scaffold `apps/channel` + the `ChannelBridge` seam

**Files:**
- Create: `apps/channel/package.json`
- Create: `apps/channel/tsconfig.json`
- Create: `apps/channel/.env.example`
- Create: `apps/channel/src/bridge/types.ts`
- Test: `apps/channel/src/bridge/types.test.ts`

**Interfaces:**
- Produces: `ChannelBridge`, `BridgeHandlers`, `InboundMessage`, `PermissionPrompt`, `PermissionVerdict`, `VERDICT_REPLY_RE`, `parseVerdictReply(text): PermissionVerdict | null`, `formatVerdictInstruction(requestId): string`.

- [ ] **Step 1: Create the workspace package.json**

```json
{
  "name": "channel",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "bin": { "claude-imessage-channel": "./src/index.ts" },
  "scripts": {
    "dev": "node src/index.ts",
    "start": "node src/index.ts",
    "test": "node --test",
    "lint": "eslint --max-warnings 0",
    "check-types": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/node": "26.4.1",
    "eslint": "10.9.1",
    "typescript": "7.0.2"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["node"],
    "lib": ["es2023"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create .env.example**

```bash
# Photon Cloud credentials (from https://app.photon.codes)
IMESSAGE_PROJECT_ID=
IMESSAGE_PROJECT_SECRET=

# Local HTTP listener port; ngrok forwards your public URL to this port
WEBHOOK_PORT=8787
# Your ngrok HTTPS URL, registered with Photon as the webhook target
WEBHOOK_PUBLIC_URL=
# HMAC secret used to verify inbound webhooks really came from Photon
WEBHOOK_SIGNING_SECRET=

# Comma-separated iMessage handles allowed to drive the session
# e.g. +15551234567,you@icloud.com
CHANNEL_ALLOWLIST=

# Minutes a relayed permission prompt stays answerable (default 15)
PERMISSION_TTL_MINUTES=15

# Set to "dev" to use the local DevBridge (curl/SSE) instead of Photon
CHANNEL_TRANSPORT=photon
```

- [ ] **Step 4: Install dependencies**

Run from repo root: `pnpm install`
Expected: `channel` workspace linked; `@modelcontextprotocol/sdk` and `zod` installed.

- [ ] **Step 5: Write the failing test for the grammar**

Create `apps/channel/src/bridge/types.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVerdictReply, formatVerdictInstruction } from './types.ts'

test('parses an allow verdict with surrounding whitespace and caps', () => {
  assert.deepEqual(parseVerdictReply('  Yes ABCDE '), { requestId: 'abcde', behavior: 'allow' })
})

test('parses short forms y/n', () => {
  assert.deepEqual(parseVerdictReply('y abcde'), { requestId: 'abcde', behavior: 'allow' })
  assert.deepEqual(parseVerdictReply('n abcde'), { requestId: 'abcde', behavior: 'deny' })
})

test('rejects ids containing the letter l and non-verdict text', () => {
  assert.equal(parseVerdictReply('yes ablde'), null)
  assert.equal(parseVerdictReply('please run the build'), null)
  assert.equal(parseVerdictReply('yes'), null)
})

test('formats the reply instruction with the id verbatim', () => {
  assert.equal(formatVerdictInstruction('abcde'), 'Reply "yes abcde" or "no abcde"')
})
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `pnpm --filter channel test`
Expected: FAIL — `Cannot find module './types.ts'`.

- [ ] **Step 7: Implement `src/bridge/types.ts`**

```ts
export interface InboundMessage {
  conversationId: string
  senderId: string
  text: string
}

export interface PermissionPrompt {
  requestId: string
  toolName: string
  description: string
  inputPreview: string
}

export interface PermissionVerdict {
  requestId: string
  behavior: 'allow' | 'deny'
}

export interface BridgeHandlers {
  onMessage(msg: InboundMessage): void | Promise<void>
}

export interface ChannelBridge {
  start(handlers: BridgeHandlers): Promise<void>
  stop(): Promise<void>
  sendMessage(conversationId: string, text: string): Promise<void>
  sendPermissionPrompt(conversationId: string, prompt: PermissionPrompt): Promise<void>
}

// Five letters, excluding 'l'. Case-insensitive to tolerate phone autocorrect.
export const VERDICT_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

export function parseVerdictReply(text: string): PermissionVerdict | null {
  const m = VERDICT_REPLY_RE.exec(text)
  if (!m) return null
  const requestId = m[2]!.toLowerCase()
  const behavior = m[1]!.toLowerCase().startsWith('y') ? 'allow' : 'deny'
  return { requestId, behavior }
}

export function formatVerdictInstruction(requestId: string): string {
  return `Reply "yes ${requestId}" or "no ${requestId}"`
}
```

- [ ] **Step 8: Run tests and type check**

Run: `pnpm --filter channel test` → Expected: PASS (4 tests).
Run: `pnpm --filter channel check-types` → Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/channel pnpm-lock.yaml
git commit -m "feat(channel): scaffold apps/channel and ChannelBridge seam"
```

---

## Task 2: Transport helpers — gating, dedup, HMAC, prompt rendering

**Files:**
- Create: `apps/channel/src/transport/common.ts`
- Test: `apps/channel/src/transport/common.test.ts`

**Interfaces:**
- Consumes: `PermissionPrompt`, `formatVerdictInstruction` from `../bridge/types.ts`.
- Produces: `isAllowed(allowlist, senderId): boolean`, `class Deduper { check(id): boolean }`, `verifyHmac(secret, rawBody, signatureHex): boolean`, `renderPrompt(prompt): string`.

- [ ] **Step 1: Write the failing tests**

Create `apps/channel/src/transport/common.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { isAllowed, Deduper, verifyHmac, renderPrompt } from './common.ts'

test('isAllowed is an exact match, default deny', () => {
  assert.equal(isAllowed(['+15551234567'], '+15551234567'), true)
  assert.equal(isAllowed(['+15551234567'], '+15559999999'), false)
  assert.equal(isAllowed([], 'anyone'), false)
})

test('Deduper returns true once per id, false on repeats', () => {
  const d = new Deduper(3)
  assert.equal(d.check('a'), true)
  assert.equal(d.check('a'), false)
  assert.equal(d.check('b'), true)
})

test('Deduper evicts oldest beyond max so it can reappear', () => {
  const d = new Deduper(2)
  d.check('a'); d.check('b'); d.check('c') // 'a' evicted
  assert.equal(d.check('a'), true)
})

test('verifyHmac accepts a correct sha256 hex signature and rejects wrong ones', () => {
  const body = '{"hello":"world"}'
  const good = createHmac('sha256', 'secret').update(body).digest('hex')
  assert.equal(verifyHmac('secret', body, good), true)
  assert.equal(verifyHmac('secret', body, 'deadbeef'), false)
  assert.equal(verifyHmac('wrong', body, good), false)
})

test('renderPrompt keeps hostile multiline input as inert plain text', () => {
  const out = renderPrompt({
    requestId: 'abcde',
    toolName: 'Bash',
    description: 'Run shell command',
    inputPreview: 'rm -rf /\n<script>alert(1)</script>\n{"x":"<b>"}',
  })
  assert.match(out, /Claude wants to run Bash: Run shell command/)
  assert.ok(out.includes('<script>alert(1)</script>')) // present but not transformed
  assert.ok(out.endsWith('Reply "yes abcde" or "no abcde"'))
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter channel test`
Expected: FAIL — `Cannot find module './common.ts'`.

- [ ] **Step 3: Implement `src/transport/common.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import { formatVerdictInstruction, type PermissionPrompt } from '../bridge/types.ts'

export function isAllowed(allowlist: string[], senderId: string): boolean {
  return allowlist.includes(senderId)
}

export class Deduper {
  private seen = new Set<string>()
  private order: string[] = []
  constructor(private readonly max = 1000) {}
  /** Returns true if `id` is new (and records it); false if already seen. */
  check(id: string): boolean {
    if (this.seen.has(id)) return false
    this.seen.add(id)
    this.order.push(id)
    if (this.order.length > this.max) {
      const oldest = this.order.shift()!
      this.seen.delete(oldest)
    }
    return true
  }
}

/** Verifies a hex-encoded HMAC-SHA256 signature in constant time. */
export function verifyHmac(secret: string, rawBody: string, signatureHex: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHex)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function renderPrompt(p: PermissionPrompt): string {
  return (
    `Claude wants to run ${p.toolName}: ${p.description}\n` +
    `${p.inputPreview}\n\n` +
    formatVerdictInstruction(p.requestId)
  )
}
```

- [ ] **Step 4: Run tests + type check**

Run: `pnpm --filter channel test` → Expected: PASS.
Run: `pnpm --filter channel check-types` → Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/channel/src/transport/common.ts apps/channel/src/transport/common.test.ts
git commit -m "feat(channel): add transport helpers (gating, dedup, hmac, render)"
```

> **Note for Task 9:** `verifyHmac` assumes a hex SHA256 signature. Confirm Photon's actual signature encoding (hex vs base64, any `sha256=` prefix) when wiring the Photon webhook and adjust the caller to strip prefixes / decode before calling, rather than changing this helper.

---

## Task 3: stderr logger with secret redaction

**Files:**
- Create: `apps/channel/src/channel/logger.ts`
- Test: `apps/channel/src/channel/logger.test.ts`

**Interfaces:**
- Produces: `interface Logger { info; warn; error }`, `createLogger(secrets: string[], stream?): Logger`.

- [ ] **Step 1: Write the failing test**

Create `apps/channel/src/channel/logger.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { createLogger } from './logger.ts'

function capture() {
  const lines: string[] = []
  const stream = new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb() } })
  return { stream, lines }
}

test('writes a JSON line with level and message to the given stream', () => {
  const { stream, lines } = capture()
  createLogger([], stream).info('hello', { n: 1 })
  assert.equal(lines.length, 1)
  const parsed = JSON.parse(lines[0]!)
  assert.equal(parsed.level, 'info')
  assert.equal(parsed.msg, 'hello')
  assert.equal(parsed.n, 1)
})

test('redacts configured secret values anywhere in the line', () => {
  const { stream, lines } = capture()
  createLogger(['supersecret', ''], stream).error('token=supersecret failed')
  assert.ok(!lines[0]!.includes('supersecret'))
  assert.ok(lines[0]!.includes('[REDACTED]'))
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter channel test` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/channel/logger.ts`**

```ts
export type LogFn = (msg: string, fields?: Record<string, unknown>) => void
export interface Logger {
  info: LogFn
  warn: LogFn
  error: LogFn
}

export function createLogger(
  secrets: string[],
  stream: NodeJS.WritableStream = process.stderr,
): Logger {
  const active = secrets.filter((s) => s.length > 0)
  const redact = (line: string) =>
    active.reduce((acc, secret) => acc.split(secret).join('[REDACTED]'), line)
  const write = (level: string, msg: string, fields?: Record<string, unknown>) => {
    stream.write(redact(JSON.stringify({ level, msg, ...fields })) + '\n')
  }
  return {
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  }
}
```

- [ ] **Step 4: Run tests + type check** → Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add apps/channel/src/channel/logger.ts apps/channel/src/channel/logger.test.ts
git commit -m "feat(channel): add stderr logger with secret redaction"
```

---

## Task 4: Configuration loading & validation

**Files:**
- Create: `apps/channel/src/config/env.ts`
- Test: `apps/channel/src/config/env.test.ts`

**Interfaces:**
- Produces: `interface Config { imessageProjectId; imessageProjectSecret; webhookPort; webhookPublicUrl; webhookSigningSecret; allowlist: string[]; permissionTtlMs: number; transport: 'photon' | 'dev' }`, `class ConfigError extends Error`, `loadConfig(env?: NodeJS.ProcessEnv): Config`, `secretsOf(config): string[]`.

- [ ] **Step 1: Write the failing tests**

Create `apps/channel/src/config/env.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to confirm failure** → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/config/env.ts`**

```ts
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
```

- [ ] **Step 4: Run tests + type check** → Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add apps/channel/src/config/env.ts apps/channel/src/config/env.test.ts
git commit -m "feat(channel): add config loading and validation"
```

---

## Task 5: `PermissionStore` — open-request tracking + TTL

**Files:**
- Create: `apps/channel/src/channel/permissions.ts`
- Test: `apps/channel/src/channel/permissions.test.ts`

**Interfaces:**
- Produces: `class PermissionStore` with `constructor(ttlMs: number, now: () => number)`, `open(requestId, conversationId: string | undefined): void`, `has(requestId): boolean`, `getConversation(requestId): string | undefined`, `close(requestId): void`.

- [ ] **Step 1: Write the failing tests**

Create `apps/channel/src/channel/permissions.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PermissionStore } from './permissions.ts'

test('open then has, and getConversation returns the routed conversation', () => {
  const s = new PermissionStore(1000, () => 0)
  s.open('abcde', 'conv-1')
  assert.equal(s.has('abcde'), true)
  assert.equal(s.getConversation('abcde'), 'conv-1')
})

test('has is false for unknown ids', () => {
  const s = new PermissionStore(1000, () => 0)
  assert.equal(s.has('zzzzz'), false)
})

test('close removes the request', () => {
  const s = new PermissionStore(1000, () => 0)
  s.open('abcde', 'c')
  s.close('abcde')
  assert.equal(s.has('abcde'), false)
})

test('has returns false after the TTL elapses', () => {
  let t = 0
  const s = new PermissionStore(1000, () => t)
  s.open('abcde', 'c')
  t = 1001
  assert.equal(s.has('abcde'), false)
})

test('tracks multiple concurrent open requests independently', () => {
  const s = new PermissionStore(1000, () => 0)
  s.open('aaaaa', 'c1')
  s.open('bbbbb', 'c2')
  assert.equal(s.has('aaaaa'), true)
  assert.equal(s.has('bbbbb'), true)
  assert.equal(s.getConversation('bbbbb'), 'c2')
})
```

- [ ] **Step 2: Run to confirm failure** → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/channel/permissions.ts`**

```ts
interface OpenRequest {
  conversationId: string | undefined
  at: number
}

export class PermissionStore {
  private open_ = new Map<string, OpenRequest>()
  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  open(requestId: string, conversationId: string | undefined): void {
    this.open_.set(requestId, { conversationId, at: this.now() })
  }

  has(requestId: string): boolean {
    const entry = this.open_.get(requestId)
    if (!entry) return false
    if (this.now() - entry.at > this.ttlMs) {
      this.open_.delete(requestId)
      return false
    }
    return true
  }

  getConversation(requestId: string): string | undefined {
    return this.open_.get(requestId)?.conversationId
  }

  close(requestId: string): void {
    this.open_.delete(requestId)
  }
}
```

- [ ] **Step 4: Run tests + type check** → Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add apps/channel/src/channel/permissions.ts apps/channel/src/channel/permissions.test.ts
git commit -m "feat(channel): add PermissionStore with TTL"
```

---

## Task 6: `ChannelCore` — routing logic (the priority-B heart) + `FakeBridge`

**Files:**
- Create: `apps/channel/src/channel/core.ts`
- Create: `apps/channel/src/testing/fake-bridge.ts`
- Test: `apps/channel/src/channel/core.test.ts`

**Interfaces:**
- Consumes: `ChannelBridge`, `InboundMessage`, `PermissionPrompt`, `parseVerdictReply` (`../bridge/types.ts`); `PermissionStore` (`./permissions.ts`); `Logger` (`./logger.ts`).
- Produces:
  - `interface Notifier { channelEvent(content, meta): Promise<void>; permissionVerdict(requestId, behavior): Promise<void> }`
  - `class ChannelCore` with `constructor(deps: { bridge: ChannelBridge; notifier: Notifier; store: PermissionStore; logger: Logger })`, `handleInbound(msg: InboundMessage): Promise<void>`, `handleReply(args: { chat_id: string; text: string }): Promise<{ ok: true } | { ok: false; error: string }>`, `handlePermissionRequest(prompt: PermissionPrompt): Promise<void>`.
  - `class FakeBridge implements ChannelBridge` with `sent: Array<{ conversationId: string; text: string }>`, `prompts: Array<{ conversationId: string; prompt: PermissionPrompt }>`, `emit(msg: InboundMessage): Promise<void>`, and a `failSend` toggle.

- [ ] **Step 1: Write `FakeBridge` test double**

Create `apps/channel/src/testing/fake-bridge.ts`:

```ts
import type { BridgeHandlers, ChannelBridge, InboundMessage, PermissionPrompt } from '../bridge/types.ts'

export class FakeBridge implements ChannelBridge {
  sent: Array<{ conversationId: string; text: string }> = []
  prompts: Array<{ conversationId: string; prompt: PermissionPrompt }> = []
  failSend = false
  private handlers: BridgeHandlers | undefined

  async start(handlers: BridgeHandlers): Promise<void> {
    this.handlers = handlers
  }
  async stop(): Promise<void> {}
  async sendMessage(conversationId: string, text: string): Promise<void> {
    if (this.failSend) throw new Error('send failed')
    this.sent.push({ conversationId, text })
  }
  async sendPermissionPrompt(conversationId: string, prompt: PermissionPrompt): Promise<void> {
    if (this.failSend) throw new Error('prompt send failed')
    this.prompts.push({ conversationId, prompt })
  }
  /** Simulate an allowed inbound message arriving from the platform. */
  async emit(msg: InboundMessage): Promise<void> {
    await this.handlers!.onMessage(msg)
  }
}
```

- [ ] **Step 2: Write the failing tests for `ChannelCore`**

Create `apps/channel/src/channel/core.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChannelCore, type Notifier } from './core.ts'
import { PermissionStore } from './permissions.ts'
import { FakeBridge } from '../testing/fake-bridge.ts'
import { createLogger } from './logger.ts'
import { Writable } from 'node:stream'

const nullLog = () => createLogger([], new Writable({ write(_c, _e, cb) { cb() } }))

function makeNotifier() {
  const events: Array<{ content: string; meta: Record<string, string> }> = []
  const verdicts: Array<{ requestId: string; behavior: string }> = []
  const notifier: Notifier = {
    async channelEvent(content, meta) { events.push({ content, meta }) },
    async permissionVerdict(requestId, behavior) { verdicts.push({ requestId, behavior }) },
  }
  return { notifier, events, verdicts }
}

function setup() {
  const bridge = new FakeBridge()
  const store = new PermissionStore(60_000, () => 0)
  const { notifier, events, verdicts } = makeNotifier()
  const core = new ChannelCore({ bridge, notifier, store, logger: nullLog() })
  return { bridge, store, core, events, verdicts }
}

test('forwards normal chat as a channel event with chat_id and sender meta', async () => {
  const { core, events } = setup()
  await core.handleInbound({ conversationId: 'c1', senderId: '+1', text: 'what changed?' })
  assert.deepEqual(events, [{ content: 'what changed?', meta: { chat_id: 'c1', sender: '+1' } }])
})

test('a verdict for an OPEN request emits a verdict and is NOT forwarded as chat', async () => {
  const { core, store, events, verdicts } = setup()
  store.open('abcde', 'c1')
  await core.handleInbound({ conversationId: 'c1', senderId: '+1', text: 'yes abcde' })
  assert.deepEqual(verdicts, [{ requestId: 'abcde', behavior: 'allow' }])
  assert.equal(events.length, 0)
  assert.equal(store.has('abcde'), false) // closed
})

test('a verdict-shaped reply with NO open request is dropped (not forwarded)', async () => {
  const { core, events, verdicts } = setup()
  await core.handleInbound({ conversationId: 'c1', senderId: '+1', text: 'yes abcde' })
  assert.equal(verdicts.length, 0)
  assert.equal(events.length, 0)
})

test('handleReply calls bridge.sendMessage and returns ok', async () => {
  const { core, bridge } = setup()
  const res = await core.handleReply({ chat_id: 'c1', text: 'done' })
  assert.deepEqual(res, { ok: true })
  assert.deepEqual(bridge.sent, [{ conversationId: 'c1', text: 'done' }])
})

test('handleReply returns an error result when the send fails', async () => {
  const { core, bridge } = setup()
  bridge.failSend = true
  const res = await core.handleReply({ chat_id: 'c1', text: 'done' })
  assert.equal(res.ok, false)
  assert.match((res as { error: string }).error, /send failed/)
})

test('a permission request routes a prompt to the active conversation', async () => {
  const { core, bridge } = setup()
  await core.handleInbound({ conversationId: 'c9', senderId: '+1', text: 'hi' })
  await core.handlePermissionRequest({ requestId: 'abcde', toolName: 'Bash', description: 'Run shell command', inputPreview: 'ls' })
  assert.equal(bridge.prompts.length, 1)
  assert.equal(bridge.prompts[0]!.conversationId, 'c9')
})

test('a permission request with no prior inbound does not crash and sends nothing', async () => {
  const { core, bridge, store } = setup()
  await core.handlePermissionRequest({ requestId: 'abcde', toolName: 'Bash', description: 'x', inputPreview: 'y' })
  assert.equal(bridge.prompts.length, 0)
  assert.equal(store.has('abcde'), true) // still tracked so the terminal answer path is unaffected
})
```

- [ ] **Step 3: Run to confirm failure** → Expected: FAIL (`./core.ts` not found).

- [ ] **Step 4: Implement `src/channel/core.ts`**

```ts
import { parseVerdictReply, type ChannelBridge, type InboundMessage, type PermissionPrompt } from '../bridge/types.ts'
import type { PermissionStore } from './permissions.ts'
import type { Logger } from './logger.ts'

export interface Notifier {
  channelEvent(content: string, meta: Record<string, string>): Promise<void>
  permissionVerdict(requestId: string, behavior: 'allow' | 'deny'): Promise<void>
}

export interface ChannelCoreDeps {
  bridge: ChannelBridge
  notifier: Notifier
  store: PermissionStore
  logger: Logger
}

export class ChannelCore {
  private activeConversationId: string | undefined
  constructor(private readonly deps: ChannelCoreDeps) {}

  async handleInbound(msg: InboundMessage): Promise<void> {
    const verdict = parseVerdictReply(msg.text)
    if (verdict) {
      if (this.deps.store.has(verdict.requestId)) {
        this.deps.store.close(verdict.requestId)
        await this.deps.notifier.permissionVerdict(verdict.requestId, verdict.behavior)
      } else {
        this.deps.logger.warn('verdict for unknown or expired request; dropping', { requestId: verdict.requestId })
      }
      return
    }
    this.activeConversationId = msg.conversationId
    await this.deps.notifier.channelEvent(msg.text, { chat_id: msg.conversationId, sender: msg.senderId })
  }

  async handleReply(args: { chat_id: string; text: string }): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.deps.bridge.sendMessage(args.chat_id, args.text)
      return { ok: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.deps.logger.error('reply send failed', { chat_id: args.chat_id, error })
      return { ok: false, error }
    }
  }

  async handlePermissionRequest(prompt: PermissionPrompt): Promise<void> {
    const conversationId = this.activeConversationId
    this.deps.store.open(prompt.requestId, conversationId)
    if (!conversationId) {
      this.deps.logger.warn('permission request with no active conversation; local dialog is the only path', { requestId: prompt.requestId })
      return
    }
    try {
      await this.deps.bridge.sendPermissionPrompt(conversationId, prompt)
    } catch (err) {
      this.deps.logger.error('failed to send permission prompt; local dialog is the backstop', {
        requestId: prompt.requestId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
```

- [ ] **Step 5: Run tests + type check** → Expected: PASS (7 tests), clean.

- [ ] **Step 6: Commit**

```bash
git add apps/channel/src/channel/core.ts apps/channel/src/testing/fake-bridge.ts apps/channel/src/channel/core.test.ts
git commit -m "feat(channel): add ChannelCore routing and FakeBridge test double"
```

---

## Task 7: `createChannelServer` — MCP wiring (reply tool + permission relay)

**Files:**
- Create: `apps/channel/src/channel/server.ts`
- Test: `apps/channel/src/channel/server.test.ts`

**Interfaces:**
- Consumes: `ChannelCore`, `Notifier` (`./core.ts`); `ChannelBridge` (`../bridge/types.ts`); `PermissionStore` (`./permissions.ts`); `Logger` (`./logger.ts`).
- Produces: `createChannelServer(deps: { bridge: ChannelBridge; store: PermissionStore; logger: Logger }): { server: Server; core: ChannelCore; connect(transport): Promise<void> }`.
- Key protocol facts: capabilities `experimental: { 'claude/channel': {}, 'claude/channel/permission': {} }`, `tools: {}`; inbound channel event method `notifications/claude/channel`; verdict method `notifications/claude/channel/permission`; incoming request method `notifications/claude/channel/permission_request`.

- [ ] **Step 1: Write the failing integration test (uses the SDK's in-memory transport)**

Create `apps/channel/src/channel/server.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import { createChannelServer } from './server.ts'
import { PermissionStore } from './permissions.ts'
import { FakeBridge } from '../testing/fake-bridge.ts'
import { createLogger } from './logger.ts'

const nullLog = () => createLogger([], new Writable({ write(_c, _e, cb) { cb() } }))

async function connectPair() {
  const bridge = new FakeBridge()
  const store = new PermissionStore(60_000, () => 0)
  const { server, core, connect } = createChannelServer({ bridge, store, logger: nullLog() })
  await bridge.start({ onMessage: (m) => core.handleInbound(m) })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-claude-code', version: '0' }, { capabilities: {} })
  await Promise.all([connect(serverTransport), client.connect(clientTransport)])
  return { client, bridge, store }
}

test('exposes a reply tool that routes to bridge.sendMessage', async () => {
  const { client, bridge } = await connectPair()
  const tools = await client.listTools()
  assert.ok(tools.tools.some((t) => t.name === 'reply'))
  const res = await client.callTool({ name: 'reply', arguments: { chat_id: 'c1', text: 'hello' } })
  assert.deepEqual(bridge.sent, [{ conversationId: 'c1', text: 'hello' }])
  assert.equal((res.content as Array<{ text: string }>)[0]!.text, 'sent')
})

test('a failed reply send returns an error result to the caller', async () => {
  const { client, bridge } = await connectPair()
  bridge.failSend = true
  const res = await client.callTool({ name: 'reply', arguments: { chat_id: 'c1', text: 'hello' } })
  assert.equal(res.isError, true)
})

test('a permission_request notification produces an outbound prompt on the active conversation', async () => {
  const { client, bridge } = await connectPair()
  await bridge.emit({ conversationId: 'c1', senderId: 'me', text: 'hi' }) // set active conversation
  await client.notification({
    method: 'notifications/claude/channel/permission_request',
    params: { request_id: 'abcde', tool_name: 'Bash', description: 'Run shell command', input_preview: 'ls -la' },
  })
  await new Promise((r) => setTimeout(r, 20)) // let the notification propagate
  assert.equal(bridge.prompts.length, 1)
  assert.equal(bridge.prompts[0]!.prompt.requestId, 'abcde')
})

test('an allowed inbound verdict emits a permission notification to Claude Code', async () => {
  const { client, bridge, store } = await connectPair()
  store.open('abcde', 'c1')
  const received: Array<{ request_id: string; behavior: string }> = []
  client.setNotificationHandler(
    z.object({
      method: z.literal('notifications/claude/channel/permission'),
      params: z.object({ request_id: z.string(), behavior: z.string() }),
    }),
    async (n) => { received.push(n.params) },
  )
  await bridge.emit({ conversationId: 'c1', senderId: 'me', text: 'yes abcde' })
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(received, [{ request_id: 'abcde', behavior: 'allow' }])
})
```

- [ ] **Step 2: Run to confirm failure** → Expected: FAIL (`./server.ts` not found).

- [ ] **Step 3: Implement `src/channel/server.ts`**

```ts
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
```

- [ ] **Step 4: Run tests + type check**

Run: `pnpm --filter channel test` → Expected: PASS (4 tests).
If `callTool` error-shape or `notification` propagation differs in the installed SDK version, adjust the test's assertions (e.g. `res.isError`) to match the SDK — not the production code.
Run: `pnpm --filter channel check-types` → Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/channel/src/channel/server.ts apps/channel/src/channel/server.test.ts
git commit -m "feat(channel): wire MCP server (reply tool + permission relay)"
```

---

## Task 8: `DevBridge` — local HTTP+SSE transport + the shared bridge contract

**Files:**
- Create: `apps/channel/src/transport/dev.ts`
- Create: `apps/channel/src/transport/contract.ts`
- Test: `apps/channel/src/transport/dev.test.ts`

**Interfaces:**
- Consumes: `ChannelBridge`, `InboundMessage`, `PermissionPrompt` (`../bridge/types.ts`); `isAllowed`, `renderPrompt` (`./common.ts`); `Logger` (`../channel/logger.ts`).
- Produces:
  - `createDevBridge(opts: { port: number; allowlist: string[]; logger: Logger }): ChannelBridge & { address(): string }`.
  - `runBridgeContract(name: string, makeDriver: () => Promise<BridgeDriver>): void` where `interface BridgeDriver { bridge: ChannelBridge; simulateInbound(msg: InboundMessage): Promise<void>; outbound(): Promise<{ messages: string[]; prompts: string[] }>; cleanup(): Promise<void> }`.

- [ ] **Step 1: Write the shared contract runner**

Create `apps/channel/src/transport/contract.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ChannelBridge, InboundMessage } from '../bridge/types.ts'

export interface BridgeDriver {
  bridge: ChannelBridge
  /** Make an allowed inbound message arrive through the real transport path. */
  simulateInbound(msg: InboundMessage): Promise<void>
  /** Everything the bridge has sent outbound so far. */
  outbound(): Promise<{ messages: string[]; prompts: string[] }>
  cleanup(): Promise<void>
}

export function runBridgeContract(name: string, makeDriver: () => Promise<BridgeDriver>): void {
  test(`${name}: delivers inbound to the handler`, async () => {
    const received: InboundMessage[] = []
    const d = await makeDriver()
    try {
      await d.bridge.start({ onMessage: (m) => { received.push(m) } })
      await d.simulateInbound({ conversationId: 'c1', senderId: 'me', text: 'hello' })
      assert.equal(received.at(-1)?.text, 'hello')
    } finally { await d.cleanup() }
  })

  test(`${name}: sendMessage is observable outbound`, async () => {
    const d = await makeDriver()
    try {
      await d.bridge.start({ onMessage: () => {} })
      await d.bridge.sendMessage('c1', 'a reply')
      const out = await d.outbound()
      assert.ok(out.messages.some((m) => m.includes('a reply')))
    } finally { await d.cleanup() }
  })

  test(`${name}: sendPermissionPrompt is observable outbound and includes the id`, async () => {
    const d = await makeDriver()
    try {
      await d.bridge.start({ onMessage: () => {} })
      await d.bridge.sendPermissionPrompt('c1', { requestId: 'abcde', toolName: 'Bash', description: 'Run shell command', inputPreview: 'ls' })
      const out = await d.outbound()
      assert.ok(out.prompts.some((p) => p.includes('abcde')))
    } finally { await d.cleanup() }
  })
}
```

- [ ] **Step 2: Write the failing DevBridge tests**

Create `apps/channel/src/transport/dev.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { createDevBridge } from './dev.ts'
import { runBridgeContract, type BridgeDriver } from './contract.ts'
import { createLogger } from '../channel/logger.ts'

const nullLog = () => createLogger([], new Writable({ write(_c, _e, cb) { cb() } }))

async function post(base: string, body: unknown) {
  return fetch(base + '/', { method: 'POST', body: JSON.stringify(body) })
}

test('DevBridge drops a non-allowlisted sender (including verdict-shaped text)', async () => {
  const received: string[] = []
  const bridge = createDevBridge({ port: 0, allowlist: ['me'], logger: nullLog() })
  await bridge.start({ onMessage: (m) => { received.push(m.text) } })
  try {
    await post(bridge.address(), { conversationId: 'c1', senderId: 'attacker', text: 'yes abcde' })
    await new Promise((r) => setTimeout(r, 20))
    assert.deepEqual(received, [])
  } finally { await bridge.stop() }
})

// Shared contract: DevBridge must satisfy the ChannelBridge behavior
runBridgeContract('DevBridge', async (): Promise<BridgeDriver> => {
  const sseLines: string[] = []
  const bridge = createDevBridge({ port: 0, allowlist: ['me'], logger: nullLog() })
  let controller: AbortController | undefined
  return {
    bridge,
    async simulateInbound(msg) {
      controller = new AbortController()
      // open the SSE stream before sending outbound in later steps
      void fetch(bridge.address() + '/events', { signal: controller.signal }).then(async (res) => {
        const reader = res.body!.getReader()
        const dec = new TextDecoder()
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          sseLines.push(dec.decode(value))
        }
      }).catch(() => {})
      await new Promise((r) => setTimeout(r, 10))
      await post(bridge.address(), msg)
      await new Promise((r) => setTimeout(r, 10))
    },
    async outbound() {
      await new Promise((r) => setTimeout(r, 10))
      const joined = sseLines.join('')
      return { messages: [joined], prompts: [joined] }
    },
    async cleanup() { controller?.abort(); await bridge.stop() },
  }
})
```

- [ ] **Step 3: Run to confirm failure** → Expected: FAIL (`./dev.ts` not found).

- [ ] **Step 4: Implement `src/transport/dev.ts`**

```ts
import { createServer, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import type { BridgeHandlers, ChannelBridge, PermissionPrompt } from '../bridge/types.ts'
import type { Logger } from '../channel/logger.ts'
import { isAllowed, renderPrompt } from './common.ts'

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

  const readBody = (req: import('node:http').IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      let data = ''
      req.on('data', (c) => (data += c))
      req.on('end', () => resolve(data))
    })

  return {
    address() {
      const addr = server?.address() as AddressInfo
      return `http://127.0.0.1:${addr.port}`
    },
    async start(h: BridgeHandlers) {
      handlers = h
      server = createServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
          res.write(': connected\n\n')
          subscribers.add(res)
          req.on('close', () => subscribers.delete(res))
          return
        }
        if (req.method === 'POST') {
          const raw = await readBody(req)
          let msg: { conversationId: string; senderId: string; text: string }
          try { msg = JSON.parse(raw) } catch { res.writeHead(400).end('bad json'); return }
          if (!isAllowed(opts.allowlist, msg.senderId)) { res.writeHead(200).end('ok'); return }
          res.writeHead(200).end('ok')
          await handlers!.onMessage(msg)
          return
        }
        res.writeHead(404).end()
      })
      await new Promise<void>((resolve) => server!.listen(opts.port, '127.0.0.1', resolve))
      opts.logger.info('DevBridge listening', { url: this.address() })
    },
    async stop() {
      for (const res of subscribers) res.end()
      subscribers.clear()
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    },
    async sendMessage(conversationId: string, text: string) {
      broadcast({ type: 'message', conversationId, text })
    },
    async sendPermissionPrompt(conversationId: string, prompt: PermissionPrompt) {
      broadcast({ type: 'prompt', conversationId, text: renderPrompt(prompt) })
    },
  }
}
```

- [ ] **Step 5: Run tests + type check**

Run: `pnpm --filter channel test` → Expected: PASS (DevBridge gating test + 3 contract tests).
Run: `pnpm --filter channel check-types` → Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/channel/src/transport/dev.ts apps/channel/src/transport/contract.ts apps/channel/src/transport/dev.test.ts
git commit -m "feat(channel): add DevBridge and shared bridge contract suite"
```

---

## Task 9: `createPhotonBridge` — Chat SDK + Photon iMessage adapter

> This is the one task with external API uncertainty. Resolve the exact package names and API **first** (Step 1), then implement the thin shell; the risky logic (gating, dedup, HMAC) already lives in tested helpers from Task 2.

**Files:**
- Create: `apps/channel/src/transport/photon.ts`
- Test: `apps/channel/src/transport/photon.test.ts`

**Interfaces:**
- Consumes: `ChannelBridge`, `BridgeHandlers`, `InboundMessage`, `PermissionPrompt` (`../bridge/types.ts`); `isAllowed`, `Deduper`, `verifyHmac`, `renderPrompt` (`./common.ts`); `Config` (`../config/env.ts`); `Logger` (`../channel/logger.ts`).
- Produces: `createPhotonBridge(config: Config, logger: Logger): ChannelBridge`, and a pure exported `mapPhotonEvent(raw): InboundMessage | null` for unit testing the payload mapping.

- [ ] **Step 1: Pin the adapter API (research, record findings in a comment block at the top of `photon.ts`)**

Read these and write down the exact symbols before coding:
- `https://chat-sdk.dev/docs` — the core Chat SDK package name, how a `Chat`/bot is created, the inbound handler name (e.g. `onMessage` / `onNewMention`), and how `thread.post(text)` resolves / how to post to a thread by id.
- `https://chat-sdk.dev/adapters/vendor-official/photon` and `https://github.com/photon-hq/vercel-chat-adapter-imessage` — the adapter package name, the cloud-mode env vars (`IMESSAGE_PROJECT_ID`, `IMESSAGE_PROJECT_SECRET`), the webhook handler entry point, and the **signature header name + encoding** (hex vs base64, any `sha256=` prefix).

Install what you found: `pnpm --filter channel add <chat-sdk-core> @photon-hq/vercel-chat-adapter-imessage`.

- [ ] **Step 2: Write the failing test for the pure payload mapper**

Create `apps/channel/src/transport/photon.test.ts`. Adjust the `raw` shape to the real webhook payload confirmed in Step 1; the assertions are what matter:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapPhotonEvent } from './photon.ts'

test('maps a Photon inbound webhook payload to an InboundMessage', () => {
  // Shape confirmed from the adapter docs in Step 1 — update keys to match.
  const raw = { chat: { id: 'iMessage;-;+15551234567' }, sender: { id: '+15551234567' }, text: 'ship it' }
  assert.deepEqual(mapPhotonEvent(raw), {
    conversationId: 'iMessage;-;+15551234567',
    senderId: '+15551234567',
    text: 'ship it',
  })
})

test('returns null for a payload with no text (e.g. a tapback-only event)', () => {
  assert.equal(mapPhotonEvent({ chat: { id: 'x' }, sender: { id: 'y' } }), null)
})
```

- [ ] **Step 3: Run to confirm failure** → Expected: FAIL (`./photon.ts` not found).

- [ ] **Step 4: Implement `src/transport/photon.ts`**

Wire the Chat SDK adapter for outbound and a local HTTP webhook receiver for inbound. The `mapPhotonEvent`, gating, dedup, and HMAC pieces are concrete; the three `ADAPTER:` lines are where you drop in the exact symbols from Step 1.

```ts
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { BridgeHandlers, ChannelBridge, InboundMessage, PermissionPrompt } from '../bridge/types.ts'
import type { Config } from '../config/env.ts'
import type { Logger } from '../channel/logger.ts'
import { Deduper, isAllowed, renderPrompt, verifyHmac } from './common.ts'
// ADAPTER (Step 1): import { createChat } from '<chat-sdk-core>'
// ADAPTER (Step 1): import { imessage } from '@photon-hq/vercel-chat-adapter-imessage'

/** Pure mapping from a Photon webhook payload to our InboundMessage. */
export function mapPhotonEvent(raw: any): InboundMessage | null {
  const text: unknown = raw?.text
  const conversationId: unknown = raw?.chat?.id
  const senderId: unknown = raw?.sender?.id
  if (typeof text !== 'string' || typeof conversationId !== 'string' || typeof senderId !== 'string') return null
  return { conversationId, senderId, text }
}

export function createPhotonBridge(config: Config, logger: Logger): ChannelBridge {
  const dedup = new Deduper(2000)
  let handlers: BridgeHandlers | undefined
  let server: Server | undefined

  // ADAPTER (Step 1): construct the Chat SDK client for OUTBOUND posting:
  //   const chat = createChat({ adapter: imessage({ projectId: config.imessageProjectId, projectSecret: config.imessageProjectSecret }) })
  // Replace `post(conversationId, text)` below with the SDK's thread-by-id post call.
  const post = async (conversationId: string, text: string): Promise<void> => {
    // ADAPTER (Step 1): await chat.thread(conversationId).post(text)
    void conversationId; void text
    throw new Error('photon outbound not wired: replace with chat.thread(id).post(text) from Step 1')
  }

  const handleWebhook = async (rawBody: string, signature: string, messageId: string): Promise<void> => {
    if (!verifyHmac(config.webhookSigningSecret, rawBody, signature)) {
      logger.warn('rejected webhook: bad signature')
      return
    }
    if (!dedup.check(messageId)) return // duplicate delivery
    const msg = mapPhotonEvent(JSON.parse(rawBody))
    if (!msg) return
    if (!isAllowed(config.allowlist, msg.senderId)) {
      logger.warn('dropped message from non-allowlisted sender')
      return
    }
    await handlers!.onMessage(msg)
  }

  return {
    async start(h: BridgeHandlers) {
      handlers = h
      server = createServer((req, res) => {
        if (req.method !== 'POST') { res.writeHead(404).end(); return }
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          // ADAPTER (Step 1): confirm the signature header name + any prefix to strip.
          const signature = String(req.headers['x-photon-signature'] ?? '')
          const messageId = String(req.headers['x-photon-message-id'] ?? raw.length + ':' + signature)
          res.writeHead(200).end('ok') // ack fast, then process async
          handleWebhook(raw, signature, messageId).catch((err) =>
            logger.error('webhook handling failed', { error: err instanceof Error ? err.message : String(err) }),
          )
        })
      })
      await new Promise<void>((resolve) => server!.listen(config.webhookPort, '127.0.0.1', resolve))
      const addr = server.address() as AddressInfo
      logger.info('Photon webhook listener ready', { port: addr.port, publicUrl: config.webhookPublicUrl })
    },
    async stop() {
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    },
    async sendMessage(conversationId: string, text: string) {
      await post(conversationId, text)
    },
    async sendPermissionPrompt(conversationId: string, prompt: PermissionPrompt) {
      await post(conversationId, renderPrompt(prompt))
    },
  }
}
```

- [ ] **Step 5: Run tests + type check**

Run: `pnpm --filter channel test` → Expected: PASS (the 2 `mapPhotonEvent` tests; adjust payload keys if Step 1 revealed a different shape).
Run: `pnpm --filter channel check-types` → Expected: clean (the `ADAPTER:` import lines stay commented until wired; `post` throws until replaced).

- [ ] **Step 6: Commit**

```bash
git add apps/channel/src/transport/photon.ts apps/channel/src/transport/photon.test.ts pnpm-lock.yaml
git commit -m "feat(channel): add Photon iMessage transport (webhook in, SDK out)"
```

---

## Task 10: Composition root, `.mcp.json`, README + manual acceptance

**Files:**
- Create: `apps/channel/src/index.ts`
- Create: `apps/channel/README.md`
- Create: `apps/channel/example.mcp.json`

**Interfaces:**
- Consumes: everything. `loadConfig`, `secretsOf` (`./config/env.ts`); `createLogger` (`./channel/logger.ts`); `PermissionStore` (`./channel/permissions.ts`); `createChannelServer` (`./channel/server.ts`); `createPhotonBridge` (`./transport/photon.ts`); `createDevBridge` (`./transport/dev.ts`); `StdioServerTransport` (`@modelcontextprotocol/sdk/server/stdio.js`).

- [ ] **Step 1: Implement `src/index.ts` (composition root + lifecycle)**

```ts
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
```

- [ ] **Step 2: Type check** → Run: `pnpm --filter channel check-types` → Expected: clean.

- [ ] **Step 3: Create `example.mcp.json`** (users copy to project `.mcp.json` or `~/.claude.json`, with an absolute path)

```json
{
  "mcpServers": {
    "imessage": { "command": "node", "args": ["/ABSOLUTE/PATH/TO/apps/channel/src/index.ts"] }
  }
}
```

- [ ] **Step 4: Write `README.md`**

Cover, in order:
1. **What it is** — one paragraph (chat with your Claude Code session + approve permission prompts from iMessage).
2. **Prerequisites** — Node ≥24, a Photon Cloud project (`app.photon.codes`), ngrok, Claude Code authenticated with claude.ai or a Console API key.
3. **Setup** — `pnpm install`; copy `.env.example` → `.env` and fill `IMESSAGE_PROJECT_ID`/`IMESSAGE_PROJECT_SECRET`/`WEBHOOK_*`/`CHANNEL_ALLOWLIST`; run `ngrok http $WEBHOOK_PORT`; register the ngrok HTTPS URL + signing secret in the Photon dashboard; set `WEBHOOK_PUBLIC_URL` to the ngrok URL.
4. **Register the channel** — copy `example.mcp.json` into `.mcp.json` (absolute path to `src/index.ts`).
5. **Run** — `claude --dangerously-load-development-channels server:imessage`. Explain **prominently**: custom channels aren't on Anthropic's allowlist during the research preview, so this flag is required; it's interactive-only (ignored under `-p`); and it's subject to the `channelsEnabled` org policy on Team/Enterprise.
6. **Permission approvals** — a prompt arrives in iMessage with a 5-letter code; reply `yes <code>` or `no <code>`; whichever of terminal/phone answers first wins.
7. **Troubleshooting** — a free ngrok URL changes each restart and must be re-registered with Photon (use a reserved domain to avoid this); `/mcp` shows `failed` if config is bad (check stderr / `claude --debug`); only `CHANNEL_ALLOWLIST` senders can message or approve.
8. **Local testing without a phone** — set `CHANNEL_TRANSPORT=dev`, run with the dev flag, then in another terminal `curl -N http://127.0.0.1:$WEBHOOK_PORT/events` to watch replies/prompts and `curl -XPOST http://127.0.0.1:$WEBHOOK_PORT/ -d '{"conversationId":"c1","senderId":"me","text":"hi"}'` (with `me` in the allowlist) to send messages in.

- [ ] **Step 5: Full test + type-check sweep**

Run: `pnpm --filter channel test` → Expected: all tests PASS.
Run: `pnpm --filter channel check-types` → Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/channel/src/index.ts apps/channel/README.md apps/channel/example.mcp.json
git commit -m "feat(channel): composition root, mcp config, and README"
```

- [ ] **Step 7: Manual acceptance — DevBridge (no phone, no Photon)**

With `CHANNEL_TRANSPORT=dev` and your handle in `CHANNEL_ALLOWLIST`, start `claude --dangerously-load-development-channels server:imessage`. In a second terminal open the SSE stream, in a third POST a message. Verify: (a) the message appears in the Claude Code session as a `<channel>` event; (b) Claude's `reply` lands on the SSE stream; (c) in manual mode, asking Claude to run a Bash command produces a permission prompt on the SSE stream with a 5-letter code; (d) POSTing `yes <code>` lets the tool run and closes the terminal dialog; (e) `no <code>` denies; (f) a POST with a non-allowlisted `senderId` is ignored.

- [ ] **Step 8: Manual acceptance — real iMessage (after Task 9 adapter wiring)**

With `CHANNEL_TRANSPORT=photon`, ngrok up, and the webhook registered in Photon: text yourself from an allowlisted handle and confirm the full loop end-to-end — inbound arrives, `reply` lands in Messages, a Bash permission prompt arrives with its code, `yes <code>` runs it and closes the terminal dialog, and a non-allowlisted sender is ignored.

- [ ] **Step 9: Finalize**

Run the `superpowers:finishing-a-development-branch` workflow (or your chosen integration path) once both manual acceptance passes are green.

---

## Notes for the executor

- **If the installed `@modelcontextprotocol/sdk` API differs** from the method names used here (`server.notification`, `setNotificationHandler`, `InMemoryTransport.createLinkedPair`, `client.callTool` result shape), adjust the *tests and wiring* to the installed version — the channel-protocol method strings (`notifications/claude/channel`, `.../permission`, `.../permission_request`) and the capability keys must stay exactly as written.
- **Task 9 is the only task that touches an unpinned external API.** Keep its shell thin; all logic worth testing (gating, dedup, HMAC, mapping, rendering) is already covered by Tasks 2 and 8. Do not let uncertainty there leak into the channel half.
- **Never add a `console.log`.** Use the injected `logger` (stderr). A stray stdout write silently breaks the MCP stdio protocol.
