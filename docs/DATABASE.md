# Database

MongoDB 7, database `ecomanage`. Every document belongs to one user (`userId`); v1 has no sites
or roles yet (P1-03 adds `sites` and `memberships`). Schemas are in
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

## Planned changes

The v2 data model (sites, memberships, time-series telemetry, 15-minute intervals, tariffs,
commands, audit events) replaces `energyreadings`, `weathers` and `financialrecords` in Phase 1
(P1-03, P1-10).
