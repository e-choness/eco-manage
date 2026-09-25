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
scripts/               seed.ts, seedReadings.ts (hourly demo data generator)
```

Modules: `health`, `auth`, `dashboard`, `analytics`, `alerts`, `devices`, `financial`,
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
pages/          Landing, Login, Register, Dashboard, Monitoring, Analytics, Optimization,
                Alerts, Financial, Settings
lib/            utils, alertEvents (header refresh + 30 s poll interval)
```

Routes: `/`, `/login`, `/register`, and `/dashboard` with the children `monitoring`, `analytics`,
`optimization`, `alerts`, `financial` and `settings`. `ProtectedRoute` waits for the session
restore before redirecting.

## Data

See [DATABASE.md](./DATABASE.md). Readings are hourly kWh values in `energyreadings`. Production
comes from solar and wind devices; site consumption is metered on the grid meter device. The
dashboard computes grid flow as consumption − production − battery discharge, where positive
means importing.

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
