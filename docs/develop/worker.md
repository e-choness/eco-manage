# Worker: bills, email, reports, forecasts

`apps/worker` runs BullMQ jobs on Redis. Each queue has its own concurrency, so a long billing
pass never holds up a statement someone is waiting for.

| Queue | Jobs | When |
| ----- | ---- | ---- |
| `billing` | `cost-intervals`, `nightly-bills` | Every minute; hourly at :05 |
| `documents` | `statement`, `utility-bill`, `export-csv` | On request, two at a time |
| `email` | `notify`, `invite` | Every 30 s; on request |
| `reports` | a scheduler per scheduled report, `report-sweep`, one-off runs | Weekly or monthly in site time; every 5 min; on request |
| `models` | `model-upload` | On upload |
| `forecast` | `forecast-all`, one site | Hourly and at start; when a site's calendar or arrays change |

## Billing

- **`cost-intervals`** prices each interval whose `costedAt` is null with the tariff version valid
  on its local date: `touSplit` of `grid` into `costCents.pk/md/op`, and `creditCents` = export ×
  export rate. Then it recomputes the bill of each billing period it touched. An interval ingest
  rewrote meanwhile stays pending (the update matches on `updatedAt`). It drains backlogs in passes
  of 5,000.
- **`nightly-bills`**: each site whose local time is 01:xx gets its current and previous bills
  recomputed, and yesterday's carried-out recommendations get their measured saving.

A bill (`bills`, one per site and period) is
`Σ energy × the version in force each day + peak demand × demand rate + fixed fee − export credit`.
Energy lines are summed from exact values and rounded once per line. Demand and the fixed fee use
the version in force on the period's last day (today, for an open period); `peakKw` is the highest
15- or 30-minute demand. The bill records which versions priced it, the share of estimated
intervals and any intervals no tariff covers. The maths lives in `@ecomanage/shared`
(`billing.ts`, `tariff.ts`), so the API's range spending and the daily summary use the same code.

`pnpm --filter @ecomanage/worker bills:refresh` recomputes every site's current and previous bill
now; the deploy stack's seed runs it.

### Savings

Each bill is compared with the same site load bought entirely from the grid on the same tariff.
Per interval, load = grid − export + pv + batt, so the energy saving splits exactly into:

- **Solar:** the cost of pv − export at its period's price, plus the export credit.
- **Battery shifting:** the signed cost of battery kWh (discharge in dear periods minus charge in
  cheap ones).
- **Demand avoided:** the baseline peak (load × 4) minus the actual peak, at the demand rate.

`savedCents` is their sum and `baselineCents` = `totalCents` + `savedCents`. Both stay null until
the site has 7 days (672 intervals).

**Measured saving** of a carried-out peak-shaving recommendation, once its day is over: without the
battery's discharge, demand in each interval would have been (grid − export + battery) × 4, so
`actualSavingCents` = the period's demand charge without it − with it, with the sum in
`actualCalc`. The other rules keep only their expected saving.

## Documents

- **`statement`** renders a bill to PDF with pdfkit, stores it in GridFS (bucket `files`, metadata
  `{ siteId, kind, contentType }`) and remembers `{ fileId, renderedAt }` on the bill. The API waits
  up to 30 s and serves the stored copy until the bill changes.
- **`utility-bill`** reads an uploaded bill's total from the PDF's text (unpdf) or the CSV
  template, and sets `utility.status` to `done` with `diffCents` = ours − utility, or `failed` so
  the owner can type it. A job for a file a newer upload replaced does nothing.
- **`export-csv`** writes every 15-minute interval of a range (site-time and UTC start, kWh
  columns, demand, cost and credit for money roles, quality) to GridFS.

## Email

Sent through `SMTP_URL`. Each email's key is first claimed in `emails` (unique), then the mail is
sent and marked `sent`; a failed send drops the claim so the next pass retries, and a restart or a
second worker never sends twice.

| Email | Rule | Key |
| ----- | ---- | --- |
| **Alert** | Each new warning or failure (not info) to every current member who wants it. Warnings wait for that person's quiet hours to end; command failures always go to owners and managers; snoozed alerts and alerts over 24 h old aren't sent | `alert:{alertId}:{userId}` |
| **Escalation** | An alert still open (not acknowledged) after the owner's `escalateMin`, once, to the owner | `escalation:{alertId}:{userId}` |
| **Proposal** | Each new recommendation to the approvers named in the approval settings who want them; quiet hours apply | per recommendation and person |
| **Daily summary** | In the hour after 07:00 site time: yesterday's cost, grid kWh, peak, solar and battery savings, open alerts | `daily:{siteId}:{date}:{userId}` |
| **Export** | Exports over a year, to the requester, as a link to History | `export:{exportId}` |
| **Invite** | On request: the link `{APP_URL}/invite/{token}`, unless the invite was replaced, used or expired meanwhile. The job is removed once done, so the plain token isn't kept | `invite:{inviteId}` |
| **Report** | Each run, to each recipient, as a link | `report:{id}:{from}:{to}:{email}` |

## Reports

- **Content:** seven sections (energy summary, sources and consumers, demand peaks, energy cost,
  device availability, decisions and commands, alerts) built once as figures and tables from the
  intervals, bills, devices, recommendations, commands and alerts, in the site's time. Device
  availability counts the hours of "Device not reporting" alerts.
- **Formats:** PDF is the content as HTML printed by Gotenberg; CSV has a block per section (cells
  that would start a formula are quoted); XLSX (exceljs) has a sheet per section.
- **Access:** a run uses its creator's access at that moment: money only for owners and managers,
  and nothing at all once the creator has left the site (the report is marked failed).
- **Schedules:** one BullMQ job scheduler per weekly or monthly report, `report:{id}`, with the cron
  `0 7 * * 1` or `0 7 1 * *` in the site's time zone, so it runs at 07:00 site time through DST
  changes. A run covers the previous full week or month. The API adds and removes schedulers; the
  5-minute `report-sweep` puts them right (lost Redis, a changed time zone, a removed report) and
  queues one-offs that never got their job (same job id, so never twice).
- **Files and links:** each run goes to GridFS (`kind: report`) and `files[]` (the last 24). Each
  recipient gets `{APP_URL}/api/report-links/{token}`, valid 30 days; only the token's SHA-256 is
  stored. Removing a report removes its files.

## 3D uploads

1. **The API** checks the file's type and signature (the same shared check the browser runs), refuses
   SketchUp with how to export instead, stores the original under `uploads/` (private) and queues
   `model-upload`.
2. **The worker** sends it to the [converter](./model-converter.md) on its internal network.
3. **The result:** the GLB and thumbnail go under a new random `models/<hex>/` prefix, public and
   cached as immutable (a new upload is a new path). A `422` from the converter makes the upload
   `rejected` with its reason; anything else is `failed` and retried. The original is removed once
   processed.

## Forecasts

Each site's solar and load for the next 48 hours in 15-minute steps.

- **Weather** from `WEATHER_PROVIDER`: `simulated` (the simulator's own seeded profile from
  `packages/shared/src/weather.ts`, with `WEATHER_SEED` = `SIM_SEED`, so the demo site is forecast
  from the weather it will get) or `open-meteo` (hourly temperature and cloud cover, interpolated;
  cloud converted with Kasten–Czeplak).
- **Solar** uses the simulator's clear-sky model (`packages/shared/src/solar.ts`) × cloud × each
  array's geometry, relative to the demo's 10° south arrays, summed per inverter and capped at its
  rating.
- **Load** (site consumption, grid − export + pv + battery) averages the same local time on history
  days (last 6 weeks) of the same weekday and calendar class (open or closed, from terms, days off
  and weekends); with fewer than two such days, every day of that class. It then applies × (1 + s ×
  degrees outside 13–20 °C), with the sensitivity `s` fitted from history (at most 10% per degree).
  It needs 7 days of intervals.
- **Accuracy:** a day later each forecast is scored against the meter (MAPE over daylight steps of
  at least 5% of kWp for solar, and steps of at least 1 kW for load), stored and logged. On two
  weeks of the simulated site the day-ahead MAPE is about 5% for solar and 7% for load.
- Forecasts expire after 30 days. A site without a location gets none.
