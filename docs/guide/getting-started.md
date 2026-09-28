# Try the demo

The whole system runs on your computer with a simulated site, **Maple Grove School**: 86 kWp of
solar on two inverters, a 200 kWh battery, four EV chargers, a heat pump and a grid meter, with
weather, school-day loads, buses charging overnight and the occasional fault. No hardware needed.

## Start it

You need **Docker**: Docker Desktop on Windows or macOS, or Docker Engine with the Compose plugin
on Linux. Nothing else is installed on your computer.

```bash
git clone https://github.com/e-choness/eco-manage.git
cd eco-manage
docker compose up -d
docker compose run --rm mongo-seed   # the demo accounts and site (run again to reset them)
```

The first start builds the images and takes a few minutes. Then open <http://localhost:5173>.

## Sign in

Every demo account's password is `Demo1234!`. Try each role to see how the app changes:

| Email | Role on Maple Grove School | Sees |
| ----- | -------------------------- | ---- |
| `demo@ecomanage.io` | owner | Everything, including people, site details, tariffs and explanations |
| `manager@ecomanage.io` | manager | Money, decisions and rules; not people or site details |
| `installer@ecomanage.io` | installer, until 31 Dec 2026 | Devices, the site model and the gateway; no money |

## A tour

1. **Home.** Watch power move between the sources and the loads, and the demand bar against the
   cap. Drag the model to turn it.
2. **Inbox.** Open a decision: why it was suggested, its checks against the site's limits and the
   expected saving. Move the slider and watch the checks run again, then approve or decline it.
   Approved changes follow through to the device, then undo themselves on time.
3. **Bills.** The month so far and where it's heading, what solar and the battery saved, and a PDF
   statement.
4. **History.** Any range by hour, day or month. Export a CSV or schedule a report; the emails
   arrive in Mailpit at <http://localhost:8025>.
5. **Settings → Site model.** Generate the building from its size or its OpenStreetMap outline,
   or upload a 3D file.
6. **Settings → Rules → Explanations** (as the owner). Plug in a language model, then ask the
   Inbox to [explain a decision](./explanations.md) in plain words.
7. **Break something.** Take an EV charger offline for 10 minutes and watch the alert open, email
   you and then close itself:

   ```bash
   curl -X POST localhost:4100/sim/faults -H 'content-type: application/json' \
     -d '{"type":"device-offline","device":"ev3","minutes":10}'
   ```

   Other faults: `meter-gap`, `gateway-offline`, `command-rejected` and `output-drop`
   ([Simulator](../develop/simulator.md)).

## Local addresses

| Service | Address |
| ------- | ------- |
| Web app | <http://localhost:5173> |
| API | <http://localhost:3000> |
| Mailpit (every email the demo sends) | <http://localhost:8025> |
| Simulator state | <http://localhost:4100/sim/state> |
| Object storage console | <http://localhost:9001> |
| This documentation | <http://localhost:5174/eco-manage/>, after `docker compose --profile docs up -d docs` |

## Stop or reset

```bash
docker compose stop                 # stop, keeping the data
docker compose run --rm mongo-seed  # reset the demo accounts and data
docker compose down -v              # remove everything, data included
```

## Next

- The rest of this guide walks through each page, starting with [Home](./home.md).
- To share the demo or run EcoManage for real, see [Deploy](../deploy/index.md).
