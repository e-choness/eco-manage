# Contributing

## Setup

Docker is the only requirement. See the [README](../README.md#quick-start-docker). Don't install
packages on the host; run every command through `docker compose run --rm api …`.

## v2 plan tasks

Work follows the phased plan in the design handoff (`IMPLEMENTATION_PLAN.md`).

- **One task per branch and PR.** Branch `v2/<ID>-short-name` (for example `v2/P1-04-roles`),
  with a PR title starting with the ID.
- **Gates.** `pnpm -r build`, `lint`, `typecheck` and `test` must pass (see [TESTING.md](./TESTING.md)).
- **Show the acceptance criteria.** Put test output or a screenshot in the PR description.
- **Bugs outside the task's scope** go into `bugs/NNN-short-name.md` (gitignored, local only): what, impact, suggested fix.
  Don't fix them in the same PR.

## Code rules

- **Layering.** route → controller → service → model. Routes only wire middleware. Controllers
  parse input with zod and call one service. Services contain no Express types. See
  [ARCHITECTURE.md](./ARCHITECTURE.md#layering-rules).
- **Types.** TypeScript strict. No `any` in source files (test mocks are exempt in the lint config),
  and no untyped `req.body`.
- **Logging.** Use `logger` from `config/logger.ts`, not `console`. Never log tokens, passwords,
  cookies or request bodies.
- **Dependencies.** The plan lists the allowed additions. Explain anything else in the PR.
- **No TODOs without an issue link.**
- **Docs.** Update `docs/` when behaviour or contracts change. Docs describe only what exists.

## Adding dependencies

```bash
# 1. edit the package.json of the app
# 2. refresh the lockfile without installing on the host
docker run --rm -v "$PWD":/repo -w /repo node:20-alpine \
  sh -c "corepack enable && pnpm install --lockfile-only"
# 3. rebuild the dev image and recreate containers with fresh node_modules volumes
docker compose build
docker compose up -d --force-recreate -V api web
```

## Commits

Imperative subject line prefixed with the task ID, for example
`P0-03: Security hardening (CORS, helmet, rate limit, cookie auth, logs)`. The body says what
changed and why, and how it was verified.
