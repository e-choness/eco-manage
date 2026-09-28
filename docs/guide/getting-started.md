# Getting started

EcoManage runs as a set of containers. You only need **Docker** (Docker Desktop on Windows or
macOS, or Docker Engine with the Compose plugin on Linux); nothing is installed on your machine.

## In GitHub Codespaces

The quickest way to look around: open the repository in a Codespace. It builds the stack, seeds the
demo site and opens the app (the first start takes a few minutes).

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/e-choness/eco-manage?quickstart=1)

It needs a 4-core machine and runs on your account's free Codespaces hours. See
[Hosting a demo](./demo-hosting.md) for other ways to share it.

## On your machine

```bash
git clone https://github.com/e-choness/eco-manage.git
cd eco-manage
docker compose up -d
docker compose run --rm mongo-seed   # the demo accounts and site (resets them)
```

Open <http://localhost:5173> and sign in with any of these (password `Demo1234!`):

| Email                    | Role on Maple Grove School    | Sees                                                   |
| ------------------------ | ----------------------------- | ------------------------------------------------------ |
| `demo@ecomanage.io`      | owner                         | Everything: people, site details, tariffs, explanations |
| `manager@ecomanage.io`   | manager                       | Money, decisions and rules; not people or site details |
| `installer@ecomanage.io` | installer (until 31 Dec 2026) | Devices, the site model and the gateway; no money      |

The simulator starts feeding the demo site straight away: a school with 86 kWp of solar across two
inverters, a 200 kWh battery, four EV chargers, a heat pump and a grid meter.

| Service          | Address                            |
| ---------------- | ---------------------------------- |
| Web app          | <http://localhost:5173>            |
| API              | <http://localhost:3000>            |
| Mailpit (emails) | <http://localhost:8025>            |
| Simulator state  | <http://localhost:4100/sim/state>  |
| This site        | <http://localhost:5174/eco-manage/> (`docker compose --profile docs up -d docs`) |

## What to try

1. **Home:** watch power move between the sources and loads, and demand against the cap.
2. **Inbox:** open a decision, read why it was suggested and its checks, move the slider, approve it.
3. **Bills:** the month so far and where it's heading; download a statement.
4. **History:** any range by hour, day or month; export a CSV (it arrives in Mailpit).
5. **Settings → Site model:** generate the building from its size, or upload a 3D file.
6. **Settings → Rules → Explanations** (as the owner): plug in a language model and explain a decision.
7. **Faults:** break a device on purpose and watch the alert open and close:

   ```bash
   curl -X POST localhost:4100/sim/faults -H 'content-type: application/json' \
     -d '{"type":"device-offline","device":"ev3","minutes":10}'
   ```

## Configuration

A fresh clone works with no setup: the API reads `apps/api/.env.example` and then `apps/api/.env`
(gitignored) if it exists. Put real secrets there. Every setting is listed in
[Deployment](../DEPLOYMENT.md).

## Next

- [What it does](./features.md): every page and what's behind it.
- [Architecture](../ARCHITECTURE.md): the services and how data moves.
- [Testing](../TESTING.md): running the checks (all in Docker).
