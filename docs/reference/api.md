# REST API

Every endpoint the web app uses; nothing is private to it. How the API is built is in
[API](../develop/api.md).

## Conventions

- **Base URL:** the app's own origin, under `/api` (in development `http://localhost:3000`, which
  the web dev server proxies). JSON in, JSON out.
- **Authentication:** 🔒 marks endpoints that need `Authorization: Bearer <accessToken>` from
  [sign-in](#auth-api-auth). Without a token they answer `401 {"message":"Unauthorized"}`; with a
  bad or expired one, `401 {"error":"Invalid or expired token"}`.
- **The site:** every site endpoint acts on the site named in the `X-Site-Id` header, or else the
  caller's oldest active membership. Expired memberships (`until` in the past) count as none.
- **Roles:** each section lists who may call each endpoint (`all` = owner, manager and installer).
  No access, or the wrong role: `403 {"error":{"code":403,"message":"…"}}`. The same rules in plain
  words: [Roles and access](../guide/roles.md).
- **Errors:** `{ "error": { "code", "message", "details"? } }`. Invalid input is `400` with
  `details.issues [{ path, message }]`. The auth endpoints answer `{ "message": "…" }` instead.
- **Rate limits** per visitor per minute: 300 on `/api/*`, and 10 on sign-in, refresh and invite
  links. Over the limit: `429 {"error":{"code":429,"message":"Too many requests, try again later."}}`.
- **Unknown routes:** `404 {"error":{"code":404,"message":"Not found"}}`.
- **Units:** power in kW, energy in kWh, money in whole cents (rates may have fractions).
  Timestamps are UTC ISO strings; local dates (`YYYY-MM-DD`) and times (`HH:mm`) are in the site's
  time zone. Shared types (named in the tables) are in `packages/shared/src/api/`.

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

There is no `POST /register`: EcoManage is invite-only, and accounts are created
by accepting an invite (`/api/invites`, below).

### `POST /refresh`
No body. Reads the `em_rt` cookie, rotates it, and returns a new access token.
- `200 {"accessToken","user":{…}}` and a new `em_rt`
- `401 {"message":"Refresh token is required"}` (no cookie; a token in the body is ignored)
- `401 {"message":"Invalid refresh token"}` or `{"message":"Refresh token has expired"}` (cookie cleared)

### `POST /logout`
Revokes the session that owns the `em_rt` cookie and clears the cookie. Always `200 {"message":"User logged out successfully."}`.

### 🔒 `GET /me`
`200` user fields (including `theme`: `"dark"`, `"light"` or `null`) plus `memberships: [{ siteId, siteName, role, until }]` (active ones only). The web app uses the first membership, as the API does.

### 🔒 `PUT /password`
Body `{ currentPassword, newPassword }`.
- `200 {"message":"Password updated successfully"}`
- `400 {"message":"Current password and new password are required"}`
- `400 {"message":"New password must be at least 6 characters"}`
- `400 {"message":"Current password is incorrect"}`

### 🔒 `PUT /profile`
Body `{ name?, theme? }`. `name` is trimmed and must not be blank if present; `theme` is `"dark"`, `"light"` or `null` (follow the system), saved per user by the theme toggle.
- `200` user fields
- `400 {"message":"Name must be a non-empty string"}`
- `400 {"message":"Theme must be dark, light or null"}`

## Devices `/api/devices` 🔒

Scoped to the caller's site. Errors are `{ "error": { "code", "message" } }`. Writes are
installer-only and each one writes an audit event with before and after.

| Method | Path | Roles | Result |
| ------ | ---- | ----- | ------ |
| GET | `/` | all | `{ items: DeviceView[] }`: device fields plus `latest` reading and its `quality` |
| GET | `/:id` | all | `DeviceDetail`: adds `profile` (model, protocol, pollMs, `writeActions`, `actions` with each action's description, params and limits, fixes), `commissionedBy` and `maintenance` (newest 20) |
| GET | `/:id/telemetry?from&to&res` | all | `{ points, res, capped }`; see below |
| POST | `/` | installer | `201` new device, `status: "pending"` (after a scan). Body: type, name, profileId?, address?, role?, ratedKw?, capacityKwh? |
| PATCH | `/:id` | installer | rename / re-role / re-address / replace profile or ratings (name, profileId, address, role, ratedKw, capacityKwh only) |
| DELETE | `/:id` | installer | `204`. Telemetry is kept until it expires (13 months) |
| POST | `/scan` | installer | Runs a `scan` job on the site's gateway and waits up to 20 s. `{ found: [{ address, modelCode, profileId, type, name }] }`: only devices the site doesn't have yet. Writes nothing. `503` without a broker, `504` when the gateway doesn't answer, `502` when the scan fails on it |
| POST | `/:id/commission` | installer | Runs a `commission` job (the gateway starts reading the device and checks live read, sign and energy balance; up to 30 s). `CommissionResult { ok, checks [{ name, pass }], error, device }`. On success the device goes `live` and records `commissionedAt`/`commissionedBy`; audited as `device.commission`. A failed check leaves it pending |
| POST | `/:id/maintenance` | installer | `{ text }` (3–500 characters) → `201 { at, source: "visit", text }` on the device's maintenance log; audited as `maintenance.create` |

- A `profileId` must exist and support the device type, or the request gets `400`. Unknown or
  malformed ids, and devices of another site, get `404`.
- **Telemetry:** `from`/`to` are ISO date-times (default: the last 24 h). `res` is `raw`,
  `1m`, `5m`, `15m` or `h` (default `h`). Each point has `ts` (bucket start), `p_kw`
  (average), `min_kw`, `max_kw`, `n` and `estimated`. If the resolution would give more than
  400 points, the next coarser one is used and `capped` is `true`. Over 400 hourly points
  (16 days) gets `400`.

## Alerts `/api/alerts` 🔒 all roles

The rules service opens alerts and closes the ones whose condition clears
([Rules](../develop/rules.md#alerts)). These endpoints record who is handling an alert, pause its
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

## Recommendations `/api/recommendations` 🔒

Decisions proposed by the rules service ([Rules](../develop/rules.md#recommendations)) or requested on the
Devices page. Nothing reaches a device until someone approves.

| Method | Path | Roles | Body → result |
| ------ | ---- | ----- | ------------- |
| GET | `/?state=open\|closed&limit=50&before=<iso>` | all | `{ items: RecommendationView[], counts: { open, closed } }`. Open means proposed, approved, sent or acked. Newest first |
| GET | `/:id` | all | `RecommendationDetail`: the view plus `inputs`, `checks`, `calc`, `decidedBy`, `decidedAt`, `declineReason`, `commandId`, the `payload` approving would send, and `canApprove` for the caller |
| POST | `/` | owner, manager | `{ deviceId, action, params, window: { start, end } }` → `201`, a manual request (`ruleId: "manual"`) with its checks |
| POST | `/:id/check` | owner, manager | `{ params? }` → `{ checks, expectedSavingCents, calc, allPass }` for the action as adjusted (e.g. the kW slider). Writes nothing |
| POST | `/:id/approve` | owner, manager, per Settings → Rules → Who can approve | `{ params? }` → `{ recommendation, commandId }` |
| POST | `/:id/decline` | owner, manager | `{ reason }` (3–500 characters) → the declined recommendation |
| POST | `/:id/explain` | owner, manager | No body (anything sent is ignored) → `RecommendationExplanation { text, model, createdAt, cached, budget { usedTokens, monthlyTokens } }`: a plain-language explanation written by a language model from the server's own proposal only. Stored with a hash of its input; asking again returns it (`cached: true`, no tokens) until the proposal changes. `429` once the site's monthly token budget is used, `503` when no model is configured, `502` if the model declines or answers empty. Audited as `recommendation.explain` when a new one is written. The detail (`GET /:id`) carries `explanation { text, model, createdAt } \| null` and `explainable` |

- **Approve:**
  - It runs every check again against the site as it is now. If one fails, the answer is `409` with the failing checks in `details.checks`.
  - It creates the Command (`status: created`, `sendAt` = the window start). The rules service sends it then (see Commands). The command expires 15 minutes after the window starts (or after now, if the window has started) and reverts at the window end.
  - Two approvers racing get one `200` and one `409`.
- **Who may approve:** when the approval setting says "Owner only", managers get `403`. Installers never decide.
- **Refusals:** a proposal that is not `proposed`, or has expired, answers `409`.
- **Manual requests:** the checks cover what the device profile supports, its parameter limits and longest duration, a window still ahead, and the battery's hardware floor. Failing checks are recorded and block approval. The same open request twice answers `409`.
- **Expiry:** the rules service marks proposals past `expiresAt` as `expired` on its sweep.
- **Audit and live stream:** every action is audited (`recommendation.request`, `.approve`, `.decline`) and published on the live stream (`inbox`, and `command` for an approval).

## Commands `/api/commands` 🔒

What is waiting, on its way or running on devices ([Rules](../develop/rules.md#commands)). The rules service sends, verifies and reverts commands; these endpoints show them and stop them early.

| Method | Path | Roles | Result |
| ------ | ---- | ----- | ------ |
| GET | `/` | all | `{ items: CommandView[] }`: commands created, sent, acked or verified (not reverts) |
| GET | `/:id` | all | `CommandView`: action, params, status, `sendAt`, `sentAt`, `ackedAt`, `verifiedAt`, `failedAt`, `error`, `expiresAt`, `revertAt`, `revertedAt`, `cancelledAt`, its `recommendation`, and its `revert` once there is one |
| POST | `/:id/cancel` | owner, manager | Cancels it and returns the `CommandView`. A command not sent yet is dropped; one already out gets its revert. `409` for a finished command or a revert. Audited as `command.cancel` |

## Inbox `/api/inbox` 🔒 all roles

Decisions waiting for someone, alerts, and commands waiting or running, in one list (Inbox).

| Method | Path | Query | Result |
| ------ | ---- | ----- | ------ |
| GET | `/` | `state` open\|closed (default open), `type` decide\|alert\|active\|all (default all), `limit` 1–100 (default 30), `cursor` | `{ items: InboxItem[], counts, nextCursor }` |
| GET | `/counts` | | `{ open, closed }`, each `{ decide, alert, active, all }` |

- **What is open:** a proposed recommendation; an alert that is open or acknowledged; a command that is created, sent, acked, or verified and still running until its revert. Declined and expired recommendations, resolved alerts, and finished, failed or cancelled commands are closed. Revert commands are not listed on their own.
- **`InboxItem`:** `key` (`type:id`), `type`, `id`, `kind` (Decision, Alert, Info, Active, Closed), `title`, `deviceId`, `deviceName`, `sub` (one line, e.g. "Battery · expected saving $266" or "Battery · running until 17:00 · approved by Jamie Reyes"), `status`, `at`, and `due` (when a decision expires, or when a command ends).
- **Order and paging:** newest first by when the item arrived (which never changes), same-moment items by key. `nextCursor` holds the last item's time and key, so items moving between open and closed while you page never repeat or go missing. A bad cursor is a `400`.

## Audit log

`/api/audit` 🔒 owner.

Every write to a site records an `AuditEvent` `{siteId, userId, action, target, before, after, ts}`. Owners read them here; nothing changes them through the API.

| Method | Path | Query | Result |
| ------ | ---- | ----- | ------ |
| GET | `/` | `action` (one action such as `device.update`, or a group such as `device`), `userId`, `target` (e.g. `device:…`), `from`, `to` (ISO times, `to` exclusive), `limit` 1–200 (default 50), `cursor` | `{ items: AuditEntry[], nextCursor }`, newest first |

- **`AuditEntry`:** `id`, `ts`, `action`, `target`, `user` (`{ id, name }`; `null` for the rules service, worker or gateway; "Former user" once the person's account is gone), `before`, `after`.
- **Paging:** `nextCursor` holds the last entry's time and id, so entries written while you page don't shift the pages. A bad cursor or filter is a `400`.
- **Actions recorded:** `alert.ack`, `.snooze`, `.resolve`, `.false-alarm`, `.fix`; `bill.utility.upload`, `.enter`; `calendar.update`; `command.cancel`; `device.create`, `.update`, `.delete`; `notifications.update`; `recommendation.request`, `.approve`, `.decline`; `site.update`, `site.pv-arrays`, `site.battery`; `tariff.create`; `invite.create`, `.accept`; `device.commission`; `maintenance.create`; `export.create`; `report.create`, `.delete`; `membership.update`, `.delete`; `invite.revoke`; `rule.update`; `siteModel.update`, `.upload`, `.uploadDelete`; `site.create` (migration). `/api/auth/*` changes a person's own account, not a site, and isn't recorded.

## Invites

EcoManage is invite-only. An owner invites an email address with a role; the worker emails a link
to `{APP_URL}/invite/{token}`. The token is 32 random bytes; only its SHA-256 is stored, and the
plain token exists only in the email job and the email. Links expire after 7 days and work once.

| Method | Path | Who | Body → result |
| ------ | ---- | --- | ------------- |
| POST | `/api/site/invites` | 🔒 owner | `{ email, role, until? }` → `201 InviteView { id, email, role, until, expiresAt, invitedBy }`. A new invite replaces any unused one for the same address. `409` if the person already has access, `400` for an `until` in the past, `503` when the email can't be queued (no Redis). Audited as `invite.create` |
| GET | `/api/invites/:token` | the link | `InvitePreview { siteName, email, role, until, expiresAt, invitedBy, hasAccount }`. `404` unknown link, `410` used or expired (the message says which) |
| DELETE | `/api/site/invites/:id` | 🔒 owner | `204`: an invite not accepted yet stops working. Audited as `invite.revoke` |
| POST | `/api/invites/:token/accept` | the link | New account: `{ name, password }` (at least 8 characters). Existing account for that email: `{ password }`, its own. → user fields + `accessToken`, and sets `em_rt`, like login. Adds the membership with the invited role and `until`. `400` wrong password or missing name, `404`/`410` as above. Audited as `invite.accept` |

## History, exports and reports 🔒 all roles

Built from the permanent 15-minute intervals. Dates are local dates (`YYYY-MM-DD`) in the site's
time zone, both ends included. Money fields are `null` for installers.

| Method | Path | Query or body | Result |
| ------ | ---- | ------------- | ------ |
| GET | `/api/history/series` | `from`, `to`, `res` (`auto`, `15m`, `h`, `d`, `w`, `mo`; default `auto`) | `HistorySeries { from, to, days, res, warnings, dataStart, today, buckets }`. The range is swapped if backwards and kept between the first day with data and today; a resolution that would draw more than 400 bars falls back to Auto (≤ 2 days hourly, ≤ 92 daily, ≤ 400 weekly, else monthly), each with a warning. Buckets start at local midnight, the hour, the quarter hour, Monday or the 1st, and cover the whole range (empty ones have `n: 0`): `{ start, pv, used, batt (discharge), grid, export, bld, hp, ev, peakKw, costCents, estimated, n }` |
| GET | `/api/history/totals` | `from`, `to`, `compare` (`none`, `prev`, `yoy`) | `{ from, to, totals, compare }`. `totals`: `{ pvKwh, gridKwh, exportKwh, peak { kw, at }, costCents, estimatedIntervals, intervals }`. `compare`: the same number of days just before, or the same dates last year, with `totals: null` when that is before the first data |
| POST | `/api/exports` | `{ from, to }` | `202 ExportView { id, from, to, status: "queued", rows, error, large, createdAt }`. The worker writes every 15-min interval as CSV (site-time and UTC start, kWh columns, demand, cost and export credit for money roles, quality). Ranges over 366 days are `large`: also emailed to the requester as a link to History. Audited as `export.create`. `503` without the worker queue |
| GET | `/api/exports/:id` | | `ExportView` (`queued`, `done`, `failed`) |
| GET | `/api/exports/:id/file` | | The CSV (`409` until it is done) |
| GET | `/api/reports` | | `{ items: ReportView[] }`, newest first (up to 100). `ReportView` adds `error` (why the latest run failed), `lastRunAt`, `lastRange { from, to }` (the dates the latest file covers) and `nextRunAt` (weekly and monthly: the next Monday or 1st at 07:00 site time; `null` for one-offs) |
| POST | `/api/reports` | `{ name, from, to, sections, format (pdf, csv, xlsx), schedule (once, weekly, monthly), recipients?, notes? }` | `201 ReportView { …, status: "waiting", createdBy, canDelete }`. Sections: summary, sources, demand, cost, devices, decisions, alerts; installers can't pick `cost` (`403`). A scheduled report needs a recipient. Audited as `report.create`. A one-off is queued for the reports worker straight away; a weekly or monthly one gets a job scheduler in the site's time zone and runs at 07:00 on Monday or the 1st, each run covering the previous full week (Monday to Sunday) or month. Each run is emailed to the recipients as a link |
| GET | `/api/reports/:id/file` | | The latest rendered file; `409` until the reports worker has made it, or with the reason when the latest run failed |
| DELETE | `/api/reports/:id` | | `204`; stops its schedule and removes its files, so emailed links stop working. Its creator or the owner only (`403`). Audited as `report.delete` |
| GET | `/api/report-links/:token` | *(no sign-in)* | The file of one run, from the link in a report email: `404` for an unknown link or a removed report, `410` once it has expired (30 days). Only the SHA-256 of the token is stored, and request logs leave the token out |

## People and rules

| Method | Path | Roles | Body → result |
| ------ | ---- | ----- | ------------- |
| GET | `/api/site/members` | owner | `{ members: MemberView[], invites: InviteView[] }`: people with access now (`{ id, userId, name, email, role, until, you }`, `until` a local date) and invites not accepted yet |
| PATCH | `/api/site/members/:id` | owner | `{ role?, until? }` (`until` a local date or `null` for no end) → `MemberView`. `409` if the site would be left without an owner with lasting access; `400` for an `until` before today. Audited as `membership.update` |
| DELETE | `/api/site/members/:id` | owner | `204`. Same last-owner rule. Audited as `membership.delete` |
| GET | `/api/rules` | all | `{ approval { who, expireMin, email }, rules: RuleView[] }`: each rule `{ id, title, device, on, params, defaults, declines30d { count, reasons [{ reason, count }] } }` |
| PATCH | `/api/rules/:ruleId` | owner, manager | `{ on?, params? }` for a rule: params must be the rule's own settings, of the same kind (number or on/off), not negative (except `belowCents`). `approval`: `{ params: { who?, expireMin?, email? } }`. → the new `RulesResponse`. `404` unknown rule. Audited as `rule.update`. The rules service reads the saved values on its next run |
| PUT | `/api/site/model` | owner, installer | `{ hub, anchors [{ key, at, label }], buildingLabel, camera { view }, generated? }` (positions in scene metres, one anchor per source or load) → the model as `GET /api/site/model` returns it, saved as the next version. `generated` is the building: 3–64 corners within ±250 m that don't cross, at least 4 m², storeys 1–30 of 2–6 m, roof rows 0–60, tilt 0–45°; without it the building carries over. An uploaded model stays in use; `source: "generated"` in the body switches back to the generated scene. Audited as `siteModel.update` |

## Site model uploads

A 3D file for the site model. The API checks it, keeps the original in private object storage and
queues it; the worker runs it through the sandboxed converter, which turns it into one GLB (metres,
Y up, centred with its base at y = 0, under 200,000 triangles, textures at most 2048 px, Draco and
KTX2) with a PNG thumbnail on the CDN. `GET /api/site/model` then carries
`upload { uploadId, glbUrl, thumbUrl, originalName, tris, bytes, bbox { min, max }, scale }`.

| Method | Path | Who | Result |
| ------ | ---- | --- | ------ |
| GET | `/api/site/model/uploads` | all | `{ items: ModelUploadView[] }`, newest first (up to 20): `{ id, originalName, format, bytes, status (queued, processing, ready, rejected, failed), reason, glbUrl, thumbUrl, glbBytes, tris, trisIn, bbox, scale (1, 0.01 for cm, 0.001 for mm), inUse, createdBy, createdAt, processedAt }` |
| POST | `/api/site/model/uploads` | owner, installer | multipart `file`: .glb, .gltf (everything inside it), .obj, .fbx or .ifc, up to 30 MB → `202 ModelUploadView` (`queued`). Refused with the reason: `413` over 30 MB; `422` another type, a SketchUp file (export it as glTF, OBJ or FBX instead), a bad signature, or a .gltf that needs separate files. The converter's reasons (glTF errors, no triangles, wrong units, still over 200k triangles after simplifying, a damaged file) come back as `status: "rejected"` with `reason`. `503` without storage or the worker queue. Audited as `siteModel.upload` |
| GET | `/api/site/model/uploads/:id` | all | `ModelUploadView` |
| POST | `/api/site/model/uploads/:id/use` | owner, installer | The next site model version draws this upload; anchors, hub and labels carry over → the model. `409` until it is `ready` (or with the reason for a rejected file). Audited as `siteModel.update` |
| DELETE | `/api/site/model/uploads/:id` | owner, installer | `204`, with its files. `409` while it is in use or still processing. Audited as `siteModel.uploadDelete` |

## Site `/api/site` 🔒

### Settings

| Method | Path | Roles | Body → result |
| ------ | ---- | ----- | ------------- |
| GET | `/` | all | `SiteSettings`: id, name, address, tz, lat, lon, currency, billDay, demandCapKw, `pvArrays[]`, `battery { deviceId, usableKwh, maxKw, floorPct }` or null |
| PATCH | `/` | owner | Any of name, address, tz (IANA), lat, lon, currency (CAD, USD, EUR, GBP, AUD), billDay (1–28), demandCapKw → `SiteSettings` |
| PUT | `/pv-arrays` | owner, installer | The whole table `[{ id?, name, inverterId, kwp, tiltDeg (0–90), azimuthDeg (0–360, 180 = south) }]` → `SiteSettings`. New arrays get an id; `422` with `details.issues` if an `inverterId` isn't one of the site's inverters |
| PATCH | `/battery` | owner, installer | Any of usableKwh, maxKw, floorPct (≥ 10) → `SiteSettings` + `gatewaySync: sent \| pending \| unchanged` |
| GET | `/gateway` | all | `{ id, online (reported in the last 90 s), fw, uptimeS, buffered, oldestBufferedTs, clockOffsetMs, lastSeenAt, bufferDays: 7, batteryFloorPct, configPending, claim }`. `claim`: `{ serial, state: waiting \| certified, claimedAt }` for a gateway claimed with its QR code, `null` otherwise |
| GET | `/explanations` | owner | `ExplanationSettingsView { source: site \| server \| none, provider, baseUrl, model, keyHint ("…a1b2"), monthlyTokens, usedTokens, canStoreKeys, updatedAt }`: who writes this site's explanations. The key itself is never returned |
| PUT | `/explanations` | owner | `{ provider: openai-compatible \| anthropic, baseUrl, model, apiKey?, monthlyTokens (≥ 1000) }` → the view. The site's own model with its own key, sealed with `SECRETS_KEY` (leave `apiKey` out to keep the saved one). The base URL must be `https://` to a public host (no localhost, private or link-local addresses, bare service names or credentials in the URL) unless the server sets `LLM_ALLOW_PRIVATE_URLS`. `400` bad URL or no key, `503` without `SECRETS_KEY`. Audited as `site.explanations` (key hint only) |
| DELETE | `/explanations` | owner | → the view: back to the server's default (or off); the key is forgotten. Audited as `site.explanations` |
| POST | `/explanations/test` | owner | The settings from the form (before saving), or none for the saved ones → `{ ok, model, latencyMs, error }`: a tiny request with nothing from the site in it; not counted against the budget |
| POST | `/gateway/claim` | owner, installer | `{ qr }` (the text of the gateway's QR code) or `{ serial, code }` → the `/gateway` view. The gateway becomes the site's; if it has already asked for its certificate, it is signed (CN = site id) and sent at once, else when it asks. `400` not a gateway QR code or serial, `404` no gateway with that serial and code (one answer for both), `409` it belongs to another site or is already set up. Audited as `gateway.claim`; the certificate as `gateway.certificate` (no user) |

- Validation errors answer `400 { error: { code, message, details: { issues: [{ path, message }] } } }`.
- Usable capacity and maximum power are stored on the battery device. The floor is stored on the
  site and published to the gateway as the retained `site/{siteId}/config` message
  (`{ ts, batteryFloorPct }`). If the broker can't be reached, `gatewaySync` is `pending`, and the
  API sends the config again when it reconnects.
- Every change is audited: `site.update` records only the changed fields, and there are also `site.pv-arrays` and `site.battery`.


### Home

| Method | Path | Roles | Result |
| ------ | ---- | ----- | ------ |
| GET | `/model` | all | `SiteModel { version, source, upload, generated, hub, anchors [{ key, at, label }], buildingLabel, camera { view } }`: the latest saved model, or the demo scene (`version: 0`, `source: "default"`). `generated` is the building: `{ footprint [[x, z]…], storeys, storeyHeightM, roofRows, arrayTiltDeg, osm { wayId, name } \| null }`; older versions without one give the demo building (7 × 4 m, one 2.2 m storey, three rows) |
| GET | `/model/osm-footprint` | owner, installer | `?lat&lon` (both or neither; default the site's location) → `OsmFootprintView { footprint, storeys, wayId, name, at { lat, lon }, attribution }`: the OpenStreetMap building containing the point, else the nearest within 60 m, as an outline in scene metres centred on the building (at most 64 corners; storeys from `building:levels`). Only the point is sent to the Overpass API. `404` no building there, `422` no location, `502` Overpass didn't answer, `503` lookups turned off (`OVERPASS_URL` empty) |
| GET | `/today` | all | `SiteToday { date, currency, prices, bill }`. `prices`: today's tariff periods in order `[{ name, rateCents, level (off, mid, peak), start, end }]` covering the whole local day (23 or 25 h on DST days), or `null` without a tariff or with a gap today. `bill`: the open period `{ period, totalCents, projectedCents, savedCents }` for owners and managers; `null` for installers or before the first bill |

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
| `alert`     | `{ type, alert: AlertView }` when an alert opens, resolves, counts a repeat, or someone acts on it |
| `command`   | `{ type, commandId, deviceId, status }` when a command is sent, acked or fails |
| `inbox`     | `{ counts, changed: [{ type, id }] }`: Inbox counts right after the snapshot, then at most one every 300 ms while decisions, alerts or commands change |

A `: heartbeat` comment is sent every 20 s. Events published while the snapshot is being built are
held back and sent right after it.

## Tariffs `/api/tariffs` 🔒

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

## Calendar `/api/calendar` 🔒

| Method | Path | Roles | Result |
| ------ | ---- | ----- | ------ |
| GET | `/` | all | `{ terms[], daysOff[], open, close, weekends, updatedAt }` |
| PUT | `/` | owner, manager | Replaces the calendar with the same shape (without `updatedAt`) |

- `terms` and `daysOff` are `[{ name, start, end }]` in local dates, with start ≤ end. They are stored in start order.
- `open` and `close` are the weekday opening hours (`HH:mm`, open before close).
- `weekends` is `closed` or `open`.
- A site without a calendar answers with an empty one (weekends closed, 08:00–17:00).
- A day is in use if it is in a term, is not a day off, and is not a weekend (unless weekends are open). The shared helper is `calendarDayType`.
- The load forecast reads the calendar.
- Changes are audited as `calendar.update`.

## Notifications `/api/me/notifications` 🔒 all roles

The signed-in person's email settings for this site (Settings → Notifications).

| Method | Path | Result |
| ------ | ---- | ------ |
| GET | `/notifications` | `{ email, alerts, daily, recs, failures, quietFrom, quietTo, escalateMin }` |
| PATCH | `/notifications` | Any of those fields → the saved settings; audited as `notifications.update` |

- **Defaults:** email goes to the sign-in address, everything is on, quiet hours are 22:00–06:30, and escalation is after 30 min.
- **Quiet hours:** `quietFrom`/`quietTo` are local `HH:mm` and are set together; `null` for both turns quiet hours off.
- **`escalateMin`:** 5 to 1440.
- **Command failures:** always on for owners and managers. `failures: false` from either answers `422`.

## Forecast `/api/forecast` 🔒 all roles

`GET /` returns the latest PV and load forecasts from the current 15-minute step, 48 h ahead (type `ForecastView`):

- `points [{ ts, pvKw, loadKw, netKw, tempC, cloud, storm }]` (`storm`: a thunderstorm warning in force). `netKw` = load − PV is what the grid and the battery must cover.
- `issuedAt { pv, load }` and `source` (the weather source).
- `profiles [{ date, label, days }]`: which history each day's load comes from, e.g. `Thursday open-day profile`, 6 days.
- `accuracy { pv, load }`: the latest day-ahead MAPE, `{ mape, n, issuedAt }`, or null.

The worker issues forecasts every hour. Before the first run the lists are empty and every field is null. A site without a location gets no forecasts, and load needs 7 days of intervals.

## Bills `/api/bills` 🔒

The worker computes one bill per billing period ([Worker](../develop/worker.md#billing)). Money is whole cents.

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

The response shapes are `BillsResponse`, `BillDetail` and `RangeSpend` in `@ecomanage/shared`.

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
