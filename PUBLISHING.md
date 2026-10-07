# Publishing & distribution

Two artifacts ship: the **npm package** (`@kennethlng/claude-photon-channel`, the
runnable channel) and the **plugin marketplace** (this repo, which lists the
`photon` plugin that runs the npm package). Everything below has been scaffolded
and verified locally; the steps marked **(you)** require your npm/GitHub accounts.

## 0. Rename the scope if needed (you)

The package is named `@kennethlng/claude-photon-channel`. If your npm username/org
differs, change the `name` in `packages/photon-channel/package.json` **and** the
`args` in `plugins/photon/.mcp.json` to match.

## 1. Publish the npm package (you)

The published tarball contains only `dist/` + `package.json`; the `@repo/*`
workspace packages are bundled into `dist/index.js` at build time, and the five
runtime deps (`chat`, `@photon-ai/chat-adapter-imessage`, `@chat-adapter/state-memory`,
`@modelcontextprotocol/sdk`, `zod`) are declared and installed by npm.

```bash
cd packages/photon-channel
pnpm publish --access public      # use pnpm (not npm) — it rewrites workspace:* refs
                                  # add --no-git-checks if the tree isn't committed yet
```

`prepublishOnly` rebuilds `dist/index.js` first, so the published bundle is always fresh.

Verify (what we already dry-ran with `npm pack`): a clean `npm install <pkg>` pulls
the five deps, links the `claude-photon-channel` bin, and the bin boots.

## 2. Host the marketplace (you)

This repo *is* the marketplace (`.claude-plugin/marketplace.json` lists `photon`).
Push it to GitHub, then anyone installs with:

```bash
claude plugin marketplace add <your-gh-user>/<this-repo>
claude plugin install photon@kennethlng-channels
```

(Local dev without hosting: `claude plugin marketplace add .` from the repo root —
already passes `claude plugin validate .`.)

## 3. Configure + run (end user)

Run `/photon:configure` in a Claude Code session (after installing the plugin) to
scaffold `~/.claude/channels/photon/.env` with the keys below and `chmod 600` it,
then open that file and fill in the values. Or create it by hand — the installed
channel reads config from `~/.claude/channels/photon/.env` (or the path in
`CHANNEL_ENV_FILE`):

```
SPECTRUM_PROJECT_ID=...
SPECTRUM_PROJECT_SECRET=...
WEBHOOK_PORT=8787
WEBHOOK_PUBLIC_URL=https://<your>.ngrok.app
SPECTRUM_WEBHOOK_SECRET=...
CHANNEL_ALLOWLIST=+15551234567
```

Then run a tunnel (`ngrok http 8787`), register the URL + secret in the Photon
dashboard, and start Claude Code:

```bash
claude --dangerously-load-development-channels plugin:photon@kennethlng-channels
```

## Caveats

- **Research-preview flag:** until Anthropic allowlists the channel, users must launch
  with `--dangerously-load-development-channels` even when installed from your
  marketplace. An official listing requires coordinating with an Anthropic partner contact.
- **Config command (future):** a `/photon:configure` slash command could write the
  `.env` for users; not built yet.
- **ngrok:** the webhook path still needs a public tunnel. A future hosted relay
  (`apps/relay`) would remove that.
