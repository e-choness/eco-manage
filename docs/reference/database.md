# Database

MongoDB 8, database `ecomanage`. The Mongoose models are in
[`packages/db/src/models.ts`](https://github.com/e-choness/eco-manage/blob/main/packages/db/src/models.ts)
(users in `apps/api/src/modules/auth/model.ts`), shared by the API and the services; the plain
types are in `packages/shared/src/models.ts`. `initModels()` creates the collections (the
time-series one has to be created explicitly) and their indexes; every service calls it at start.

Everything except `users` belongs to a site through `siteId`. Times are stored in UTC; local
dates (`YYYY-MM-DD`) and times (`HH:mm`) are in the site's time zone. Money is whole cents.

## users

| Field          | Type    | Notes                                                    |
| -------------- | ------- | -------------------------------------------------------- |
| `email`        | string  | required, lowercase, **unique**                          |
| `password`     | string  | bcrypt hash (validated as a hash); never returned        |
| `name`         | string  | optional, trimmed, ≤ 100 chars                           |
| `theme`        | string  | `dark`, `light` or null (follow the system)              |
| `createdAt`    | Date    | immutable                                                |
| `lastLoginAt`  | Date    | updated on each password login                           |
| `isActive`     | boolean | default `true`                                           |
| `refreshToken` | string  | current refresh token, **unique, sparse**; never returned |

## Collections

| Collection       | Key fields | Indexes |
| ---------------- | ---------- | ------- |
| `gateways`       | serial, claimKey (a hash of the one-time claim code; the code itself is never stored), model, siteId, claimedAt, claimedBy, csr {pem, fw, at} (the latest request with a valid proof), cert {serialNumber, pem, issuedAt, notAfter}. Registered by `gateway:register`; the site's gatewayId is the serial | {serial} unique, {siteId} |
| `sites`          | name, address, tz, lat, lon, currency, billDay (1–28), demandCapKw, gatewayId, pvArrays [{id, name, inverterId, kwp, tiltDeg, azimuthDeg}], batteryFloorPct (≥ 10, enforced by the gateway), gatewayConfigPending, explanations {provider, baseUrl, model, keyEnc (AES-256-GCM under SECRETS_KEY), keyHint, monthlyTokens, updatedAt, updatedBy} | — |
| `calendars`      | siteId, terms [{name, start, end}], daysOff [{name, start, end}], open, close (HH:mm), weekends (closed, open), updatedBy | siteId unique |
| `memberships`    | userId, siteId, role (owner, manager, installer), until | {userId, siteId} unique, siteId |
| `invites`        | siteId, email, role, until, tokenHash, expiresAt, acceptedAt | tokenHash |
| `devices`        | siteId, type (pv, battery, meter, submeter, ev, heatpump, gateway), name, profileId, address, role, status (pending, live, stale, offline), ratedKw, capacityKwh, lastSeenAt, commissionedAt/By | siteId |
| `deviceProfiles` | id ("vendor-model@version"), vendor, model, protocol, deviceType, read[], write, states, faults, fixes, pollMs, reviewed | id unique |
| `telemetry`      | **time series**: ts, meta {siteId, deviceId}, p_kw and the standard fields, q (ok, stale, estimated, backfilled). Expires after 13 months | meta.deviceId+ts, meta.siteId+ts |
| `intervals15`    | siteId, start (UTC), pv, used, batt, grid, export, bld, hp, ev (kWh), demandKw, costCents {pk, md, op}, creditCents, quality, tariffVersion, costedAt (null until the worker prices it) | {siteId, start} unique, costedAt |
| `tariffs`        | siteId, version, validFrom (local date), name, seasons, periods, demandRateCents, demandIntervalMin (15, 30), exportRateCents, fixedCents, holidays, createdBy | {siteId, version} unique |
| `bills`          | siteId, period (YYYY-MM), start, end, inProgress, lines {energyPk/Md/Op, demand, fixed, exportCredit}Cents, energyKwh, totalCents, peakKw, peakAt, tariffVersion, tariffVersions, intervals, estimatedShare, unpricedIntervals, savedCents and savings {baselineCents, solarCents, batteryCents, demandCents, baselinePeakKw} (null until 7 days of data), utility {status, totalCents, diffCents, source, fileId, fileName, error, uploadedBy, parsedAt}, statement {fileId, renderedAt}, computedAt | {siteId, period} unique |
| `files.files`, `files.chunks` | GridFS bucket `files`: uploaded utility bills and rendered statements; metadata {siteId, kind, contentType, period} | — |
| `alerts`         | siteId, deviceId, ruleId, severity, title, detail, state (open, ack, resolved), condition (active, cleared), openedAt, lastSeenAt, count, eventKeys, ackBy, ackAt, snoozedUntil, resolvedAt, resolution {cause, note, by, auto} | {siteId, deviceId, ruleId, state}; one open/acked per (siteId, deviceId, ruleId) (unique partial) |
| `ruleMutes`      | siteId, deviceId (null: whole site), ruleId, until, by, alertId, review (a false alarm flags the threshold) | {siteId, ruleId, until} |
| `maintenance`    | siteId, deviceId, at, by, source (visit, alert), text, alertId | {siteId, deviceId, at: -1} |
| `commands`       | siteId, deviceId, recommendationId, alertId, action, params, sendAt, expiresAt, revertAt, status (created, sent, acked, failed, verified, reverted, cancelled), sentAt, ackedAt, verifiedAt, failedAt, error, revertedAt, cancelledAt, cancelledBy, revertOf (a revert), revertParams, createdBy | {siteId, status}, {status, sendAt} |
| `notificationPrefs` | userId, siteId, email, alerts, daily, recs, failures, quietFrom, quietTo (HH:mm or null), escalateMin | {userId, siteId} unique |
| `ruleConfigs`    | siteId, ruleId (a recommendation rule, or `approval`), on, params, updatedBy | {siteId, ruleId} unique |
| `fleetVehicles`  | siteId, name, rfid (the charger idTag), capacityKwh, departure (local HH:mm) | {siteId, rfid} unique |
| `recommendations` | siteId, ruleId (or `manual`), dedupeKey, deviceId, action, params, title, window {start, end}, inputs [{label, value}], checks [{text, pass}], calc, expectedSavingCents, status (proposed, approved, declined, expired, sent, acked, verified, failed, reverted, cancelled), proposedAt, expiresAt, decidedBy, decidedAt, declineReason, commandId, actualSavingCents, actualCalc, measuredAt, createdBy, explanation {text, model, inputHash, createdAt} | {siteId, status}, dedupeKey; one open per (siteId, dedupeKey) (unique partial) |
| `llmUsage`       | siteId, month (YYYY-MM, UTC), inputTokens, outputTokens, requests: language-model tokens per site and month, against the site's budget | {siteId, month} unique |
| `forecasts`      | siteId, kind (pv, load), issuedAt, source, points [{ts, kw}] (48 h, 15 min), weather [{ts, tempC, cloud, storm}] (PV), profiles [{date, label, days}] (load), accuracy {mape, n, evaluatedAt} | {siteId, kind, issuedAt: -1}; expires after 30 days |
| `emails`         | key (unique claim), siteId, userId, kind (alert, escalation, daily, proposal, invite, export), alertId, to, subject, status (sending, sent), sentAt, messageId | key unique, {siteId, createdAt: -1} |
| `siteModels`     | siteId, version, source (generated, upload), generated {footprint [[x,z]…], storeys, storeyHeightM, roofRows, arrayTiltDeg, osm {wayId, name}} (null: the demo building; kept while an upload is shown), upload {}, hub [x,y,z], anchors [{key (pv, battery, grid, ev, heatpump), at, label}], buildingLabel, camera {view}. Home uses the latest version, or the demo scene until one is saved | {siteId, version} unique |
| `exports`        | siteId, userId, from, to (local dates), includeCost, status (queued, done, failed), fileId (GridFS, kind export), rows, error, large, emailedAt | {siteId, createdAt: -1}, {status, large, emailedAt} |
| `reports`        | siteId, createdBy, name, from, to, sections, format (pdf, csv, xlsx), schedule (once, weekly, monthly), recipients, notes, status (waiting, ready, failed), fileId, lastRunAt; last 24 files in files[] | {siteId, createdAt: -1} |
| `auditEvents`    | siteId, userId (null for system actions), action, target, before, after, ts | {siteId, ts: -1} |

## Files

Uploaded utility bills, rendered statements, exports and report files are in the GridFS bucket
`files`, with metadata `{ siteId, kind, contentType, period }`. Uploaded 3D models are in object
storage instead: originals under `uploads/` (private, removed once processed) and results under
`models/<random>/` (public).

## Redis

Nothing in Redis is needed for a restore; it rebuilds itself.

| Key or channel | Holds |
| -------------- | ----- |
| `latest:{deviceId}` | The newest reading |
| `status:{deviceId}`, `gw:{siteId}` | Device and gateway status |
| `site:{siteId}:events` | Live events: telemetry, demand, device, alert, command, inbox |
| `seen:{deviceId}:{ts}` | Duplicate markers, 8 days |
| `rl:*` | Rate-limit counters |
| `bull:*` | BullMQ queues and job schedulers |

## Retention

| Data | Kept |
| ---- | ---- |
| `telemetry` | 13 months |
| `forecasts` | 30 days |
| Report files | The last 24 per report |
| Everything else | Until deleted |

## Demo data

`docker compose run --rm mongo-seed` (`apps/api/src/scripts/seedDemo.ts`) deletes and recreates
five demo users (password `Demo1234!`): `demo@` (owner), `manager@` and `installer@` (until 31 Dec
2026) on Maple Grove School, plus `demo2@` and `demo3@` with empty sites of their own. It recreates
the demo site (fixed id `650000000000000000000001`, from `packages/shared/src/demo.ts`) with its 10
devices and clears its readings and intervals, which the simulator refills.

## Migrations

`pnpm --filter @ecomanage/api migrate` brings an existing database up to date and is safe to run
repeatedly; see [Operations](../deploy/operations.md#migrating-from-ecomanage-1).
