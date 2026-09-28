# Rules: alerts, recommendations, commands

`apps/rules` runs three loops over the same site state: **alerts** (on every reading), the
**recommendation rules** (every quarter hour) and **commands** (every tick). It never talks to a
device except to send commands people approved.

## Alerts

The service subscribes to `site:*:events` in Redis. Each reading marks its site for evaluation, at
most once every `RULES_TICK_MS` (2 s) per site, and every `RULES_SWEEP_MS` (15 s) every site is
evaluated anyway, so time-based checks fire even when nothing arrives.

Each check in `checks.ts` is a pure function of a `SiteContext`: the devices with their latest
readings, the gateway status, the last demand event, commands sent or recently failed, and 5-minute
solar buckets for the last 3 hours. It returns its findings and the (rule, device) pairs it could
judge.

| Rule | Opens | Clears | Kind |
| ---- | ----- | ------ | ---- |
| `device-silent` | A device silent over 5 min (counted from its last reading, or from when it was added if it never reported) | It reports again | condition |
| `pv-underperform` | An inverter under 90% of expected for 24 daylight buckets (2 h) | 12 buckets (1 h of daylight) within 5% of expected | condition |
| `battery-below-reserve` | A fresh reading more than 0.5 points under the reserve | At the reserve | condition |
| `demand-near-cap` | This interval's projected demand at 90% of the cap or more | Under 85% | condition |
| `command-ack-slow` | A command sent over 30 s ago with no ack (one per device) | The condition clears on ack or failure; the alert waits for a person | one-off |
| `command-failed` | Each failed command of the last 24 h | Never by itself | event |
| `gateway-buffer` | The gateway reports buffered readings older than 1 h | The backlog is newer than 1 h | condition |

"Expected" solar comes from the site's other inverters: this inverter's kWp × (their kW ÷ their
kWp) in the same bucket. Buckets where the others make under 5% of their rating count as night and
aren't judged, and a site with one inverter isn't judged.

`reconcile.ts` turns findings into `alerts`, at most one open or acknowledged per (site, device,
rule), enforced by a unique partial index even if two processes race:

- A new finding opens an alert, unless a `ruleMutes` entry covers the rule and device (or the site).
- An open condition alert whose pair was judged and not found closes itself:
  `resolution { cause: "Condition cleared", auto: true }`.
- Pairs that couldn't be judged (a stale battery reading, night for solar) leave their alerts alone.
- One-off alerts only mark their condition cleared and wait for a person. Event alerts start
  cleared and count each new command once. An occurrence someone already resolved doesn't reopen.
- Opened, resolved and counted alerts are published as `alert` events.

## Recommendations

Once per quarter hour (:00, :15, :30, :45 site time; every time zone is a whole number of quarters
from UTC) the rules in `@ecomanage/recs` run for every site. The API runs exactly the same checks
again at approval. On its 15 s sweep the service also marks proposals past `expiresAt` as
`expired`.

- **A rule** is `{ id, evaluate(ctx, params), check(ctx, action, params), saving(ctx, action, params) }`:
  three pure functions of a `RecContext`, so the same state always gives the same proposal.
- **`RecContext`**, loaded as of the quarter: the site and its cap, today's calendar class, the
  tariff in force, the billing period's peak so far, the last demand event, the devices with their
  latest readings, the battery (charge, reserve, capacity, floor), the latest solar and load
  forecasts, open commands and the approval settings.
- **Settings:** `ruleConfigs` holds Settings → Rules, each rule's `on` and `params` over
  `RULE_DEFAULTS`, and the approval settings under the id `approval`.
- **Proposing:** each enabled rule's proposal becomes a `recommendations` document (`proposed`,
  with its checks, expected saving and one-line calculation; `expiresAt` = the window start −
  `expireMin`). It's skipped if that time has passed, or if an open recommendation has the same
  `dedupeKey` (rule + device + window; a unique partial index backs this). A failing rule is logged
  and the others still run. Each new proposal goes out as an `inbox` event, and the worker emails
  the approvers.
- **Params** are exactly the device profile's action params, so approving turns a proposal
  straight into a command.

### The rules

| Rule | Action | How it decides | Saving |
| ---- | ------ | -------------- | ------ |
| `peak-shaving` | `force_discharge {kw, until}` | The forecast net load (load − solar) in the next tariff peak goes over cap − margin; the window covers the steps over it; kW = ⌈(peak − cap) / 5⌉ × 5 + margin, at most `maxKw`. Checks: charge at the window end ≥ the day's minimum, within the kW limit, new peak ≤ cap. One per battery and peak | (forecast peak − max(month peak, new peak)) × demand rate |
| `ev-offpeak` | `set_charging_profile`: 0 A now, 32 A from the cheapest price before departure | A fleet vehicle (by RFID) charging in mid or peak hours, whose usual energy (+ buffer) fits the cheap hours before it leaves. Usual energy: the average of its last 10 sessions started within ±2 h of this time of day. One per session | Energy that would have gone in now × (rate now − cheap rate) |
| `ev-limit-near-cap` | `limit_current {amps, until}` | The 15-minute projection within `withinPct` of the cap while EVs charge: limit the busiest charger (never below `minA`) for this interval and the next. Decide within 10 minutes | (projected demand − max(month peak, demand after)) × demand rate; nothing if this month has a higher peak |
| `hp-precondition` | `sg_schedule`: boost, block, back to normal | A peak starts within 2 h and the heat pump is running: boost `boostMin` before, then block up to `blockMin`. Only time limits; nothing is claimed about comfort | Energy moved from the peak to the boost × (peak rate − boost rate) |
| `storm-reserve` | `set_reserve {pct}` until the warning ends | A thunderstorm warning within `leadH`: seeded in the simulated weather, or WMO codes 95–99 from Open-Meteo. Can be approved any time before the storm | None |
| `zero-export-low-price` | `export_limit {pct}` on the largest inverter, at most 4 h | The export rate at or below `belowCents` and a forecast surplus the battery can't take | Energy not exported × the export rate, when that rate is negative; otherwise none |

Each rule's tests cover triggering, not triggering and a failing check.

### Manual requests

A person's request from the Devices page (`POST /api/recommendations`) becomes a recommendation
with `ruleId: "manual"`. Its checks: the profile supports the action, the params are within its
limits, the window is ahead and no longer than the action's `maxDurationMin`, and the battery stays
above its floor.

## Commands

Every tick the service dispatches commands (`src/commands`) as `svc-rules`, whose access list
allows only writing `site/+/cmd/+`.

- **Send:** approving creates the command with `sendAt` = the window start. It's marked `sent`
  just before publishing. If the broker is unreachable it goes back to `created` and is retried
  until `expiresAt`, then fails ("Expired before it could be sent"). A `set_reserve` waits for a
  reading of the current reserve, so the change can be undone.
- **Acknowledgement:** ingest records the gateway's ack. With none within 60 s the command fails
  and a `command-failed` alert opens.
- **Verification** (`verify.ts`), against readings newer than the ack: battery power for forced
  charge or discharge; `reserve_pct`, `limit_a`, `sg_mode`; inverter output for export limits; a
  schedule's step in force. Not followed within 5 minutes → failed, and its revert is sent.
- **Revert** at `revertAt`: a command of its own (`revertOf`), sent and acknowledged the same way.
  It uses the device's `revert` action, or for a reserve change `set_reserve` back to the value
  recorded before (`revertParams`). Once it's acknowledged the original is `reverted`.
- **Cancel** (`POST /api/commands/:id/cancel`): a command not sent yet is dropped; one already out
  gets its revert.
- **Recommendations follow their command** (sent, acked, verified, failed, reverted, cancelled);
  each change is a `command` event and an `inbox` event.

The worker measures what a peak-shaving recommendation actually saved once its day is over; see
[Worker](./worker.md#savings).
