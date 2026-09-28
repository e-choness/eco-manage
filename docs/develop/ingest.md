# Ingest and intervals

`apps/ingest` is the only service that reads what gateways send. It connects to the broker as
`svc-ingest` (QoS 1, a persistent session) and subscribes to readings, device status, gateway
status, command acks and job results for every site.

## Readings

1. **Validate.** Each message is checked against the telemetry schema (one reading, or a batch
   `{ items }` from a gateway catching up), then against the device record: the device must exist
   and belong to the site in the topic, and every field must be one its profile declares. Rejected
   messages are counted and logged.
2. **Drop duplicates** on `(deviceId, ts)` with Redis `SET NX` markers kept for 8 days (longer than
   a gateway's 7-day buffer).
3. **Mark late readings:** more than 15 minutes old on arrival → `q: "backfilled"`.
4. **Store** in the `telemetry` time series in batches, every 500 ms or 1,000 rows.
5. **Latest value:** `latest:{deviceId}` in Redis holds the newest reading. The device's
   `lastSeenAt` is the receive time, and a stale or offline device goes back to live (pending
   devices stay pending).
6. **Publish** on `site:{siteId}:events` for the live stream and the rules service: at most one
   `telemetry` event per device every 5 s (the latest wins), and `demand` for the current interval.

Every 10 s, devices silent for 60 s become `stale`, and after 5 minutes `offline`, each change
published as a `device` event. Gateway status goes to `gw:{siteId}` and device status to
`status:{deviceId}` in Redis.

## Command acks

An ack on `site/{siteId}/cmd/{commandId}/ack` moves its command from `sent` to `acked`, or to
`failed` with the gateway's error, and publishes a `command` event. Acks from another site, for
unknown ids, or repeated, change nothing. Acks for commands still marked `created` are accepted,
since the rules service marks a command sent only just before publishing and a gateway can answer
within milliseconds.

## 15-minute intervals

`src/intervals.ts`. Every 15 s ingest flushes its batches and rolls each closed interval (with 30 s
grace for readings in flight) into `intervals15`, one row per site and quarter hour:

| Field | From |
| ----- | ---- |
| `grid`, `export` | The meter's import and export counters |
| `demandKw` | Import kWh × 4 |
| `pv` | The inverters |
| `batt` | The battery: discharge minus charge |
| `ev`, `hp` | The chargers and the heat pump |
| `bld` | The remainder: grid − export + pv + batt − ev − hp |
| `used` | Solar used on site: pv − export |

- **Energy** per device is the difference of its cumulative counters at the interval's two
  boundaries. The last reading within 60 s before a boundary is carried to it using its power.
- **Estimates:** a device with readings but no counter at a boundary uses average power × 0.25 h,
  and the interval is `estimated`. A meter silent for the whole interval gets grid from the balance
  with the previous interval's building load (`estimated`). A counter that goes backwards (a
  replaced meter, a reset) falls back to power.
- **Late readings:** a reading stored for an interval that has already closed marks it dirty, and
  it's rebuilt on the next pass, and the next interval too if it was estimated.
- **After a restart** ingest resumes from the last stored interval, or from the site's first
  reading, catching up at most a week at a time.
- Every write clears `costedAt`, so the worker prices the interval again and updates the bill.
