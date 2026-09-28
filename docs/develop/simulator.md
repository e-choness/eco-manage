# Simulator

`apps/simulator` stands in for a site's gateway. It uses the same MQTT topics, certificate and
command handling as a real one, so the rest of EcoManage can't tell the two apart. It runs the demo
site, **Maple Grove School**, and every test and screenshot you see in these docs.

## The site

Defined in `packages/shared/src/demo.ts` (site id `650000000000000000000001`): two inverters with
86 kWp of solar, a 200 kWh battery, four EV chargers, a heat
pump, a grid meter and the gateway itself, in a school with terms, days off and opening hours.

## The engine

`src/engine/`, deterministic for a seed:

- **Solar:** clear-sky output for the site's latitude × a seeded daily cloud factor. The solar
  model and weather profile live in `@ecomanage/shared`, so the forecast uses the same ones.
- **The school's load** follows the calendar: terms, days off, opening hours.
- **Heat pump** driven by the temperature and its SG-Ready mode.
- **EV sessions** (buses overnight, staff cars in the day) honouring current limits and schedules.
- **Battery** with round-trip losses, in self-consumption mode unless commanded.
- **Grid meter:** the remainder. Every device integrates its own energy counters.

With seed 42 on 24 September 2026, a school day, the uncontrolled 15-minute grid peak is 130 kW at
15:15: the peak-shaving story in the demo.

Counters behave like real ones: they start from the site's average power since commissioning
(14 March 2024), and with `SIM_STATE_FILE` set they're saved every 30 s with the battery's charge,
and a restart resumes from them, adding average power for the downtime. Meter and inverter readings
carry ±0.25% measurement noise; the counters integrate the true power.

## As a gateway

`src/gateway.ts`:

- Publishes each device every 5 simulated seconds (once per real second above 5× speed).
- While "offline" it buffers readings. On reconnect it reports its status (with the backlog) first,
  then drains batches of 500 per tick; new readings queue behind the backlog, so everything
  arrives in order.
- Applies the retained config (the battery floor), even while its simulated uplink is down.
- Checks every command with the same safety code as the real gateway
  (`packages/profiles/src/safety.ts`) before acknowledging it:
  - refuses expired commands, including ones held during an outage;
  - settings within the profile's limits, no reserve below the battery floor;
  - nothing runs past the action's `maxDurationMin` (the end is `until`, `validTo` or the command's
    `revertAt`; an action with no end gets the maximum);
  - a reserve change is put back at its `revertAt` even if the cloud's revert never arrives;
  - after 15 minutes without the cloud, everything the cloud set is undone: forced battery modes,
    export limits, EV limits and schedules, heat-pump modes and the reserve;
  - forced discharge never goes below the reserve.
- Answers scan, commission and restart jobs.

## Control API

On port 4100 (`SIM_HTTP_PORT`):

| Request | Does |
| ------- | ---- |
| `GET /sim/state` | Simulated time, weather, battery, faults, the safety state and what the cloud has in force (`overrides`) |
| `POST /sim/faults {type, device?, minutes?}` | Starts a fault |
| `DELETE /sim/faults` | Clears every fault |
| `POST /sim/clock {speed}` | Changes the speed, 1–60 |

| Fault | Effect |
| ----- | ------ |
| `device-offline` | The device stops reporting (a `reset` or `restart` command brings it back) |
| `meter-gap` | The grid meter stops reporting, so intervals are estimated from the balance |
| `gateway-offline` | The uplink drops: readings buffer, and after 15 minutes the gateway undoes the cloud's settings |
| `command-rejected` | The device refuses one command |
| `output-drop` | An inverter (Inverter B by default) makes 80% of its output, for the "solar output below expected" alert |

## Options

`--speed`, `--seed`, `--start` and `--site` on the command line, or `SIM_SPEED`, `SIM_SEED`,
`SIM_START` and `SITE_ID`; see [Configuration](../deploy/configuration.md#simulator).
