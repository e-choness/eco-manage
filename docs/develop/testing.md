# Testing

Every check runs in Docker, in the same images CI uses. Nothing is installed on your computer.

## The gates

Every change passes all of these (CI runs the same):

```bash
docker compose up -d                                              # the tests use MongoDB, Redis, Mailpit, Gotenberg
docker compose exec api pnpm -r typecheck
docker compose exec api pnpm -r lint
docker compose exec api pnpm knip                                 # no unused files, exports or dependencies
docker compose exec api pnpm -r --workspace-concurrency=1 test
docker compose exec api pnpm --filter @ecomanage/web build
docker compose exec api pnpm --filter @ecomanage/docs build       # the docs, with every link checked
docker compose exec api pnpm audit --audit-level=moderate
```

The suites, all Vitest: api, web, ingest, rules, worker, simulator, gateway, modelconv, and the
packages shared (with a 100% coverage threshold), db, profiles and recs. The api, ingest, db,
worker and rules suites need the compose MongoDB (and Redis for api, ingest, rules and the worker's
report schedules); the worker's email test uses Mailpit, and its PDF test prints through Gotenberg
when it's running. Run them one package at a time (`--workspace-concurrency=1`) so the database
suites don't compete.

## API

```bash
docker compose exec api pnpm --filter @ecomanage/api test
docker compose exec api pnpm --filter @ecomanage/api test src/__tests__/security.test.ts
docker compose exec api pnpm --filter @ecomanage/api test:coverage
```

| Suite | Checks |
| ----- | ------ |
| `integration/*.test.ts` | Against a real MongoDB and Redis: the role matrix over every route (`roles.test.ts`, `routes.ts`); the audit inventory (`audit.test.ts`: every write route lists its audit action or why it has none, and each action is checked); invites; gateway jobs and claims with a stub gateway; history, exports and reports; people and rules; the site model; alerts, recommendations, commands and the Inbox; bills and tariffs; the snapshot and live stream; explanations; migration |
| `security.test.ts` | Refresh cookie flags and rotation, sign-out, rate limits, CORS, helmet, no credentials in logs |
| `routes.contract.test.ts` | Status codes, bodies and the auth guard through `createApp()` |
| `middleware/*`, `services/*`, `utils/*` | `requireUser`, the user service, JWT and bcrypt helpers |

**Integration tests** connect to `MONGO_TEST_URL` (default `mongodb://mongodb:27017`). Each file
uses its own database, `ecomanage_test_<name>`, dropped before and after. They fake only `Date`,
so the MongoDB driver's timers keep working. `countQueries()` in `integration/db.ts` counts queries
per collection, for tests about query patterns.

## Web

```bash
docker compose exec api pnpm --filter @ecomanage/web test
docker compose exec api pnpm --filter @ecomanage/web test:watch
```

Testing Library with MSW standing in for the API. Each page has a suite: the shell (rail by role,
the Inbox badge from counts then stream events, the saved theme), sign-in and invites, Home (flows
in the 2D fallback, demand, bill, battery, "Needs you", the price strip), Devices (proposing
changes, the installer's scan, add and commission), History (ranges, totals, views, exports,
reports), Bills (periods, downloads, the utility bill), Inbox (decisions with re-checks, alerts,
commands) and Settings (the sticky bar, drafts, roles, the tariff's gap check, people, the model).
`siteLive.test.ts` covers applying stream events and the SSE parser.

`src/__tests__/setup.ts` starts an MSW server (base `http://localhost:3000`), mocks `localStorage`
and `matchMedia`, and stubs `ResizeObserver`. Two things to know:

- If a page lists `toast` as an effect dependency, mock `useToast` with one stable function
  (`vi.hoisted`); a new `vi.fn()` each render loops the effect forever.
- jsdom files can't pass through MSW: for uploads, mock the API call instead.

## 3D model converter

The converter's glTF tests run with the rest; the ones needing assimp, IfcOpenShell or toktx are
skipped there. All of them run in the converter's own read-only image:

```bash
docker compose run --rm --no-deps -e HOME=/tmp modelconv sh -c "cp vitest.config.mjs /tmp/ && node_modules/.bin/vitest run --config /tmp/vitest.config.mjs"
```

(On Git Bash, prefix `MSYS_NO_PATHCONV=1`.) They build their inputs in code and check units,
centring, simplifying, KTX2 sizes, Draco, the thumbnail, isolation and every refusal.

## Gateway agent

Runs with the rest. Its devices are fakes on localhost: a SunSpec inverter and a CT meter over real
Modbus TCP (`src/bench/fakeDevices.ts`) and OCPP chargers over a real WebSocket. The cloud is a
stand-in link, and claiming is checked against a test CA with the same proof the API verifies. They
cover register decoding and scale factors, the scan, the commissioning checks, the buffer (order,
resend, 7 days, restarts), every command limit, undoing on time and after 15 minutes offline, and
the OCPP messages and charging profiles.

The whole flow against the real broker and API: `docker compose --profile gateway up -d gateway
gateway-devices` ([Installing a gateway](../deploy/gateway.md#in-the-development-stack)), then
claim, scan and commission in the app.

## End-to-end

Playwright against the running stack, with the demo seed and its current bill:

```bash
docker compose run --rm mongo-seed
docker compose exec worker pnpm --filter @ecomanage/worker bills:refresh
docker compose --profile e2e build e2e      # the image holds the specs: rebuild after changing them
docker compose --profile e2e run --rm e2e
```

- **Smoke** (`smoke.spec.ts`): signs in as the demo manager, lands on Home, checks the site name and
  the live badge, waits for a newer grid-meter reading within 10 s (comparing timestamps, since
  one-decimal kW values can repeat), checks every simulated device is live, and visits Bills and
  the Inbox. A second test checks that signed-out visitors are sent to sign in and old addresses
  still work.
- **Accessibility** (`a11y.spec.ts`, `@axe-core/playwright`): signs in once at 1024 × 768 and
  visits every page and Settings tab in both themes, moving within the app rather than reloading
  (each reload spends a refresh call, and those are limited to 10 a minute). On each page: no
  horizontal scroll, and axe with the WCAG 2 A and AA rules (text contrast of at least 4.5:1
  included). Then the keyboard: rail links, device rows, the skip link, Settings' tabs, and the
  table alternative to the site picture.

`E2E_BASE_URL` points it at another address, for example a deployment. Reports and traces go to
`e2e/playwright-report` and `e2e/test-results`.

## Continuous integration

`.github/workflows/ci.yml`, on pushes to `main` and every pull request:

- **checks:** build the images, start the services the tests use, then typecheck, lint, knip, every
  suite one package at a time, the web build, the converter's tests in its own image, and the
  dependency audit. Service logs are printed when a step fails.
- **e2e:** the whole stack with the demo seed and its current bill, then both Playwright specs; the
  report and traces are uploaded on failure.

`docs.yml` builds and publishes this site, and `images.yml` the production images, on changes to
`main`.

## Dependencies

- `pnpm audit` must stay clean. Overrides in `pnpm-workspace.yaml` keep it so: one `@types/express`
  (5), `uuid` 11 under `exceljs`, and Vite 6.4.3 or later under VitePress.
- pnpm 12 refuses releases under a day old and runs install scripts only for packages in
  `allowBuilds`.
- Dependabot proposes weekly updates for npm, the Dockerfiles, the compose images and the Actions,
  two days after a release. It skips TypeScript 6.1 and later (typescript-eslint doesn't support
  them yet) and `@types/node` majors (they follow the images' Node, 26).
