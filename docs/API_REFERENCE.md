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
  | dashboard, analytics, alerts, device reads, site, `GET /optimization/recommendations` | owner, manager, installer |
  | financial, `POST /optimization/accept`, `POST /optimization/dismiss` | owner, manager |
  | `POST/PATCH/DELETE /devices` | installer |
  | `/auth/me`, `/auth/password`, `/auth/profile` | any signed-in user |

  v1 data is still stored per user; the role only decides access.
- Rate limits per client IP per minute: 300 on `/api/*`, and 10 on login, register and refresh.
  Over the limit: `429 {"error":{"code":429,"message":"Too many requests, try again later."}}`.
- Unknown routes: `404 {"error":{"code":404,"message":"Not found"}}`.
- Energy values are kWh (hourly readings) and power values kW. Money is in dollars.

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

## Dashboard `/api/dashboard` 🔒

### `GET /overview`
Readings dated after now are ignored. Day and month boundaries are UTC.

```json
{
  "totalProduction": 3046.89,     // kWh, last 30 days
  "currentPower": 4.67,           // kW, production in the latest hour
  "dailyProduction": 101.56,      // kWh/day, 30-day average
  "monthlyProduction": 2419.5,    // kWh, calendar month to date
  "todayProduction": 23.09,       // kWh since midnight
  "productionChangePct": 11.19,   // today vs yesterday up to the same time; null if no baseline
  "systemStatus": "optimal",      // optimal | warning (≥50% working) | critical | unknown (no devices)
  "weatherCondition": "sunny",
  "temperature": 22,
  "savings": 365.63,              // $, last 30 days at an assumed $0.12/kWh
  "carbonOffsetKg": 1523.45       // kg CO₂, last 30 days at 0.5 kg/kWh
}
```

Online and charging devices count as working for `systemStatus`.

### `GET /energy-flow`
All readings at the latest hour that isn't in the future.

```json
{ "solar": 0, "wind": 4.67, "battery": 0, "consumption": 3.14, "grid": -1.53, "timestamp": "2026-09-25T05:00:00.000Z" }
```

`grid = consumption − solar − wind − battery`: positive when importing, negative when exporting.
`timestamp` is `null` when there are no readings.

## Analytics `/api/analytics` 🔒

`?period=week|month|year` (default `month`; unknown values behave like `month`).

### `GET /production`
`200 {"period","data":[{"date":"2026-09-01","solar":2,"wind":3,"total":5}]}`, daily sums (UTC dates).

### `GET /consumption`
`200 {"period","data":[{"date":"2026-09-01","consumption":5}]}`

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

## Alerts `/api/alerts` 🔒

| Method | Path    | Body          | Success |
| ------ | ------- | ------------- | ------- |
| GET    | `/`     | —             | `200 {"alerts":[…]}` newest first |
| PUT    | `/read` | `{ alertId }` | `200` updated alert |

Errors: `400 {"error":"Missing alertId"}`, `404 {"error":"Alert not found"}`.

## Optimization `/api/optimization` 🔒

| Method | Path               | Body                   | Success |
| ------ | ------------------ | ---------------------- | ------- |
| GET    | `/recommendations` | —                      | `200 {"recommendations":[…]}`, pending and accepted, sorted by the priority string (so `medium` sorts before `high`; P3-03 replaces this module) |
| POST   | `/accept`          | `{ recommendationId }` | `200` recommendation with `status: "accepted"` |
| POST   | `/dismiss`         | `{ recommendationId }` | `200` recommendation with `status: "dismissed"` |

Errors: `400 {"error":"Missing recommendationId"}`, `404 {"error":"Recommendation not found"}`.

## Financial `/api/financial` 🔒

`?period=6months|year` (default `year`; anything else behaves like `year`).

### `GET /overview`
```json
{ "totalSavings": 300, "monthlyRevenue": 40.28, "roi": 3.51, "paybackPeriod": 4.38, "maintenanceCosts": 30 }
```
ROI and payback assume a fixed $10,000 investment. The spec replaces this with owner-entered
install cost in a later phase. With no records, every field is `0`.

### `GET /history`
`200 {"period","data":[{"id","date","savings","revenue","costs","category"}]}`, newest first.

## Server errors

Each v1 route answers unexpected failures with its own `500` body, for example
`{"error":"Failed to fetch alerts"}` or `{"message":"Failed to get user"}`.

## Site (v2) `/api/site` 🔒 all roles

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

A `: heartbeat` comment is sent every 20 s. Events published while the snapshot is being built are
held back and sent right after it.
