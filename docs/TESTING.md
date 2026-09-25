# Testing

All suites run inside the dev container. As of P2-03: **api 235, web 49, ingest 27, simulator 21,
shared 64, profiles 12, db 10, worker 10**, all passing. Lint and typecheck also pass. The api,
ingest, db and worker suites need the compose MongoDB (and Redis for api/ingest).

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
| `integration/*.test.ts`                | Against a **real MongoDB** (and Redis): role matrix over every route, migration, site snapshot and SSE stream, v2 devices, P0-05 fixes still in use |
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
| `pages/Login.test.tsx`, `Register.test.tsx` | Forms, validation, loading states                          |
| `pages/Live.test.tsx`, `Monitoring.test.tsx` | Live view from snapshot + stream (reducer, SSE parser), devices list and detail |
| `pages/p0-05-bugfixes.test.tsx`        | Dismissing a recommendation is saved |
| `components/DashboardHeader.test.tsx`  | Alert poll never faster than 30 s, refresh on the alerts-changed event |

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
