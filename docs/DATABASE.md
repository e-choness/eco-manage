# Database

MongoDB 7, database `ecomanage`. `users`, `alerts` and `recommendations` are v1 collections keyed
by user (their models are in `apps/api/src/modules/<module>/model.ts`; alerts and recommendations
are replaced in Phases 2–3). Everything else belongs to a site; see
[v2 collections](#v2-collections-packagesdb).

The indexes below are the ones Mongoose creates, read from a running database.

## users (`modules/auth/model.ts`)

| Field          | Type    | Notes                                                    |
| -------------- | ------- | -------------------------------------------------------- |
| `email`        | string  | required, lowercase, **unique**                          |
| `password`     | string  | bcrypt hash (validated as a hash); never returned        |
| `name`         | string  | optional, trimmed, ≤ 100 chars                           |
| `createdAt`    | Date    | immutable                                                |
| `lastLoginAt`  | Date    | updated on each password login                           |
| `isActive`     | boolean | default `true`                                           |
| `refreshToken` | string  | current refresh token, **unique, sparse**; never returned |

## alerts (`modules/alerts/model.ts`)

`userId`, `title`, `message`, `type` (`critical`, `warning`, `info`), `timestamp`, `read`,
`resolved`, timestamps. Indexes: `userId`, `timestamp`, `{userId, timestamp: -1}`.

## recommendations (`modules/optimization/model.ts`)

`userId`, `title`, `description`, `priority` (`high`, `medium`, `low`), `estimatedSavings`,
`difficulty` (`easy`, `medium`, `hard`), `category`, `status` (`pending`, `accepted`,
`dismissed`), timestamps. Indexes: `userId`, `{userId, status}`.

## Demo data (`apps/api/src/scripts/seedDemo.ts`)

`docker compose run --rm mongo-seed` deletes and recreates five demo users (password `Demo1234!`): `demo@` (owner), `manager@` and `installer@` on the demo site, plus `demo2@` and `demo3@` with empty sites of their own. `demo@` also gets the v1 alerts and recommendations. The demo site's devices are recreated and its telemetry and intervals are cleared; the simulator refills them.

## v2 collections (`packages/db`)

Added in P1-03. The Mongoose models live in `packages/db/src/models.ts` so the API and the
services share them. Plain types live in `packages/shared/src/models.ts`.

| Collection       | Key fields | Indexes |
| ---------------- | ---------- | ------- |
| `sites`          | name, address, tz, lat, lon, currency, billDay (1–28), demandCapKw, gatewayId | — |
| `memberships`    | userId, siteId, role (owner, manager, installer), until | {userId, siteId} unique, siteId |
| `invites`        | siteId, email, role, until, tokenHash, expiresAt, acceptedAt | tokenHash |
| `devices`        | siteId, type (pv, battery, meter, submeter, ev, heatpump, gateway), name, profileId, address, role, status (pending, live, stale, offline), ratedKw, capacityKwh, lastSeenAt, commissionedAt/By | siteId |
| `deviceProfiles` | id ("vendor-model@version"), vendor, model, protocol, deviceType, read[], write, states, faults, fixes, pollMs, reviewed | id unique |
| `telemetry`      | **time series**: ts, meta {siteId, deviceId}, p_kw and the standard fields, q (ok, stale, estimated, backfilled). Expires after 13 months | meta.deviceId+ts, meta.siteId+ts |
| `intervals15`    | siteId, start (UTC), pv, used, batt, grid, export, bld, hp, ev (kWh), demandKw, costCents, creditCents, quality, tariffVersion | {siteId, start} unique |
| `auditEvents`    | siteId, userId (null for system actions), action, target, before, after, ts | {siteId, ts: -1} |

`initModels()` creates the collections and syncs the indexes. The time-series collection has to be
created explicitly.

### Migration

`docker compose run --rm api pnpm --filter @ecomanage/api migrate` brings a v1 database to v2. It is
safe to run repeatedly:

1. v1 documents in `devices` (the ones with a `userId`) move to `legacy_devices`, which the v1
   modules now use (model `LegacyDevice`).
2. The v2 collections and indexes are created.
3. Every user without a membership gets a site named "<name>'s site" and an owner membership,
   recorded as an audit event. The site's time zone is UTC until the owner sets it.

The seed also builds the demo site (Maple Grove School, fixed id `650000000000000000000001`) with
its 10 devices. It gives `demo@` the owner membership, and `manager@` and `installer@` memberships
too; the installer's access ends on 31 Dec 2026. The fixture is in `packages/shared/src/demo.ts`.

## Retired v1 collections

`energyreadings`, `weathers`, `financialrecords` and `legacy_devices` were removed in P1-10; telemetry, forecasts (P2-10) and intervals × tariff (P2-03) replace them. `migrate -- --drop-legacy` deletes them from an existing database (the seed does this).
