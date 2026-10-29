@AGENTS.md

# claude-channels

A Claude Code _channel_ (an MCP server over stdio) that bridges a running Claude Code
session to iMessage via Photon, including remote approval of tool-permission prompts.
Turborepo + pnpm monorepo. See [README.md](README.md) for the overview and
[CONTRIBUTING.md](CONTRIBUTING.md) for contributor workflow.

## Commands

Requires Node >= 24 and pnpm (version pinned in `package.json`).

```bash
pnpm install
pnpm run lint          # eslint, --max-warnings 0
pnpm run check-types   # tsc --noEmit
pnpm test              # node --test
pnpm --filter @kennethlng/claude-photon-channel build   # esbuild bundle (what CI also builds)
```

Run all three checks (lint, check-types, test) before finishing a change; CI runs them
plus the bundle build.

Run the channel from source (no build step; Node runs the TypeScript directly):

```bash
cp apps/channel/.env.example .env
node apps/channel/src/index.ts
```

Set `CHANNEL_INTEGRATION=dev` to use the local `DevBridge` (curl/SSE), which needs no
Photon account or phone. Prefer it for testing end-to-end behavior.

## Architecture rules

- `@repo/contract` (`packages/contract`): `ChannelBridge` interface, DTOs, verdict
  grammar, `Logger`/`Config` types. Zero dependencies.
- `@repo/core` (`packages/core`): the Claude Code half (MCP server, routing,
  permission tracking). **Never import `@repo/integrations`.**
- `@repo/integrations` (`packages/integrations`): the messaging half (Photon
  integration, `DevBridge`). **Never import `@repo/core`.**
- The two halves meet only through `@repo/contract`. A new messaging integration is a
  new `ChannelBridge` implementation under `@repo/integrations`.
- `packages/photon-channel` is the publishable npm package
  (`@kennethlng/claude-photon-channel`); `@repo/*` packages are bundled into its
  `dist/` at build time. `apps/channel` is the dev composition root.
- `plugins/photon` and `.claude-plugin/marketplace.json` are the Claude Code plugin
  and marketplace. The plugin runs the published npm package, so keep its name in sync
  with `packages/photon-channel/package.json` (see PUBLISHING.md).
- `apps/web`, `apps/docs`, and `packages/ui` are leftover `create-turbo` scaffolding,
  not part of the project.

## Conventions

- TypeScript is run directly by Node (type stripping): no build step in development,
  so use erasable-syntax-only TypeScript (no enums, namespaces, or parameter properties).
- Tests use Node's built-in test runner (`node --test`); write tests first where practical.
- Config is read from `$CHANNEL_ENV_FILE`, then `./.env`, then
  `~/.claude/channels/photon/.env`. Env vars used by tasks must be listed in
  `globalEnv` in `turbo.json`.
- Never commit `.env` or `.mcp.json` (both gitignored; `.mcp.json` has machine-specific paths).
- Only allowlisted handles (`CHANNEL_ALLOWLIST`) may drive the session or answer
  permission prompts; everything else is silently ignored. Don't weaken this.
- Design notes and plans live in `docs/superpowers/`.
- Publishing is documented in [PUBLISHING.md](PUBLISHING.md) and happens from CI on
  a `v*` tag.
