# Deployment

**There is no production deployment setup yet.** The only supported way to run EcoManage is the
Docker Compose dev stack described in the [README](../README.md). This page lists what exists and
what production still needs. The v2 plan (P1-01) builds `infra/docker-compose.yml` for the full stack.

## What exists

| Piece              | State                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| `Dockerfile.dev`   | Dev image for the whole workspace. Source is bind-mounted; not for production. |
| Web build          | `pnpm --filter @ecomanage/web build` → static files in `apps/web/dist`. |
| API build          | `build` type-checks; the API runs TypeScript directly with `tsx` (`pnpm --filter @ecomanage/api start`). |
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
| `OVERPASS_URL`         | no       | `https://overpass-api.de/api/interpreter` | Building outlines from OpenStreetMap for the generated site model; empty turns the lookup off. Heavy use of the public server needs your own instance |
| `MQTT_URL`             | no       | —             | The broker (TLS). Without it, gateway config is queued and gateways can't be claimed |
| `MQTT_CERT_DIR`        | no       | `/repo/infra/mosquitto/certs` | `ca.crt`, `svc-api.crt` and `svc-api.key` |
| `MQTT_CA_KEY`          | no       | `MQTT_CERT_DIR/ca.key` | The CA key (PKCS#8) that signs claimed gateways' certificates (P5-04). Without it, a claim waits. Keep it off every other machine |

The placeholder secrets in `apps/api/.env.example` are for local development only.

## Production still needs

1. A production image without dev dependencies.
2. The web `dist/` served behind the same origin as `/api` (or `CORS_ORIGINS` set to the web
   origin). The refresh cookie is `SameSite=Strict` and scoped to `/api/auth`, so a same-site
   setup is the simplest.
3. HTTPS, with `NODE_ENV=production` so the refresh cookie is `Secure`.
4. `trust proxy` is set to one hop (`app.ts`). Adjust it if more than one proxy sits in front of
   the API, or rate limiting sees the proxy's IP.
5. Managed MongoDB and Redis, with backups for MongoDB.
6. Gateways (P5-04): a production CA for the broker, a bootstrap certificate for the gateway image
   (its ACL allows only the claim topics), `gateway:register` in the factory, and certificate
   revocation (a CRL for the broker) for gateways that are replaced or lost. See
   [GATEWAY.md](./GATEWAY.md).
