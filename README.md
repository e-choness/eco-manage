# 🌱 EcoManage

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20-43853d?logo=node.js)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ed?logo=docker)](https://www.docker.com/)

**Energy monitoring for a single site: production, consumption, devices, alerts and costs.**

![banner](./readme-img/banner-wide.jpg)

> **Status.** v2 Phase 1 (data backbone and simulator) is in place: sites and roles, MQTT over
> TLS, a simulated site, ingest into a time series with 15-minute intervals, and a live view over
> server-sent events. Money (tariffs, bills), the alert engine, recommendations with approvals and
> the App v2 interface come in the next phases of the plan in the design handoff
> (`IMPLEMENTATION_PLAN.md`). This README only describes what exists.

## What it does

- **Home (live view)**: power from solar, battery, grid, EV chargers and heat pump, the calculated
  building load, 15-minute demand so far and projected against the cap, the month's peak, battery
  charge and time left, and gateway status. Values update over a server-sent event stream.
- **Devices**: every device on the site with status (live, stale after 60 s without data, offline
  after 5 min), latest reading, profile, commissioning details, last raw message and a 24-hour
  chart. Installers can add, change and remove devices through the API.
- **Roles**: owner, manager and installer per site, enforced on the server for every route.
- **Simulator**: the demo site (Maple Grove School) runs as a simulated gateway with seeded
  weather, school-day loads, EV sessions, battery and heat pump, plus fault injection.
- **Optimization and Alerts**: the v1 recommendation and alert lists, until the rules engine
  (Phase 2–3) replaces them.
- **Account**: register, sign in, profile and password.

Power is in kW and energy in kWh. Timestamps are stored in UTC; site-local time comes from the
site's time zone.

## Quick start (Docker)

Everything runs in containers; you only need Docker.

```bash
git clone https://github.com/e-choness/EcoManage.git
cd EcoManage
docker compose up -d
```

| Service   | URL / port              |
| --------- | ----------------------- |
| Web app   | http://localhost:5173   |
| API       | http://localhost:3000   |
| MongoDB   | localhost:27017         |
| Redis     | localhost:6379          |
| MQTT (TLS)| localhost:18883         |
| Simulator | http://localhost:4100/sim/state |

Load the demo accounts and the demo site (this **resets** them, including the site's telemetry):

```bash
docker compose run --rm mongo-seed
```

The simulator starts feeding the demo site straight away. Sign in with any of these (password
`Demo1234!`):

| Email                     | Role on Maple Grove School |
| ------------------------- | -------------------------- |
| `demo@ecomanage.io`       | owner                      |
| `manager@ecomanage.io`    | manager                    |
| `installer@ecomanage.io`  | installer (until 31 Dec 2026) |

The API reads `apps/api/.env.example`, then `apps/api/.env` if it exists (gitignored), so a fresh
clone works with no setup. Put real secrets in `apps/api/.env`.

## Repository layout

```
apps/
  api/        Express + Mongoose API (modules/<name>/{routes,controller,service,model}.ts)
  ingest/     MQTT → telemetry time series, latest values, 15-minute intervals, live events
  worker/     BullMQ jobs: interval costs, bills, statement PDFs, utility bill reading
  rules/      alert checks on every reading (opens and auto-resolves alerts)
  simulator/  simulated site + gateway (MQTT topics, commands, jobs, fault injection)
  web/        React 18 + Vite + Tailwind + shadcn/ui client
packages/
  shared/     types, zod schemas, MQTT topics, units, sign rules, site-time and live helpers
  db/         Mongoose models for the v2 data model
  profiles/   device profiles (register maps, write limits, fixes)
infra/        docker-compose.yml (the root compose file includes it), Mosquitto config and ACL
e2e/          Playwright suite (outdated; replaced in P1-12)
docs/         architecture, API, database, testing and ops notes
```

The repo is a pnpm workspace. Shared TypeScript settings live in `tsconfig.base.json` and lint
rules in the root `eslint.config.js`.

## Common commands

Run everything inside the dev container:

```bash
# all checks (integration tests need the mongodb service running)
docker compose run --rm api pnpm -r typecheck
docker compose run --rm api pnpm -r lint
docker compose run --rm api pnpm -r test
docker compose run --rm api pnpm -r build

# one package
docker compose run --rm api pnpm --filter @ecomanage/api test
docker compose run --rm api pnpm --filter @ecomanage/web test

# reseed the demo data
docker compose run --rm mongo-seed
```

After changing dependencies, refresh the lockfile, rebuild the image, and recreate the containers
with fresh `node_modules` volumes (`-V`). Otherwise the old volumes keep the old packages:

```bash
docker compose build
docker compose up -d --force-recreate -V api web
```

The old npm entry points still work from the root as aliases: `pnpm server`, `pnpm client`,
`pnpm start`.

## Security

- The access token is kept in memory in the browser. The refresh token is an httpOnly,
  `SameSite=Strict` cookie scoped to `/api/auth`, rotated on every refresh and revoked on logout.
- CORS only allows origins listed in `CORS_ORIGINS`. `helmet` sets security headers.
- Rate limits are 300 requests/min per IP on `/api` and 10/min on login, register and refresh,
  stored in Redis so they hold across API instances.
- Request logs record method, path, status and duration only. Credentials are redacted.
- No `.env` file has ever been committed (checked across all history in P0-02).

## Documentation

| Document                                      | Contents                                        |
| --------------------------------------------- | ----------------------------------------------- |
| [Architecture](./docs/ARCHITECTURE.md)         | Layers, request flow, auth, tech stack          |
| [API reference](./docs/API_REFERENCE.md)       | Every endpoint with request and response shapes |
| [Database](./docs/DATABASE.md)                 | Collections, fields and indexes                 |
| [Testing](./docs/TESTING.md)                   | Test suites and how to run them                 |
| [Deployment](./docs/DEPLOYMENT.md)             | Configuration and what production needs         |
| [Contributing](./docs/CONTRIBUTING.md)         | Branches, commits, code rules                   |
| [Troubleshooting](./docs/TROUBLESHOOTING.md)   | Known problems and fixes                        |

## License

MIT, see [LICENSE](./LICENSE).
