# Testing

All suites run inside the dev container. As of P5-05 (Node 26, Vitest everywhere): **api 364, web 95, ingest 29, simulator 32, rules 43, recs 33,
shared 163, profiles 20, db 11, worker 71, gateway 41, modelconv 13**, all passing. Lint and typecheck also pass. The api,
ingest, db, worker and rules suites need the compose MongoDB (and Redis for api, ingest, rules and the worker's report schedules; the worker's SMTP test uses Mailpit, and its PDF test prints through Gotenberg when it is running).

```bash
docker compose up -d mongodb redis          # the API integration tests need MongoDB
docker compose run --rm api pnpm -r test    # both apps
docker compose run --rm api pnpm -r lint
docker compose run --rm api pnpm -r typecheck
```

Every change should pass all four gates (`build`, `lint`, `typecheck`, `test`).

## API (`apps/api`, Vitest + supertest)

```bash
docker compose run --rm api pnpm --filter @ecomanage/api test
docker compose run --rm api pnpm --filter @ecomanage/api test src/__tests__/security.test.ts
docker compose run --rm api pnpm --filter @ecomanage/api test:coverage   # 55% global threshold
```

| Suite                                  | What it checks                                                    |
| -------------------------------------- | ----------------------------------------------------------------- |
| `routes.contract.test.ts`              | Every v1 endpoint through `createApp()`: status codes, bodies, auth guard. Models are stubbed via `mongoose.model(name)` |
| `integration/*.test.ts`                | Against a **real MongoDB** (and Redis): role matrix over every route, an audit inventory (`audit.test.ts`: every write route lists its audit action, or why it has none, and each action is checked by a test), invites (token only hashed, single use, expiry, existing accounts), gateway jobs (scan, commission) and the maintenance log with a stub gateway, history series and totals (daily sums, hours, quarter hours, fallback over 400 bars, compare, no money for installers), exports and reports, people (access until a local date, last owner kept, invites revoked) and rules (settings checked, decline counts), the site model saved as versions, migration, site snapshot and SSE stream, v2 devices, P0-05 fixes still in use |
| `security.test.ts`                     | Refresh cookie flags and rotation, logout revocation, 429 limits, CORS, helmet, no credentials in logs |
| `middleware/auth.test.ts`              | `requireUser`: 401 cases, and DB errors passed to the error handler |
| `routes/authRoutes.test.ts`            | Auth routes with a mocked user service                            |
| `services/userService.test.ts`, `utils/*` | User service, JWT and bcrypt helpers                           |
| `config/database.test.ts`              | Connection handling                                               |
| `models/*`, other `routes/*` | Mostly exercise their own mocks rather than app code; the contract and integration suites are the ones that protect behaviour |

### Integration tests

Files under `src/__tests__/integration/` connect to `MONGO_TEST_URL` (default
`mongodb://mongodb:27017`). Each file uses its own database, `ecomanage_test_<name>`, and drops it
before and after. They only fake `Date`, so the Mongo driver's timers keep working.
`countQueries()` in `integration/db.ts` counts queries per collection, for tests about query
patterns.

## Web (`apps/web`, Vitest + Testing Library + MSW)

```bash
docker compose run --rm --no-deps api pnpm --filter @ecomanage/web test
docker compose run --rm --no-deps api pnpm --filter @ecomanage/web test:watch
```

| Suite                                  | What it checks                                                  |
| -------------------------------------- | --------------------------------------------------------------- |
| `AuthContext.test.tsx`                 | Session restore from the cookie, in-memory token, refresh-and-retry on 401, logout |
| `pages/Login.test.tsx`                 | App v2 sign-in: fields, landing Home or the page asked for, server message on failure, no sign-up |
| `pages/InviteAccept.test.tsx`          | Invite link: new account (name, 8+ character password), existing account (its password), used/expired/unknown links |
| `routes.test.tsx`                      | Old `/dashboard/…` addresses redirect to the top-level ones |
| `pages/Home.test.tsx`                  | App v2 Home: flows (2D fallback in jsdom) and the flows table, demand, bill (not for installers), battery, Needs you with approve and decline-with-reason, price strip with the next peak, empty states |
| `siteLive.test.ts`                     | Stream events applied to the snapshot, SSE parser |
| `pages/Bills.test.tsx`                 | App v2 Bills: 12-month figures, bars and rows, open and closed periods (lines, tariff versions, estimated stretches, saving), statement and CSV downloads, Open in History, owner upload (the upload call is replaced: jsdom files can't pass through msw) and typed total, range spending |
| `pages/History.test.tsx`               | App v2 History: range text, warnings, totals (5, or 4 for installers), estimated bars, compare deltas, views and cap line, preset and resolution requests, CSV export through the worker, report builder and list |
| `pages/Devices.test.tsx`               | App v2 Devices: list order, live power (loads positive), statuses and summary; detail (24 h, model, quality, commissioning, log, last message); proposing a reserve change and an action with `until`; installers: read-only controls, visit notes, scan → add → commission, commissioning a pending device |
| `pages/Settings.test.tsx`              | App v2 Settings: sticky bar saves only changed fields to each endpoint, drafts across tabs and discard, rules and approval, roles (installer hardware only, tariff and people hidden), tariff strip, live gap check and the server's 422, people actions, site model anchors, notifications with quiet hours together |
| `pages/Inbox.test.tsx`                 | App v2 Inbox: list with counts and paging; decision (sections, slider re-checks once after 300 ms, Approve off on a failing check, approve with params, decline with a reason, installers without buttons, declined outcome); alert (acknowledge, pause, fix, false-alarm and cause forms, email link); command (timeline, cancel early, not for installers) |
| `shell/AppShell.test.tsx`              | App v2 shell: rail by role (no Bills for installers), Inbox badge from counts then stream `inbox` events, saved theme applied and a switch saved on the user, avatar menu (role from the membership, Profile, Sign out), no-site screen |

`src/__tests__/setup.ts` starts an MSW server (base `http://localhost:3000`), mocks `localStorage`
and `matchMedia`, and stubs `ResizeObserver` (jsdom has none). If a page lists `toast` as an effect
dependency, mock `useToast` with a stable function (`vi.hoisted`). A new `vi.fn()` on every render
makes the effect loop forever.

## 3D model converter (`apps/modelconv`)

In the dev container the converter's glTF tests run with the rest (the ones that need assimp,
IfcOpenShell or toktx are skipped there). All of them run in the converter's own read-only image:

```bash
docker compose run --rm --no-deps -e HOME=/tmp modelconv sh -c "cp vitest.config.mjs /tmp/ && node_modules/.bin/vitest run --config /tmp/vitest.config.mjs"
```

They build their inputs in code (boxes, a 320,000-triangle terrain, an OBJ, an ASCII FBX made by
assimp, a hand-written IFC4 wall) and check units, centring, simplifying, KTX2 sizes, Draco, the
thumbnail, the isolation of each conversion and every rejection reason.

## Gateway agent (`apps/gateway`)

Runs with the rest in the dev container. Its devices are fakes on localhost: a SunSpec inverter and
a CT meter served over real Modbus TCP (`src/bench/fakeDevices.ts`), and OCPP chargers over a real
WebSocket. The cloud is a stand-in link, and claiming is checked against a test CA with the same
proof the API verifies. They cover register decoding and scale factors, the scan, commissioning
checks, the buffer (order, resend, 7 days, restarts), every command limit, undoing on time and after
15 minutes offline, and the OCPP messages and charging profiles.

The whole flow against the real broker and API: `docker compose --profile gateway up -d gateway
gateway-devices` (docs/GATEWAY.md), then claim, scan and commission from the app.

## End-to-end (`e2e/`, Playwright)

A smoke test runs against the compose stack (P1-12). It needs the demo seed and the running
simulator:

```bash
docker compose run --rm mongo-seed          # once
# a fresh site has no bill until its first interval is priced; make the current one now
docker compose exec worker pnpm --filter @ecomanage/worker bills:refresh
docker compose --profile e2e run --rm e2e
```

It signs in as the demo manager, lands on Home (the live view), checks the site name and the
"Live" badge, waits for a newer grid-meter reading within 10 s (it compares reading timestamps,
because one-decimal kW values can repeat) and checks that every simulated device is live. A
second test checks that signed-out visitors are sent away from Home. The `e2e` image pins
Playwright 1.63. Reports and traces go to `e2e/playwright-report` and `e2e/test-results`.

An accessibility spec (P4-09, `a11y.spec.ts`, `@axe-core/playwright`) signs in once at 1024 x 768
and visits every page and Settings tab in both themes, moving in the app rather than reloading
(each reload spends an `/api/auth/refresh` call, and auth calls are rate limited to 10 a minute).
On each page it checks there is no horizontal scroll and runs axe with the WCAG 2 A and AA rules,
which include text contrast of at least 4.5:1. It then checks the keyboard: the rail links, device
rows, the skip link, the Settings tabs (arrow keys, Home, End) and the table alternative to the
site picture. It restores the theme the demo manager started with.

## Continuous integration (`.github/workflows/ci.yml`)

Pushes to `main` and every pull request run the same gates in the same images, so nothing is
installed on the runner:

- **checks:** build the images, start the services the tests use, then typecheck, lint, every
  suite one package at a time, the web build, the converter's tests in its read-only image, and
  `pnpm audit --audit-level=moderate`. Service logs are printed when a step fails.
- **e2e:** the whole stack with the demo seed and its current bills, then the Playwright smoke and accessibility specs.
  The report and traces are uploaded when it fails.

## Dependencies

- `pnpm audit` must stay clean (it is a CI step). Two overrides in `pnpm-workspace.yaml` keep it
  so: a single `@types/express` (5), and `uuid` 11 under `exceljs`.
- pnpm 12 refuses releases under a day old and runs install scripts only for packages named in
  `allowBuilds` (esbuild today). See TROUBLESHOOTING.md if a change trips either.
- Dependabot (`.github/dependabot.yml`) proposes weekly updates for npm, the Dockerfiles, the
  compose images and the Actions, two days after a release. It skips TypeScript 6.1 and later
  (typescript-eslint doesn't support them yet) and `@types/node` majors (they follow the Node
  version of the images, 26).
