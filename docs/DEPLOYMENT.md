# Deployment

**There is no production deployment setup yet.** The only supported way to run EcoManage is the
Docker Compose dev stack described in the [README](../README.md). This page lists what exists and
what production still needs. The v2 plan (P1-01) builds `infra/docker-compose.yml` for the full stack.

## What exists

| Piece              | State                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| `Dockerfile.dev`   | Dev image for the whole workspace. Source is bind-mounted; not for production. |
| Web build          | `pnpm --filter @ecomanage/web build` → static files in `apps/web/dist`. |
| API build          | `pnpm --filter @ecomanage/api build` compiles, but `node dist/server.js` fails on extensionless ESM imports (`bugs/002`). The API only runs under `tsx` today. |
| Vercel config      | Removed in P0-01 (v2 needs long-running services, Redis and MQTT).      |

## API configuration

The API validates its environment at startup (`apps/api/src/config/env.ts`) and exits with a list
of any invalid fields.

| Variable               | Required | Default       | Notes                                          |
| ---------------------- | -------- | ------------- | ---------------------------------------------- |
| `DATABASE_URL`         | yes      | —             | MongoDB connection string                      |
| `JWT_SECRET`           | yes      | —             | Access-token signing key (generate 32+ random bytes) |
| `REFRESH_TOKEN_SECRET` | yes      | —             | Refresh-token signing key, different from the above |
| `NODE_ENV`             | no       | `development` | `production` marks the refresh cookie `Secure` |
| `PORT`                 | no       | `3000`        |                                                |
| `CORS_ORIGINS`         | no       | empty         | Comma-separated browser origins allowed to call the API |
| `REDIS_URL`            | no       | —             | Without it, rate limits are per process        |
| `RATE_LIMIT_WINDOW_MS` | no       | `60000`       |                                                |
| `RATE_LIMIT_MAX`       | no       | `300`         | Per IP per window on `/api`                    |
| `AUTH_RATE_LIMIT_MAX`  | no       | `10`          | Per IP per window on login, register, refresh  |
| `LOG_LEVEL`            | no       | `info`        | pino level; `silent` in tests                  |

The placeholder secrets in `apps/api/.env.example` are for local development only.

## Production still needs

1. A runnable API build (`bugs/002`) and a production image without dev dependencies.
2. The web `dist/` served behind the same origin as `/api` (or `CORS_ORIGINS` set to the web
   origin). The refresh cookie is `SameSite=Strict` and scoped to `/api/auth`, so a same-site
   setup is the simplest.
3. HTTPS, with `NODE_ENV=production` so the refresh cookie is `Secure`.
4. `trust proxy` is set to one hop (`app.ts`). Adjust it if more than one proxy sits in front of
   the API, or rate limiting sees the proxy's IP.
5. Managed MongoDB and Redis, with backups for MongoDB.
