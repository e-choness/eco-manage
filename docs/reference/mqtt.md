# MQTT topics and messages

Gateways (and the simulator) talk to EcoManage over MQTT 3.1.1/5 with TLS on port 8883. Every
client presents a certificate signed by the broker's CA; the certificate's name (CN) is its MQTT
user, which the access list checks. Messages are JSON, published with QoS 1. The schemas are zod
definitions in
[`packages/shared/src/mqtt.ts`](https://github.com/e-choness/eco-manage/blob/main/packages/shared/src/mqtt.ts)
and [`claim.ts`](https://github.com/e-choness/eco-manage/blob/main/packages/shared/src/claim.ts).

## Topics

| Topic | From → to | Message |
| ----- | --------- | ------- |
| `site/{siteId}/dev/{deviceId}/telemetry` | gateway → ingest | A [reading](#reading), or `{ items: [reading…] }` (1–5,000) when catching up |
| `site/{siteId}/dev/{deviceId}/status` | gateway → ingest | `{ ts, state, fault: [{ code, text }] }` |
| `site/{siteId}/gw/status` | gateway → ingest, API (retained) | `{ ts, fw, uptimeS, buffered, oldestBufferedTs, clockOffsetMs }` |
| `site/{siteId}/cmd/{commandId}` | rules, API → gateway | A [command](#command) |
| `site/{siteId}/cmd/{commandId}/ack` | gateway → ingest | `{ ok, error?, ts }` |
| `site/{siteId}/job/{jobId}` | API → gateway | `{ type: scan \| commission \| restart, params }` |
| `site/{siteId}/job/{jobId}/result` | gateway → API | `{ ok, ts, error?, data }` |
| `site/{siteId}/config` | API → gateway (retained) | `{ ts, batteryFloorPct }` |
| `claim/{serial}/csr` | unclaimed gateway → API | `{ csr (PEM), proof, fw, ts }`, every 30 s until answered |
| `claim/{serial}/cert` | API → gateway | `{ siteId, cert (PEM, CN = siteId), ca (PEM), ts }` |

Topic segments are letters, digits and `_ . : -`. A gateway subscribes to
`site/{siteId}/cmd/+`, `site/{siteId}/job/+` and `site/{siteId}/config`.

## Identities and access

From `infra/mosquitto/acl`:

| User (certificate CN) | May |
| --------------------- | --- |
| `svc-ingest` | Read telemetry, device and gateway status, command acks and job results for every site |
| `svc-api` | Write commands, jobs and config; read acks, job results and gateway status; read claim requests and write claim answers |
| `svc-rules` | Write commands only |
| `svc-health` | Read `$SYS/#` (the broker's health check) |
| a site id (a claimed gateway) | Read and write `site/<its own site id>/#` only |
| `bootstrap` (an unclaimed gateway, client id = its serial) | Write `claim/<its client id>/csr`, read `claim/<its client id>/cert` |

## Reading

One reading in the standard field set. Unknown fields are refused, and a device may only send the
fields its [profile](./device-profiles.md) declares. Power follows the site's sign convention:
positive into the switchboard (production, discharge, import), negative out of it.

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `ts` | ISO time | When the device was read (required) |
| `p_kw` | number | Power, kW (required) |
| `e_in_kwh`, `e_out_kwh` | number ≥ 0 | Cumulative energy counters, kWh |
| `soc_pct`, `soh_pct` | 0–100 | Battery charge and health |
| `reserve_pct` | 0–100 | Battery reserve |
| `usable_kwh` | number ≥ 0 | Battery usable capacity |
| `state` | text (≤ 40) | The device's operating state |
| `fault` | `[{ code, text }]` | Active faults |
| `v`, `a` | up to 3 numbers | Voltage and current per phase |
| `pf` | −1 to 1 | Power factor |
| `hz` | number > 0 | Frequency |
| `dc` | `[{ v, a }]` | DC strings |
| `t_c` | number | Temperature, °C |
| `session` | `{ id, idTag?, kwh, startedAt }` | A charging session |
| `limit_a` | number ≥ 0 | A charger's current limit |
| `sg_mode` | 1–4 | A heat pump's SG-Ready mode |
| `supply_c`, `return_c`, `outdoor_c` | number | Heat-pump temperatures |
| `q` | `ok` (default), `stale`, `estimated`, `backfilled` | Quality |

Ingest marks a reading `backfilled` when it arrives more than 15 minutes after its `ts`, and drops
a repeat of the same device and `ts`.

## Command

```json
{
  "deviceId": "650000000000000000000003",
  "action": "force_discharge",
  "params": { "kw": 30, "until": "2026-09-24T21:00:00.000Z" },
  "expiresAt": "2026-09-24T18:15:00.000Z",
  "revertAt": "2026-09-24T21:00:00.000Z"
}
```

`action` and `params` are one of the device profile's write actions. The gateway refuses a command
past `expiresAt` or outside the action's limits, and ends it at its end (`until`, `validTo` or
`revertAt`) on its own. The ack's `error` says why it refused.

## Jobs

| Type | Params | Result `data` |
| ---- | ------ | ------------- |
| `scan` | | `{ found: [{ address, modelCode, profileId, type, name }] }` |
| `commission` | `{ deviceId, address }` (an address the last scan found) | `{ checks: [{ name, pass }] }` |
| `restart` | | |
