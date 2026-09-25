# Database

MongoDB 7, database `ecomanage`. The v1 collections below belong to one user (`userId`); the v2
collections at the end belong to a site. Schemas are in
`apps/api/src/modules/<module>/model.ts`.

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

## devices (`modules/devices/model.ts`)

| Field             | Type   | Notes                                              |
| ----------------- | ------ | -------------------------------------------------- |
| `userId`          | ObjectId | indexed                                          |
| `name`            | string | required                                           |
| `type`            | enum   | `solar`, `wind`, `battery`, `grid`                 |
| `status`          | enum   | `online` (default), `offline`, `charging`, `maintenance` |
| `currentOutput`   | number | ≥ 0; set by the seed, nothing updates it           |
| `maxOutput`       | number | required, ≥ 0 (kW)                                 |
| `efficiency`      | number | 0–100                                              |
| `lastMaintenance` | Date   | set on creation, nothing updates it                |
| timestamps        |        | `createdAt`, `updatedAt`                           |

## energyreadings (`modules/analytics/model.ts`)

Hourly energy per device.

| Field       | Type     | Notes                                               |
| ----------- | -------- | --------------------------------------------------- |
| `userId`    | ObjectId | required                                            |
| `deviceId`  | ObjectId | required, ref `Device`                              |
| `timestamp` | Date     | start of the hour, UTC                              |
| `value`     | number   | kWh for that hour, ≥ 0                              |
| `type`      | enum     | `production` (solar, wind) or `consumption` (site load, on the grid meter) |

Indexes: `userId`, `deviceId`, `timestamp`, `{userId, timestamp: -1}`, `{deviceId, timestamp: -1}`.

## alerts (`modules/alerts/model.ts`)

`userId`, `title`, `message`, `type` (`critical`, `warning`, `info`), `timestamp`, `read`,
`resolved`, timestamps. Indexes: `userId`, `timestamp`, `{userId, timestamp: -1}`.

## recommendations (`modules/optimization/model.ts`)

`userId`, `title`, `description`, `priority` (`high`, `medium`, `low`), `estimatedSavings`,
`difficulty` (`easy`, `medium`, `hard`), `category`, `status` (`pending`, `accepted`,
`dismissed`), timestamps. Indexes: `userId`, `{userId, status}`.

## financialrecords (`modules/financial/model.ts`)

One record per month: `userId`, `date`, `savings`, `revenue`, `costs` (all ≥ 0, dollars),
`category`, timestamps. Indexes: `userId`, `date`, `{userId, date: -1}`.

## weathers (`modules/dashboard/model.ts`)

One per user (`userId` **unique**): `condition` (`sunny`, `cloudy`, `rainy`, `stormy`, `snowy`),
`temperature`, `humidity`, `windSpeed`, `uvIndex`. Only the seed writes it.

## Demo data (`apps/api/src/scripts/seed.ts`)

`docker compose run --rm mongo-seed` deletes and recreates three demo users (`demo@`, `demo2@`,
`demo3@ecomanage.io`, password `Demo1234!`). Only `demo@ecomanage.io` gets data:

- 5 devices: Solar Panel A and B, Wind Turbine 1, Battery Storage, and a Grid Meter
- 365 days × 24 hourly readings for Solar A, Solar B, Wind (production) and the Grid Meter
  (consumption), ending at the current hour (35,040 readings)
- 4 alerts, 24 monthly financial records, recommendations, and one weather document

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

## Planned changes

The v2 data model (sites, memberships, time-series telemetry, 15-minute intervals, tariffs,
commands, audit events) replaces `energyreadings`, `weathers` and `financialrecords` in Phase 1
(P1-03, P1-10).
