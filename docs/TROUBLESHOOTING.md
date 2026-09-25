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

### My data disappeared after `docker compose up`

`docker compose up` also runs `mongo-seed`, which deletes and recreates the demo accounts and their
data. Start only the services you need to keep your data: `docker compose up -d api web mongodb redis`.

### A web test hangs until the timeout

A page effect that lists `toast` as a dependency loops forever when a test's `useToast` mock
returns a new function on each render. Hoist a single `vi.fn()` (see TESTING.md). Recharts pages
also need the `ResizeObserver` stub in `setup.ts`.

### `node dist/server.js` fails with `ERR_MODULE_NOT_FOUND`

Known issue, `bugs/002`: the compiled API uses extensionless ESM imports. Use `pnpm dev` (tsx).

### Git warns "LF will be replaced by CRLF"

This is Windows `core.autocrlf` at work, and it's harmless. Files are committed with the line
endings git normalises to.
