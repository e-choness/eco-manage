# API reference

Base URL: `http://localhost:3000` (the web dev server proxies `/api` there).

- JSON in, JSON out.
- 🔒 marks endpoints that need `Authorization: Bearer <accessToken>`. Without a token they
  return `401 {"message":"Unauthorized"}`; with a bad or expired one, `401 {"error":"Invalid or expired token"}`.
- **Roles (P1-04).** Every site route checks the caller's membership on the server
  (`requireRole`). The site is the one named in the `X-Site-Id` header, or else the caller's
  oldest active membership. Expired memberships (`until` in the past) count as none. No access
  or the wrong role: `403 {"error":{"code":403,"message":"…"}}`.

  | Endpoints | Roles |
  | --------- | ----- |
  | alerts, device reads, site, `GET /optimization/recommendations` | owner, manager, installer |
  | `POST /optimization/accept`, `POST /optimization/dismiss` | owner, manager |
  | `POST/PATCH/DELETE /devices` | installer |
  | `/auth/me`, `/auth/password`, `/auth/profile` | any signed-in user |

  v1 data is still stored per user; the role only decides access.
- Rate limits per client IP per minute: 300 on `/api/*`, and 10 on login, register and refresh.
  Over the limit: `429 {"error":{"code":429,"message":"Too many requests, try again later."}}`.
- Unknown routes: `404 {"error":{"code":404,"message":"Not found"}}`.
- Power is in kW and energy in kWh. Timestamps are UTC ISO strings.

## Health

| Method | Path    | Response                                    |
| ------ | ------- | ------------------------------------------- |
| GET    | `/`     | `200 {"message":"Welcome to EcoManage API!"}` |
| GET    | `/ping` | `200 {"message":"pong"}`                    |

## Auth `/api/auth`

The refresh token is only ever sent as the `em_rt` cookie (HttpOnly, SameSite=Strict,
Path=`/api/auth`, 30 days). Response bodies never contain it, or the password hash.

### `POST /login`
Body `{ email, password }`.
- `200` user fields + `accessToken`, and sets `em_rt`.
  `{"_id","email","name","isActive","createdAt","lastLoginAt","accessToken"}`
- `400 {"message":"Email and password are required"}`
- `400 {"message":"Email or password is incorrect"}`

### `POST /register`
Body `{ email, password, name? }`. Doesn't sign in; the web client calls `/login` next.
- `201` user fields
- `400 {"message":"Email and password are required"}`
- `400 {"message":"User with this email already exists"}`

### `POST /refresh`
No body. Reads the `em_rt` cookie, rotates it, and returns a new access token.
- `200 {"accessToken","user":{…}}` and a new `em_rt`
- `401 {"message":"Refresh token is required"}` (no cookie; a token in the body is ignored)
- `401 {"message":"Invalid refresh token"}` or `{"message":"Refresh token has expired"}` (cookie cleared)

### `POST /logout`
Revokes the session that owns the `em_rt` cookie and clears the cookie. Always `200 {"message":"User logged out successfully."}`.

### 🔒 `GET /me`
`200` user fields plus `memberships: [{ siteId, siteName, role, until }]` (active ones only).

### 🔒 `PUT /password`
Body `{ currentPassword, newPassword }`.
- `200 {"message":"Password updated successfully"}`
- `400 {"message":"Current password and new password are required"}`
- `400 {"message":"New password must be at least 6 characters"}`
- `400 {"message":"Current password is incorrect"}`

### 🔒 `PUT /profile`
Body `{ name? }` (trimmed; must not be blank if present).
- `200` user fields
- `400 {"message":"Name must be a non-empty string"}`

## Devices `/api/devices` 🔒 (v2, P1-09)

Scoped to the caller's site. Errors are `{ "error": { "code", "message" } }`. Writes are
installer-only and each one writes an audit event with before and after.

| Method | Path | Roles | Result |
| ------ | ---- | ----- | ------ |
| GET | `/` | all | `{ items: DeviceView[] }`: device fields plus `latest` reading and its `quality` |
| GET | `/:id` | all | `DeviceDetail`: adds `profile` (model, protocol, pollMs, write actions, fixes) and `commissionedBy` |
| GET | `/:id/telemetry?from&to&res` | all | `{ points, res, capped }`; see below |
| POST | `/` | installer | `201` new device, `status: "pending"` (after a scan). Body: type, name, profileId?, address?, role?, ratedKw?, capacityKwh? |
| PATCH | `/:id` | installer | rename / re-role / re-address / replace profile or ratings (name, profileId, address, role, ratedKw, capacityKwh only) |
| DELETE | `/:id` | installer | `204`. Telemetry is kept until it expires (13 months) |

- A `profileId` must exist and support the device type, or the request gets `400`. Unknown or
  malformed ids, and devices of another site, get `404`.
- **Telemetry:** `from`/`to` are ISO date-times (default: the last 24 h). `res` is `raw`,
  `1m`, `5m`, `15m` or `h` (default `h`). Each point has `ts` (bucket start), `p_kw`
  (average), `min_kw`, `max_kw`, `n` and `estimated`. If the resolution would give more than
  400 points, the next coarser one is used and `capped` is `true`. Over 400 hourly points
  (16 days) gets `400`.

## Alerts `/api/alerts` 🔒 all roles (v2, P2-08)

The rules service opens alerts and closes the ones whose condition clears (ARCHITECTURE, Rules).
These endpoints follow Backend Coverage §3. They record who is handling an alert, pause its
emails, send a remote fix, or close it with a cause. They can't hide a problem that is still
happening.

| Method | Path | Body | Result |
| ------ | ---- | ---- | ------ |
| GET | `/?state=open\|closed&limit=50&before=<iso>` | — | `{ items: AlertView[], counts: { open, closed } }`. `open` includes acknowledged alerts. Newest first; page with `before` = the last `openedAt` |
| GET | `/:id` | — | `AlertDetail`: the view plus `deviceName`, `ackBy`, `ackAt`, `snoozedUntil`, `resolution { cause, note, by, auto }`, `fixes [{ id, label }]` from the device profile, and `actions { ack, snooze, fix, resolve, falseAlarm }` |
| POST | `/:id/ack` | — | `AlertView` with state `ack`. `409` unless open |
| POST | `/:id/snooze` | — | Pauses emails for 24 h (`snoozedUntil`). `409` unless the condition is still true |
| POST | `/:id/resolve` | `{ cause, note? }` | `{ alert, mute }`, where cause is `Fixed on site`, `Known issue`, `Device replaced` or `False alarm` |
| POST | `/:id/fix` | `{ fixId }` | `202 { command }`: the profile's fix sent to the gateway as a Command |

- **Resolve** answers `409` (`details.condition: "active"`) while the condition is true, unless the
  cause is `False alarm`. A false alarm closes the alert anyway and creates a 7-day `ruleMutes`
  entry for the rule and device with `review: true` (its threshold is flagged for review). The
  answer is `mute: { until }`.
- The cause and note go to the device's maintenance log. `GET /api/devices/:id` shows the
  latest 20 entries as `maintenance`.
- **Fix** is offered while the condition is true and the device's profile lists fixes: OCPP
  soft reset, or the Modbus restart register. An unknown `fixId` answers `422`. The command
  expires after 2 minutes. If the broker can't be reached, the command is recorded as `failed`
  and the answer is `503` with `details.command`.
- Ingest records the gateway's ack on the command (`acked` or `failed`). If the device recovers,
  the rules service closes the alert.
- Every action is audited (`alert.ack`, `alert.snooze`, `alert.resolve`, `alert.false-alarm`,
  `alert.fix`) and published on the live stream (`alert`, and `command` for a fix).

## Optimization `/api/optimization` 🔒

| Method | Path               | Body                   | Success |
| ------ | ------------------ | ---------------------- | ------- |
| GET    | `/recommendations` | —                      | `200 {"recommendations":[…]}`, pending and accepted, sorted by the priority string (so `medium` sorts before `high`; P3-03 replaces this module) |
| POST   | `/accept`          | `{ recommendationId }` | `200` recommendation with `status: "accepted"` |
| POST   | `/dismiss`         | `{ recommendationId }` | `200` recommendation with `status: "dismissed"` |

Errors: `400 {"error":"Missing recommendationId"}`, `404 {"error":"Recommendation not found"}`.

## Server errors

Each v1 route answers unexpected failures with its own `500` body, for example
`{"error":"Failed to fetch alerts"}` or `{"message":"Failed to get user"}`.

## Site (v2) `/api/site` 🔒

### Settings (P2-06)

| Method | Path | Roles | Body → result |
| ------ | ---- | ----- | ------------- |
| GET | `/` | all | `SiteSettings`: id, name, address, tz, lat, lon, currency, billDay, demandCapKw, `pvArrays[]`, `battery { deviceId, usableKwh, maxKw, floorPct }` or null |
| PATCH | `/` | owner | Any of name, address, tz (IANA), lat, lon, currency (CAD, USD, EUR, GBP, AUD), billDay (1–28), demandCapKw → `SiteSettings` |
| PUT | `/pv-arrays` | owner, installer | The whole table `[{ id?, name, inverterId, kwp, tiltDeg (0–90), azimuthDeg (0–360, 180 = south) }]` → `SiteSettings`. New arrays get an id; `422` with `details.issues` if an `inverterId` isn't one of the site's inverters |
| PATCH | `/battery` | owner, installer | Any of usableKwh, maxKw, floorPct (≥ 10) → `SiteSettings` + `gatewaySync: sent \| pending \| unchanged` |
| GET | `/gateway` | all | `{ id, online (reported in the last 90 s), fw, uptimeS, buffered, oldestBufferedTs, clockOffsetMs, lastSeenAt, bufferDays: 7, batteryFloorPct, configPending }` |

- Validation errors answer `400 { error: { code, message, details: { issues: [{ path, message }] } } }`.
- Usable capacity and maximum power are stored on the battery device. The floor is stored on the
  site and published to the gateway as the retained `site/{siteId}/config` message
  (`{ ts, batteryFloorPct }`). If the broker can't be reached, `gatewaySync` is `pending`, and the
  API sends the config again when it reconnects.
- Every change is audited: `site.update` records only the changed fields, and there are also `site.pv-arrays` and `site.battery`.


### `GET /snapshot`
Everything the live view needs on load (type `SiteSnapshot` in `@ecomanage/shared`):

- `site`: id, name, tz, currency, demandCapKw, billDay
- `devices[]`: id, name, type, status, profileId, ratedKw, capacityKwh, lastSeenAt, and `latest`
  (the newest reading, standard fields, site sign convention)
- `flows`: kW per source/consumer from readings under 60 s old: `pv`, `battery` (+ discharge),
  `grid` (+ import, `null` if the meter is stale), `ev`, `heatpump` (negative = consuming),
  `building` (calculated remainder, `null` without the meter), and `stale` device ids
- `battery`: socPct, reservePct, usableKwh, pKw, minutesLeft ((SoC − reserve) × usable × SoH ÷ kW;
  `null` unless discharging)
- `demand`: current 15-minute interval: `soFarKw` (meter import since the interval start),
  `projectedKw` (if the current power holds), `quality` (`estimated` without a meter reading
  near the start)
- `monthPeak`: highest `intervals15.demandKw` in the current billing period
- `gateway`: online (reported within 90 s), buffered, fw

`503` if the API runs without Redis.

### `GET /stream`
Server-sent events. Send the access token in `Authorization`: `EventSource` can't, so the web
client reads the stream with `fetch`. Events:

| event       | data |
| ----------- | ---- |
| `snapshot`  | a `SiteSnapshot`, always first |
| `telemetry` | `{ type, deviceId, reading }`, at most one per device every 5 s |
| `demand`    | `{ type, demand: { intervalStart, soFarKw, projectedKw }, quality }` |
| `device`    | `{ type, deviceId, status }` when a device goes live, stale or offline |
| `alert`     | `{ type, alert: AlertView }` when an alert opens, resolves, counts a repeat, or someone acts on it (P2-07, P2-08) |
| `command`   | `{ type, commandId, deviceId, status }` when a command is sent, acked or fails (P2-08) |

A `: heartbeat` comment is sent every 20 s. Events published while the snapshot is being built are
held back and sent right after it.

## Tariffs `/api/tariffs` 🔒 (P2-01)

| Method | Path | Roles | Result |
| ------ | ---- | ----- | ------ |
| GET | `/` | owner, manager | `{ items: Tariff[] (newest first), current: version in force today }` |
| GET | `/templates` | owner | `{ items: [{ id, name, tariff }] }`: Commercial TOU-D and Flat |
| POST | `/` | owner | `201` new version (previous + 1). Body below |

Body (`tariffInput` in `@ecomanage/shared`): `name`, `validFrom` (local date), `seasons[]`
(`{ id, name, fromMonth, toMonth }`, where a range may wrap the year end, e.g. Nov–Mar), `periods[]`
(`{ name, season: id | "all", days: weekdays | weekends | all, start, end, rateCents }`),
`demandRateCents` (per kW per billing period), `demandIntervalMin` (15 or 30), `exportRateCents`,
`fixedCents` (per period) and `holidays` (`{ dates[], treatAs: weekend | weekday }`).

- Times are local `HH:mm`. An end at or before the start means midnight: `00:00`–`00:00` is the
  whole day. Periods don't wrap past midnight, so an overnight rate is written as two periods.
- Every month and day type must be covered exactly once. Otherwise:
  `422 { error: { code: 422, message, details: { issues: [{ kind: gap | overlap | unknown-season |
  season-overlap | valid-from, message, months?, days?, from?, to? }] } } }`.
- `validFrom` may not be before the start of the current billing period, so a closed bill never
  changes. Rates are cents per kWh (fractions allowed); money totals are whole cents.
- The version in force on a day is the one with the latest `validFrom` on or before it.

## Calendar `/api/calendar` 🔒 (P2-06)

| Method | Path | Roles | Result |
| ------ | ---- | ----- | ------ |
| GET | `/` | all | `{ terms[], daysOff[], open, close, weekends, updatedAt }` |
| PUT | `/` | owner, manager | Replaces the calendar with the same shape (without `updatedAt`) |

- `terms` and `daysOff` are `[{ name, start, end }]` in local dates, with start ≤ end. They are stored in start order.
- `open` and `close` are the weekday opening hours (`HH:mm`, open before close).
- `weekends` is `closed` or `open`.
- A site without a calendar answers with an empty one (weekends closed, 08:00–17:00).
- A day is in use if it is in a term, is not a day off, and is not a weekend (unless weekends are open). The shared helper is `calendarDayType`.
- The load forecast (P2-10) reads the calendar.
- Changes are audited as `calendar.update`.

## Notifications `/api/me/notifications` 🔒 all roles (P2-09)

The signed-in person's email settings for this site (App v2 Settings → Notifications).

| Method | Path | Result |
| ------ | ---- | ------ |
| GET | `/notifications` | `{ email, alerts, daily, recs, failures, quietFrom, quietTo, escalateMin }` |
| PATCH | `/notifications` | Any of those fields → the saved settings; audited as `notifications.update` |

- **Defaults:** email goes to the sign-in address, everything is on, quiet hours are 22:00–06:30, and escalation is after 30 min.
- **Quiet hours:** `quietFrom`/`quietTo` are local `HH:mm` and are set together; `null` for both turns quiet hours off.
- **`escalateMin`:** 5 to 1440.
- **Command failures:** always on for owners and managers. `failures: false` from either answers `422`.

## Bills `/api/bills` 🔒 (P2-03 to P2-05)

The worker computes one bill per billing period (see ARCHITECTURE, Worker). Money is whole cents.

| Method | Path | Roles | Result |
| ------ | ---- | ----- | ------ |
| GET | `/` | owner, manager | `{ items: BillSummary[] (newest first), kpis }` |
| GET | `/range?from=YYYY-MM-DD&to=YYYY-MM-DD` | owner, manager | Spending for local dates (at most 366 days) |
| GET | `/:period` | owner, manager | Bill detail (`period` is `YYYY-MM`, the month the period starts in) |
| GET | `/:period/statement` | owner, manager | Statement PDF (`attachment; filename="statement-<period>.pdf"`) |
| POST | `/:period/utility-bill` | owner | Utility bill: a file is read by the worker (`202`); a typed-in total is stored (`200`) |

**BillSummary**: `period`, `start`, `end` (UTC), `inProgress`, `days { elapsed, total }`,
`totalCents`, `projectedCents` (open period only: energy and export credit so far scaled to the
whole period, plus demand at today's peak and the fixed fee), `lines { energyPkCents,
energyMdCents, energyOpCents, demandCents, fixedCents, exportCreditCents }`, `peakKw`, `peakAt`,
`savedCents` (null until 7 days of data), `estimatedShare` and `utility` (below, or null).

**kpis**: `last12 { totalCents, from, to }` over the last 12 closed periods, `saved12Cents`,
`peak12 { kw, period, demandCents }`, `utilityDiffPct` (mean |ours − utility| / utility, in percent)
and `compared` (how many closed bills have a utility total).

**Detail** adds `energyKwh { pk, md, op, export }`, `gridKwh`, `tariff { version, name,
demandRateCents, fixedCents }` (the version for demand and fixed), `tariffVersions[]` (every
version that priced energy), `intervals`, `unpricedIntervals`, `estimated [{ start, end }]`
(contiguous estimated stretches), `savings { baselineCents, solarCents, batteryCents, demandCents,
baselinePeakKw }` and `computedAt`.

**Range** returns `energyCents`, the three energy `lines`, `exportCreditCents`, `gridKwh`,
`exportKwh`, `peak { kw, at }` (highest 15-minute demand), `tariffVersions`, `intervals`,
`estimatedShare` and `unpricedIntervals`. Each day is priced with the version in force that day.
It has no demand charge, because demand is charged once per billing period.

**Statement**: the worker renders it and it is kept in GridFS. The stored copy is served until the
bill is recomputed or a utility total arrives. `503` if the worker doesn't answer within 30 s.

**Utility bill**: `409` while the period is open.
- Multipart `file`, at most 10 MB, answers `202 { utility: { status: "processing", … } }`:
  - A PDF: the worker looks for "Total amount due", "Amount due", "Total due", "Balance due", "Total new charges" and then "Total".
  - A CSV template: a header with `total_due` (or `total`, `amount_due`) and optionally `period`.
  - Other types answer `415`.
- JSON `{ "totalCents": 149820 }` answers `200 { utility: { status: "manual", … } }`.
- `utility` is `{ status: processing | done | failed | manual, totalCents, diffCents (ours −
  utility), source: pdf | csv | manual, fileName, error, parsedAt }`. When extraction fails, the
  status is `failed` with an `error` asking the owner to type the total in.
- Both forms are audited (`bill.utility.upload`, `bill.utility.enter`).
