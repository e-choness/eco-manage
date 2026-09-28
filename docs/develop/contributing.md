# Contributing

EcoManage is proprietary (see `LICENSE`); contributions need the owner's agreement. This page is
how changes are made.

## Setup

Docker is the only requirement: see [Development setup](./index.md). Don't install packages on
your computer; run every command through `docker compose exec api …`.

## Changes

- **One change per branch and pull request,** small enough to review. The description says what
  changed, why, and how it was checked (test output, or a screenshot for anything visible).
- **The gates pass:** typecheck, lint, knip, the tests, the web and docs builds, and the audit
  ([Testing](./testing.md)).
- **Tests come with the change:** a behaviour that isn't tested isn't done.
- **Something broken that isn't part of your change** gets its own issue, not a fix in passing.

## Code

- **Layers in the API:** route → controller → service. Routes only wire middleware; controllers
  parse input with zod and call one service; services have no Express types
  ([API](./api.md#layers)).
- **Every write to site data is audited,** and every site route checks the role with
  `requireRole` ([Extending](./extending.md#a-new-api-endpoint)).
- **Shared code for shared rules:** anything that must give the same answer in two places (tariff
  maths, safety checks, recommendation checks, sign conventions) lives in a package, not in two
  copies.
- **Types:** TypeScript strict. No `any` in source (test mocks are exempt), no untyped `req.body`.
- **Logging:** the service's pino logger, not `console`. Never log tokens, passwords, cookies,
  keys or request bodies.
- **Dependencies:** explain any new one in the pull request. pnpm refuses releases less than a day
  old; don't work around it.
- **No TODOs without an issue link.**
- **Comments** say why, not what.

## Docs and changelog

- **Docs describe what exists,** in plain words. Update them in the same pull request as the
  behaviour: the [user guide](../guide/index.md) for anything people see, [Deploy](../deploy/index.md)
  for settings and operations, this section for how it works, and the
  [reference](../reference/api.md) for contracts. Preview with
  `docker compose --profile docs up -d docs` at <http://localhost:5174/eco-manage/>; merging to
  `main` publishes the site. The docs build fails on a broken link.
- **Changelog:** add what users will notice (features, changes, fixes) under *Unreleased* in
  `CHANGELOG.md`, in plain words. Internal refactoring stays out.

## Commits

An imperative subject line that says what the change does, then a body with what changed, why,
and how it was checked. Keep unrelated changes in separate commits.
