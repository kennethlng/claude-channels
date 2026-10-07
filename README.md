# claude-channels

A pnpm/Turborepo monorepo for building developer tools around [Claude Code
Channels](https://code.claude.com/docs/en/channels) — the research-preview
feature that lets external messaging platforms push events into, and receive
replies from, a running Claude Code session.

## What's here

### `apps/channel` — iMessage bridge for Claude Code

The main project in this repo. `channel` is a Claude Code channel (an MCP
server that runs over stdio alongside a Claude Code session) that bridges the
session to iMessage via [Photon Cloud](https://app.photon.codes) and the
[Vercel Chat SDK](https://chat-sdk.dev). It lets you text a running Claude
Code session from iMessage and — the primary feature — **approve or deny the
session's tool-use permission prompts from your phone** instead of only from
the local terminal.

See [`apps/channel/README.md`](apps/channel/README.md) for setup,
configuration, the `--dangerously-load-development-channels` caveat, and local
testing instructions (no Photon account or phone required to try it out).

The product is split across one app and three packages, so the Claude Code
"channel half" and the messaging "integration half" meet only through a shared
contract (the seam that keeps a future hosted relay or new integration a drop-in):

- `apps/channel` — the composition root: loads config and wires an integration to the channel, started over stdio by Claude Code.
- [`@repo/contract`](packages/contract) — the `ChannelBridge` interface, DTOs, verdict grammar, and the `Logger`/`Config` types. Zero dependencies; everything else depends only on this.
- [`@repo/core`](packages/core) — the Claude Code channel half: MCP server, `ChannelCore` routing, permission-request tracking, logger. Never imports an integration.
- [`@repo/integrations`](packages/integrations) — the messaging half: the iMessage/Photon integration, the local `DevBridge`, and shared helpers. Never imports core.

The design and implementation are documented in
[`docs/superpowers/specs/`](docs/superpowers/specs/) and
[`docs/superpowers/plans/`](docs/superpowers/plans/).

### Scaffolding from `create-turbo`

The rest of the repo is unmodified [Turborepo](https://turborepo.dev/)
starter scaffolding, kept around for the shared tooling it provides:

- `apps/web`, `apps/docs`: stub [Next.js](https://nextjs.org/) apps from the
  starter template — not part of this project's actual functionality.
- `@repo/ui`: a stub React component library shared by `web` and `docs`.
- `@repo/eslint-config`: `eslint` configurations (includes `@next/eslint-plugin-next` and `eslint-config-prettier`).
- `@repo/typescript-config`: `tsconfig.json`s used throughout the monorepo, including by `apps/channel`.

Each package/app is 100% [TypeScript](https://www.typescriptlang.org/).

### Utilities

This Turborepo has some additional tools already setup for you:

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Prettier](https://prettier.io) for code formatting

### Build

To build all apps and packages, run the following command:

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed (recommended):

```sh
cd my-turborepo
turbo build
```

Without global `turbo`, use your package manager:

```sh
cd my-turborepo
npx turbo build
pnpm exec turbo build
pnpm exec turbo build
```

You can build a specific package by using a [filter](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters):

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed:

```sh
turbo build --filter=docs
```

Without global `turbo`:

```sh
npx turbo build --filter=docs
pnpm exec turbo build --filter=docs
pnpm exec turbo build --filter=docs
```

### Develop

To develop all apps and packages, run the following command:

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed (recommended):

```sh
cd my-turborepo
turbo dev
```

Without global `turbo`, use your package manager:

```sh
cd my-turborepo
npx turbo dev
pnpm exec turbo dev
pnpm exec turbo dev
```

You can develop a specific package by using a [filter](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters):

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed:

```sh
turbo dev --filter=web
```

Without global `turbo`:

```sh
npx turbo dev --filter=web
pnpm exec turbo dev --filter=web
pnpm exec turbo dev --filter=web
```

### Remote Caching

> [!TIP]
> Vercel Remote Cache is free for all plans. Get started today at [vercel.com](https://vercel.com/signup?utm_source=remote-cache-sdk&utm_campaign=free_remote_cache).

Turborepo can use a technique known as [Remote Caching](https://turborepo.dev/docs/core-concepts/remote-caching) to share cache artifacts across machines, enabling you to share build caches with your team and CI/CD pipelines.

By default, Turborepo will cache locally. To enable Remote Caching you will need an account with Vercel. If you don't have an account you can [create one](https://vercel.com/signup?utm_source=turborepo-examples), then enter the following commands:

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed (recommended):

```sh
cd my-turborepo
turbo login
```

Without global `turbo`, use your package manager:

```sh
cd my-turborepo
npx turbo login
pnpm exec turbo login
pnpm exec turbo login
```

This will authenticate the Turborepo CLI with your [Vercel account](https://vercel.com/docs/concepts/personal-accounts/overview).

Next, you can link your Turborepo to your Remote Cache by running the following command from the root of your Turborepo:

With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed:

```sh
turbo link
```

Without global `turbo`:

```sh
npx turbo link
pnpm exec turbo link
pnpm exec turbo link
```

## Useful Links

Learn more about the power of Turborepo:

- [Tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks)
- [Caching](https://turborepo.dev/docs/crafting-your-repository/caching)
- [Remote Caching](https://turborepo.dev/docs/core-concepts/remote-caching)
- [Filtering](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters)
- [Configuration Options](https://turborepo.dev/docs/reference/configuration)
- [CLI Usage](https://turborepo.dev/docs/reference/command-line-reference)
