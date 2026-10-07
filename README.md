# claude-channels

[![CI](https://github.com/kennethlng/claude-channels/actions/workflows/ci.yml/badge.svg)](https://github.com/kennethlng/claude-channels/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@kennethlng/claude-photon-channel.svg)](https://www.npmjs.com/package/@kennethlng/claude-photon-channel)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Talk to a running **Claude Code** session from **iMessage** — and approve or deny
its tool-permission prompts from your phone — built on [Claude Code
Channels](https://code.claude.com/docs/en/channels), [Photon
Cloud](https://app.photon.codes), and the [Vercel Chat SDK](https://chat-sdk.dev).

> **Not affiliated with Anthropic or Photon.** This is an independent, community
> open-source project. "Claude", "Claude Code", and "Photon" belong to their
> respective owners; names are used only to describe what this tool integrates with.

## What it does

A *channel* is an MCP server that Claude Code spawns over stdio, alongside your
session, operating on your real local files. This one bridges that session to
iMessage via Photon, so you can:

- **Chat** with your running session from your phone, and
- **Approve/deny permission prompts remotely** — when the session wants to run a
  Bash command (or other gated tool) while you're away, a prompt with a 5-letter
  code is relayed to iMessage; reply `yes <code>` / `no <code>`. Whichever of the
  terminal or your phone answers first wins.

## Install (plugin)

```bash
claude plugin marketplace add kennethlng/claude-channels
claude plugin install photon@kennethlng-channels
```

Then configure credentials and run — see **[PUBLISHING.md](PUBLISHING.md)** for the
full flow, or in a session run `/photon:configure` to scaffold the config file:

```bash
# ~/.claude/channels/photon/.env — Photon creds + webhook settings
# start a tunnel (ngrok http 8787) and register it in the Photon dashboard, then:
claude --dangerously-load-development-channels plugin:photon@kennethlng-channels
```

> **Research-preview note:** Claude Code channels are in research preview, so a
> custom channel requires `--dangerously-load-development-channels` until it's on
> Anthropic's allowlist. See [apps/channel/README.md](apps/channel/README.md).

## Local development

Clone-and-run (no build step — Node 24 runs the TypeScript directly):

```bash
pnpm install
cp apps/channel/.env.example .env     # fill in, or use CHANNEL_INTEGRATION=dev
node apps/channel/src/index.ts
```

There's a local `dev` integration (`CHANNEL_INTEGRATION=dev`) that exercises the
whole channel over `curl`/SSE with no Photon account or phone. Checks:

```bash
pnpm run lint && pnpm run check-types && pnpm test
```

## How it's built

The code is split so the Claude Code "channel half" and the messaging "integration
half" meet only through a shared contract — a seam that keeps a future hosted relay
or a new integration a drop-in, enforced by package boundaries:

- `apps/channel` — dev composition root (runs the publishable package from source).
- [`packages/photon-channel`](packages/photon-channel) — the publishable npm package `@kennethlng/claude-photon-channel` (bundled, `npx`-runnable channel).
- [`@repo/contract`](packages/contract) — the `ChannelBridge` interface, DTOs, verdict grammar, `Logger`/`Config` types. Zero deps.
- [`@repo/core`](packages/core) — the Claude Code channel half: MCP server, routing, permission tracking. Never imports an integration.
- [`@repo/integrations`](packages/integrations) — the messaging half: the Photon integration, the local `DevBridge`, shared helpers. Never imports core.
- [`plugins/photon`](plugins/photon) + [`.claude-plugin/marketplace.json`](.claude-plugin) — the Claude Code plugin and the marketplace that lists it.

Design and implementation notes live in
[`docs/superpowers/`](docs/superpowers/). `apps/web`, `apps/docs`, and `@repo/ui`
are leftover `create-turbo` scaffolding, not part of this project.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports:
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Kenneth Ng
