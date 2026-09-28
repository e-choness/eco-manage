# Troubleshooting

Problems seen while running the Docker Compose dev stack, with their fixes.

### `Cannot find package 'x'` after adding a dependency

The containers keep `node_modules` in anonymous volumes, and `--force-recreate` alone reuses them.
Rebuild the image and renew the volumes:

```bash
docker compose build
docker compose up -d --force-recreate -V api web
```

`docker compose run --rm …` always starts with fresh volumes from the image, so tests can pass
while the long-running `api` container still fails.

### The API exits with `Invalid environment: …`

A required variable is missing or malformed. Compose loads `apps/api/.env.example` and then
`apps/api/.env`, so check any overrides in `.env`. See the table in
[DEPLOYMENT.md](./DEPLOYMENT.md#api-configuration).

### Integration tests fail with `Server selection timed out`

`src/__tests__/integration/*` need MongoDB. Start it first (`docker compose up -d mongodb`), and run
the tests with `docker compose run --rm api …`, not with `--no-deps` from outside the compose
network.

### `429 Too many requests` while developing

Login, register and refresh allow 10 requests per minute per IP. Wait a minute, or clear the
counters:

```bash
docker compose exec redis redis-cli FLUSHALL
```

### The browser is logged out after every reload

The session comes back through `POST /api/auth/refresh` using the `em_rt` cookie, which is scoped
to `/api/auth`. Check that:
- the page and the API share an origin (use the Vite dev server on :5173, which proxies `/api`);
- the browser keeps cookies for `localhost`;
- `CORS_ORIGINS` includes the page origin if you call the API from somewhere else.

### Port 8883 is not available

On some Windows hosts 8883 sits in a reserved port range, so the broker is published on
`localhost:18883` (override with `MQTT_HOST_PORT`). Containers use `mosquitto:8883`.

### Code changes are not picked up

Watchers poll (`CHOKIDAR_USEPOLLING`) because Windows bind mounts don’t deliver file events
reliably. Allow about a second for a change to register.

### Demand looks wrong right after the simulator restarted

The 15-minute interval that spans a restart may be off, because the restart fills the gap in
the counters with average power. The next interval is exact. If a counter goes backwards (a
meter replaced, or the simulator state volume removed), the live demand and that interval fall
back to power readings and are marked estimated.

### A web test hangs until the timeout

A page effect that lists `toast` as a dependency loops forever when a test's `useToast` mock
returns a new function on each render. Hoist a single `vi.fn()` (see TESTING.md).

### Git warns "LF will be replaced by CRLF"

This is Windows `core.autocrlf` at work, and it's harmless. Files are committed with the line
endings git normalises to.

### MongoDB won't start after pulling the new images ("Invalid featureCompatibilityVersion")

The stack moved from MongoDB 7 to 8 (September 2026). A data volume made by 7 must go through
8.0 once, then be raised to the running version:

```bash
docker compose stop mongodb
docker run -d --name mongo-fcv -v ecomanage_mongo_data:/data/db mongo:8.0
docker exec mongo-fcv mongosh --quiet --eval 'db.adminCommand({ setFeatureCompatibilityVersion: "8.0", confirm: true })'
docker rm -f mongo-fcv
docker compose up -d mongodb
docker compose exec mongodb mongosh --quiet --eval 'db.adminCommand({ setFeatureCompatibilityVersion: db.version().split(".").slice(0, 2).join("."), confirm: true })'
```

Or drop the volume and reseed (`docker compose down -v`, then `docker compose run --rm mongo-seed`).

### pnpm refuses a package ("minimumReleaseAge") or a build script ("ignored builds")

pnpm 12 refuses versions published in the last day and only runs install scripts listed under
`allowBuilds` in `pnpm-workspace.yaml`. Don't add `minimumReleaseAgeExclude` entries: lower the
version range floor to a release that is a day old, or wait. A new dependency that really needs
its install script is allowed by name in `allowBuilds`, with a comment saying why.

### An image build fails with `corepack: not found` (exit code 127)

Node 25 and later no longer ship corepack. The Dockerfiles install pnpm with
`npm install -g pnpm@<version>` instead; do the same in any script or `docker run` that used
`corepack enable`, with the version from `packageManager` in the root `package.json`.

### A claimed gateway stays "Waiting to connect"

- The gateway isn't asking yet: its log says "not claimed yet" once it reaches the broker with the
  bootstrap certificate. Check its network, clock and `mqttUrl`.
- The API has no CA key: its log says "No CA key" at start. Set `MQTT_CA_KEY` (or put `ca.key` in
  `MQTT_CERT_DIR`).
- The API log says "certificate request without a valid claim proof": the factory file on the
  gateway isn't the one registered for that serial. Register it again and replace the file.
- A gateway that was reset made a new key; a used code won't certify it. Register it again.

### The converter's tests fail with EROFS or "Failed to create Vitest API token"

Its container is read-only: run them with `-e HOME=/tmp` and the config copied to `/tmp` (the
command is in TESTING.md). On Git Bash, prefix `MSYS_NO_PATHCONV=1` so `/tmp` isn't rewritten.
