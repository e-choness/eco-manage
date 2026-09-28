# Development setup

Everything runs in Docker: the services, the tests, the linters and the builds. You don't install
Node, pnpm or any package on your computer.

## Start the stack

```bash
git clone https://github.com/e-choness/eco-manage.git
cd eco-manage
docker compose up -d
docker compose run --rm mongo-seed      # demo accounts and site
```

The source is mounted into every container at `/repo`, and each service runs in watch mode, so a
saved change restarts it (the watchers poll, because Windows mounts don't pass file events; allow
about a second). `node_modules` live in the image, in volumes of their own, so the host never needs
them.

| Service | Address | What it is |
| ------- | ------- | ---------- |
| web | <http://localhost:5173> | Vite dev server; proxies `/api` to the API and `/cdn` to object storage |
| api | <http://localhost:3000> | Express API, `tsx watch` |
| ingest, rules, worker | | The background services, `tsx watch` |
| simulator | <http://localhost:4100/sim/state> | The simulated Maple Grove School and its control API |
| mailpit | <http://localhost:8025> | Every email the stack sends |
| objects | <http://localhost:9001> | Object storage console (user `ecomanage`, password `ecomanage-dev-secret`) |
| mongodb, redis | `localhost:27017`, `localhost:6379` | |
| mosquitto | `localhost:18883` | MQTT over TLS (8883 inside the network; some Windows hosts reserve 8883) |
| gotenberg, modelconv | | PDF printing and the 3D converter, reachable by the worker only |

Profiles add more: `docs` (this site, on <http://localhost:5174/eco-manage/>), `gateway` (the
gateway agent and stand-in devices), `e2e` (Playwright) and `tools` (the seed).

The repository also has a dev container (`.devcontainer/`) that builds and seeds the same stack,
for GitHub Codespaces or VS Code.

## Repository layout

```text
apps/
  api/          REST API and live stream (Express 5, Mongoose 9)
  web/          The web app (React 19, Vite 8, Tailwind 4, three.js)
  ingest/       MQTT → readings, device status, 15-minute intervals, live events
  rules/        Alerts, recommendations and commands
  worker/       Bills, savings, statements, emails, exports, reports, forecasts, 3D uploads (BullMQ)
  simulator/    The simulated site: a gateway with weather, loads, EV sessions and faults
  gateway/      The edge agent for a Raspberry Pi: Modbus, OCPP, buffer, commands
  modelconv/    The sandboxed 3D model converter
packages/
  shared/       Types, zod schemas, MQTT topics, tariff and billing maths, site time, solar and weather models
  db/           Mongoose models and the object store client
  profiles/     Device profiles and the gateway-side safety checks
  recs/         Recommendation rules and their runner
docs/           This site (VitePress)
infra/          Development compose file, broker config and certificates, the deploy stack
e2e/            Playwright smoke and accessibility tests
Dockerfile      Production images (app, web)
Dockerfile.dev  The development image for the whole workspace
```

It's a pnpm workspace (`pnpm-workspace.yaml`). The packages are consumed as TypeScript source (no
build step); the services run with `tsx`, and the web app is bundled by Vite.

## Everyday commands

```bash
docker compose exec api pnpm -r typecheck
docker compose exec api pnpm -r lint
docker compose exec api pnpm knip                               # unused files, exports, dependencies
docker compose exec api pnpm -r --workspace-concurrency=1 test
docker compose exec api pnpm --filter @ecomanage/web test       # one package
docker compose --profile e2e run --rm e2e                       # Playwright, against the running stack
docker compose logs -f ingest                                   # a service's log
docker compose run --rm mongo-seed                              # reset the demo data
```

From Git Bash on Windows, prefix `MSYS_NO_PATHCONV=1` to any command with a `/repo/…` path, so it
isn't rewritten.

## Driving the simulator

```bash
curl localhost:4100/sim/state                                          # time, weather, battery, faults
curl -X POST localhost:4100/sim/clock -H 'content-type: application/json' -d '{"speed":30}'
curl -X POST localhost:4100/sim/faults -H 'content-type: application/json' \
  -d '{"type":"gateway-offline","minutes":20}'
curl -X DELETE localhost:4100/sim/faults
```

See [Simulator](./simulator.md) for every fault and what it does.

## Adding a dependency

```bash
# 1. edit the package.json of the app or package
# 2. refresh the lockfile without installing on the host
docker run --rm -v "$PWD":/repo -w /repo node:26-alpine \
  sh -c "npm install -g pnpm@12.6.0 && pnpm install --lockfile-only"
# 3. rebuild the dev image and recreate the containers with fresh node_modules volumes
docker compose build
docker compose up -d --force-recreate -V
```

pnpm 12 refuses releases less than a day old and runs install scripts only for packages listed
under `allowBuilds` in `pnpm-workspace.yaml`. See
[Troubleshooting](../deploy/troubleshooting.md#pnpm-refuses-a-package-minimumreleaseage-or-a-build-script-ignored-builds).

## Next

- [Architecture](./architecture.md): the services and how data moves between them.
- [Testing](./testing.md) and [Contributing](./contributing.md).
