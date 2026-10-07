// Bundles our own workspace code (@repo/contract|core|integrations) into one
// file, but leaves the real npm dependencies external — npm/npx installs those
// at the user's machine, so the gRPC/protobuf-heavy Photon stack is never bundled.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outfile: 'dist/index.js',
  banner: { js: '#!/usr/bin/env node' },
  // Everything in `dependencies` stays external (resolved from node_modules at
  // runtime). Only the unpublished @repo/* workspace packages get inlined.
  external: ['chat', '@photon-ai/*', '@chat-adapter/*', '@modelcontextprotocol/*', 'zod'],
})
