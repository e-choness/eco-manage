# 002 — `pnpm --filter @ecomanage/api start` can't run the compiled output

Found: 2026-09-24, during P0-01. Existed before the monorepo move.

## What
`apps/api` is `"type": "module"` and imports use no file extension (`import x from './app'`).
`tsc` emits those specifiers unchanged, and Node's ESM loader requires extensions, so
`node dist/server.js` fails with `ERR_MODULE_NOT_FOUND`. Dev works because `tsx` resolves them,
and the old Vercel build used its own bundler.

## Impact
No production start path for the API outside `tsx`. Docker dev is unaffected.

## Options
1. Bundle for production (e.g. `tsup`/`esbuild`) — adds a dependency; note it in the PR.
2. Switch to `moduleResolution: NodeNext` and add `.js` to every relative import.
3. Run `tsx` in production (simplest, slower cold start).

Worth deciding before P1-01, which adds more Node apps (ingest, rules, worker, simulator).
