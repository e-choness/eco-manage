# Architecture

This describes the code as it is after v2 Phase 0. The v2 target architecture (ingest, rules,
worker and simulator apps; MQTT; tariffs) is in the design handoff's `IMPLEMENTATION_PLAN.md` and
is added phase by phase.

## Overview

```mermaid
graph LR
    Browser["Browser<br/>React SPA (apps/web)"] -- "/api via Vite proxy<br/>Bearer token + refresh cookie" --> API["API<br/>Express (apps/api)"]
    API --> Mongo[("MongoDB 7")]
    API --> Redis[("Redis 7<br/>rate-limit counters")]
```

| Container    | Image / build          | Purpose                                   |
| ------------ | ---------------------- | ----------------------------------------- |
| `api`        | `Dockerfile.dev`       | `tsx watch` on `apps/api/src/server.ts`   |
| `web`        | `Dockerfile.dev`       | Vite dev server, proxies `/api` to `api`  |
| `mongodb`    | `mongo:7`              | Data store                                |
| `redis`      | `redis:7-alpine`       | Rate-limit store                          |
| `mosquitto`  | `eclipse-mosquitto:2`  | MQTT broker, TLS with client certificates, ACL per identity |
| `simulator`  | `Dockerfile.dev`       | Simulated demo site acting as its gateway over MQTT/TLS; control API on :4100 |
| `mqtt-certs` | `alpine`               | One-shot: generates the dev CA and certificates into `infra/mosquitto/certs` (gitignored) |
| `mongo-seed` | `Dockerfile.dev`       | One-shot demo data reset (profile `tools`, run on demand) |

The stack is defined in `infra/docker-compose.yml`. The source is bind-mounted into `/repo`. `node_modules` come from the image and sit in anonymous
volumes so the host never needs a local install.

## API (`apps/api/src`)

```
server.ts              env check, Redis, Mongo connection, listen
app.ts                 createApp(): middleware + module routers (used by tests too)
config/                env.ts (zod-validated), logger.ts (pino + redaction), database.ts
middleware/            auth.ts (requireUser), security.ts (CORS, helmet, rate limit, request log)
lib/http.ts            handle() wrapper, HttpError, parse() for zod, currentUser/userIdOf
utils/                 JWT, bcrypt and cookie helpers
modules/<name>/        routes.ts → controller.ts → service.ts → model.ts
scripts/               seed.ts / seedDemo.ts (demo data), migrate.ts / migrateV2.ts
```

Modules: `health`, `auth`, `site`, `devices`, `alerts`,
`optimization`.

### Layering rules

- **routes.ts** only wires middleware (`requireUser`) to controller functions.
- **controller.ts** parses `req.body`/`req.query` with zod, calls one service function and shapes
  the HTTP response. Each handler is wrapped in `handle(fallback, fn)`: a thrown `HttpError` becomes
  its status and body, anything else is logged and answered with the route's fallback error.
- **service.ts** holds the logic. It takes plain values (`userId`, inputs), returns data or `null`,
  and has no Express types.
- **model.ts** is the Mongoose schema.

### Request flow

```mermaid
sequenceDiagram
    participant W as Web client
    participant M as Middleware
    participant C as Controller
    participant S as Service
    participant DB as MongoDB
    W->>M: GET /api/alerts (Authorization: Bearer …)
    M->>M: helmet, CORS allow-list, rate limit (Redis), request log
    M->>M: requireUser: verify JWT, load user
    M->>C: req.user set
    C->>C: zod-parse input
    C->>S: listAlerts(userId)
    S->>DB: find + sort
    DB-->>S: documents
    S-->>C: data
    C-->>W: 200 JSON
```

### Authentication

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as API
    B->>A: POST /api/auth/login {email, password}
    A-->>B: 200 {user…, accessToken} + Set-Cookie em_rt (HttpOnly, SameSite=Strict, Path=/api/auth)
    Note over B: access token kept in memory only
    B->>A: GET /api/… Authorization: Bearer access
    A-->>B: 401 when the access token has expired
    B->>A: POST /api/auth/refresh (cookie sent automatically)
    A-->>B: 200 {accessToken, user} + rotated em_rt
    Note over B: page reload → same /refresh call restores the session
    B->>A: POST /api/auth/logout
    A-->>B: stored refresh token revoked, cookie cleared
```

- Access tokens last 1 day and refresh tokens 30 days. The user document stores the current
  refresh token, so a refresh with an older (rotated) one is rejected.
- Several requests that fail with 401 at once share a single refresh call in the client.
- `requireUser` answers 401 for a missing, invalid or expired token. A failed user lookup is a 500.

### Errors

v1 routes keep their original error bodies, `{ "error": "…" }` or `{ "message": "…" }` depending
on the module (see the API reference). New middleware errors use `{ "error": { "code", "message" } }`,
the v2 shape: 404 for unknown routes, 429 for rate limits, 500 for unhandled errors.

## Web client (`apps/web/src`)

```
api/            axios wrappers per module, types.ts (response shapes), api.ts (token + refresh)
contexts/       AuthContext: session restore, login/register/logout, user
components/     layout, header (alert badge), energy flow diagram, shadcn/ui in ui/
pages/          Landing, Login, Register, Live (home), Monitoring (devices), Optimization,
                Alerts, Settings
lib/            utils, alertEvents (header refresh + 30 s poll interval)
```

Routes: `/`, `/login`, `/register`, and `/dashboard` (the live view) with the children
`monitoring`, `optimization`, `alerts` and `settings`. `ProtectedRoute` waits for the session
restore before redirecting.

## Data

See [DATABASE.md](./DATABASE.md). Devices report power in the site sign convention (positive into
the switchboard: PV, battery discharge, grid import; loads negative) plus cumulative energy
counters. Readings land in the `telemetry` time series, and the 15-minute `intervals15` roll-up
holds energy per source and consumer, the building remainder and demand.

## Tech stack

| Area        | Choice                                                         |
| ----------- | -------------------------------------------------------------- |
| Runtime     | Node 20, TypeScript 5.6 (strict)                               |
| API         | Express 4, Mongoose 8, zod, pino, helmet, express-rate-limit + rate-limit-redis, ioredis, jsonwebtoken, bcryptjs |
| Web         | React 18, Vite 5, Tailwind 3, shadcn/ui (Radix), Recharts, axios, react-router 7 |
| Data        | MongoDB 7, Redis 7                                             |
| Tests       | Jest + ts-jest + supertest (API), Vitest + Testing Library + MSW (web) |
| Tooling     | pnpm 9 workspace, ESLint 9 flat config, Docker Compose         |

## Simulator (`apps/simulator`)

A stand-in for the site gateway (spec §7). It uses the same MQTT topics, certificate and command
handling as a real one, so the backend can't tell the two apart.

- `engine/`: deterministic physics per seed. Clear-sky solar for the site's latitude times a
  seeded daily cloud factor; school load profile from the calendar (terms, days off, opening
  hours); heat pump driven by temperature and SG-Ready mode; EV sessions (buses, staff cars)
  honouring current limits and schedules; battery with round-trip losses in self-consumption
  mode unless commanded. The grid meter is the remainder. Every device integrates its own
  energy counters.
- `gateway.ts`: publishes each device every 5 simulated seconds (once per real second above
  5×); buffers while the gateway is "offline" and resends in order in `{items}` batches; checks
  command expiry and profile write limits before acking; answers scan, commission and restart jobs.
- Faults (`POST /sim/faults {type, device?, minutes?}`): `device-offline`, `meter-gap`,
  `gateway-offline`, `command-rejected`, `output-drop`. A `reset` or `restart` command brings an
  offline device back. `DELETE /sim/faults` clears them, `POST /sim/clock {speed}` changes the
  speed (1–60), `GET /sim/state` shows time, weather, battery and faults.
- Start options: `--speed`, `--seed`, `--start` (or `SIM_SPEED`, `SIM_SEED`, `SIM_START`).
- Energy counters behave like real ones. They start from the site's average power since
  commissioning (14 Mar 2024). Counters and battery charge are saved every 30 s to
  `SIM_STATE_FILE` (the `simulator_state` volume in compose), and a restart resumes from them,
  adding average power for the downtime. Meter and inverter readings carry ±0.25% measurement
  noise; the counters integrate the true power.

With seed 42 on 24 Sep 2026, a school day, the uncontrolled 15-minute grid peak is 130 kW at
15:15, matching the App v2 peak-shaving story.

## Ingest (`apps/ingest`)

Subscribes with the `svc-ingest` certificate to telemetry, device status and gateway status for
every site (QoS 1, persistent session).

- Telemetry is checked against the zod schema, then against the device record: it must exist and
  belong to the site in the topic, and every field must be declared by its profile. Rejections
  are counted and logged.
- Duplicates are dropped on `(deviceId, ts)` with Redis `SET NX` markers kept for 8 days (longer
  than the 7-day gateway buffer).
- Readings more than 15 minutes old on arrival get `q: "backfilled"`.
- Rows are written to the `telemetry` time series in batches, every 500 ms or at 1000 rows.
  `latest:{deviceId}` in Redis holds the newest reading. The device's `lastSeenAt` is the
  receive time, and a stale or offline device goes back to `live` (pending devices stay pending).
- Every 10 s, devices silent for 60 s become `stale` and after 5 min `offline`.
- Gateway status goes to `gw:{siteId}` and device status to `status:{deviceId}` in Redis.

### 15-minute intervals (`apps/ingest/src/intervals.ts`)

Every 15 s ingest flushes its rows and rolls up each closed interval (30 s grace for readings in
flight) into `intervals15`, one row per site and quarter hour (upsert):

- Energy per device is the difference of its cumulative counters at the two boundaries. The last
  reading within 60 s before a boundary is carried forward to it using that reading's power.
- `grid`/`export` come from the meter's import/export counters, and `demandKw` = import kWh × 4.
  `pv`, `batt` (discharge minus charge), `ev` and `hp` come from their devices. `bld` is the
  remainder (grid − export + pv + batt − ev − hp), and `used` = pv − export.
- If a device has readings but no counter at a boundary, average power × 0.25 h is used and
  the interval is `estimated`. If the meter is silent for the whole interval, grid comes from
  the balance using the previous interval's building load (`estimated`).
- A reading stored for an interval that has already closed (a gateway resend) marks it dirty,
  and it is recomputed on the next pass; so is the following interval if it was estimated.
- After a restart it resumes from the last stored interval, or from the site's first reading,
  catching up at most a week at a time.

- Every write clears `costedAt`, so the worker prices the interval again.

## Worker (`apps/worker`, P2-03)

BullMQ on the compose Redis, queue `billing`, one job at a time:

- `cost-intervals`, every 60 s: prices each interval whose `costedAt` is null with the tariff
  version valid on its local date (`touSplit` of `grid` into `costCents.pk/md/op`, and
  `creditCents` = export × export rate), then recomputes the bill of each billing period it
  touched. An interval that ingest rewrote in the meantime stays pending (the update matches on
  `updatedAt`).
- `nightly-bills`, hourly at :05: for each site whose local time is 01:xx, recomputes the bills
  for the current and previous periods.

A bill (`bills`, one per site and period) is
`Σ energy × the version in force on each day + peak demand × demand rate + fixed fee − export credit`.
Energy lines are summed from exact values and rounded once per line, not per interval. Demand and
the fixed fee use the version in force on the period's last day (today, for an open period);
`peakKw` is the highest 15- or 30-minute demand (`periodPeak`). The bill also stores which
versions priced it, the share of `estimated` intervals and any intervals no tariff covers.

Savings (P2-04) compare each bill with the same site load bought entirely from the grid on the
same tariff. Per interval, load = grid − export + pv + batt, so the energy saving splits exactly
into **solar** (cost of pv − export at its period price, plus the export credit) and **battery
shifting** (signed cost of battery kWh: discharge at dear periods minus charge at cheap ones).
**Demand avoided** is the baseline peak (load × 4) minus the actual peak, at the demand rate.
`savedCents` is the sum of the three and `baselineCents` = `totalCents` + `savedCents`. Both stay
null until the site has 7 days (672) of intervals.

The `documents` queue (P2-05) runs on demand, two at a time:

- `statement`: renders the bill to PDF with pdfkit, stores it in GridFS (bucket `files`, metadata
  `{ siteId, kind, contentType }`) and remembers `{ fileId, renderedAt }` on the bill. The API waits
  for the result (up to 30 s) and serves the stored copy until the bill changes.
- `utility-bill`: reads an uploaded bill's total. It uses the PDF's text (unpdf) or the CSV
  template, sets `utility.status` to `done` with `diffCents` = ours − utility, or to `failed` so the
  owner can type the total in. A job for a file that a newer upload replaced does nothing.
  Recomputing a bill keeps `diffCents` in step with our total.

## Live view (P1-08)

```mermaid
sequenceDiagram
    participant GW as Simulator / gateway
    participant B as Mosquitto
    participant I as Ingest
    participant R as Redis
    participant A as API (any instance)
    participant W as Browser
    GW->>B: site/{site}/dev/{dev}/telemetry
    B->>I: (svc-ingest)
    I->>R: SET latest:{dev}, PUBLISH site:{site}:events (≤ 1 per device per 5 s, trailing)
    W->>A: GET /api/site/stream (fetch + Bearer)
    A->>W: event: snapshot
    R-->>A: message
    A->>W: event: telemetry / demand
```

The browser applies each event to the cached snapshot (react-query) with `applySiteEvent`, which
reuses the shared `siteFlows` / `batteryLive` functions, so its numbers match the API's.
Measured through the web dev server's proxy: telemetry reaches the browser about 0.66 s after
the simulator stamps it.
