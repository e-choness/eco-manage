# Testing

All suites run inside the dev container. As of P4-07: **api 313, web 69, ingest 29, simulator 32, rules 43, recs 33,
shared 126, profiles 20, db 11, worker 53**, all passing. Lint and typecheck also pass. The api,
ingest, db, worker and rules suites need the compose MongoDB (and Redis for api, ingest and rules; the worker's SMTP test uses Mailpit).

```bash
docker compose up -d mongodb redis          # the API integration tests need MongoDB
docker compose run --rm api pnpm -r test    # both apps
docker compose run --rm api pnpm -r lint
docker compose run --rm api pnpm -r typecheck
```

Every change should pass all four gates (`build`, `lint`, `typecheck`, `test`).

## API (`apps/api`, Jest + ts-jest + supertest)

```bash
docker compose run --rm api pnpm --filter @ecomanage/api test
docker compose run --rm api pnpm --filter @ecomanage/api test -- src/__tests__/security.test.ts
docker compose run --rm api pnpm --filter @ecomanage/api test:coverage   # 55% global threshold
```

| Suite                                  | What it checks                                                    |
| -------------------------------------- | ----------------------------------------------------------------- |
| `routes.contract.test.ts`              | Every v1 endpoint through `createApp()`: status codes, bodies, auth guard. Models are stubbed via `mongoose.model(name)` |
| `integration/*.test.ts`                | Against a **real MongoDB** (and Redis): role matrix over every route, an audit inventory (`audit.test.ts`: every write route lists its audit action, or why it has none, and each action is checked by a test), invites (token only hashed, single use, expiry, existing accounts), gateway jobs (scan, commission) and the maintenance log with a stub gateway, history series and totals (daily sums, hours, quarter hours, fallback over 400 bars, compare, no money for installers), exports and reports, migration, site snapshot and SSE stream, v2 devices, P0-05 fixes still in use |
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
| `pages/Inbox.test.tsx`                 | App v2 Inbox: list with counts and paging; decision (sections, slider re-checks once after 300 ms, Approve off on a failing check, approve with params, decline with a reason, installers without buttons, declined outcome); alert (acknowledge, pause, fix, false-alarm and cause forms, email link); command (timeline, cancel early, not for installers) |
| `shell/AppShell.test.tsx`              | App v2 shell: rail by role (no Bills for installers), Inbox badge from counts then stream `inbox` events, saved theme applied and a switch saved on the user, avatar menu (role from the membership, Profile, Sign out), no-site screen |

`src/__tests__/setup.ts` starts an MSW server (base `http://localhost:3000`), mocks `localStorage`
and `matchMedia`, and stubs `ResizeObserver` for Recharts. If a page lists `toast` as an effect
dependency, mock `useToast` with a stable function (`vi.hoisted`). A new `vi.fn()` on every render
makes the effect loop forever.

## End-to-end (`e2e/`, Playwright)

A smoke test runs against the compose stack (P1-12). It needs the demo seed and the running
simulator:

```bash
docker compose run --rm mongo-seed          # once
docker compose --profile e2e run --rm e2e
```

It signs in as the demo manager, lands on Home (the live view), checks the site name and the
"Live" badge, waits for a newer grid-meter reading within 10 s (it compares reading timestamps,
because one-decimal kW values can repeat) and checks that every simulated device is live. A
second test checks that signed-out visitors are sent away from Home. The `e2e` image pins
Playwright 1.49.0. Reports and traces go to `e2e/playwright-report` and `e2e/test-results`.
