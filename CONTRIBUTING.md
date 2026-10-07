# Contributing

Thanks for your interest! Issues and PRs are welcome.

## Prerequisites

- **Node.js >= 24** (the project runs TypeScript directly via Node's type
  stripping — there is no build step for development).
- **pnpm** (`packageManager` is pinned in `package.json`; `corepack enable` or
  install pnpm 11+).

## Setup

```bash
pnpm install
```

## Checks (what CI runs)

```bash
pnpm run lint          # eslint across the workspace
pnpm run check-types   # tsc --noEmit
pnpm test              # node --test across packages
```

Please make sure all three pass before opening a PR. Tests use Node's built-in
test runner; follow the existing test-first style where practical.

## Project layout

See the "How it's built" section of the [README](README.md). The key rule: the
Claude Code channel half (`@repo/core`) and the messaging half
(`@repo/integrations`) must never import each other — they meet only through
`@repo/contract`. New integrations are added under `@repo/integrations` as a new
`ChannelBridge` implementation.

## Releases

The npm package `@kennethlng/claude-photon-channel` publishes from CI on a `v*`
tag (see [`PUBLISHING.md`](PUBLISHING.md)). You don't need to publish to
contribute — just open a PR.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
