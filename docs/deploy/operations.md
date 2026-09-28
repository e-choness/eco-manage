# Operations

Looking after a running installation. Commands are for the `infra/deploy` stack; in development,
drop `-f compose.yml` and run them from the repository root.

```bash
cd /opt/ecomanage/infra/deploy
alias dc='sudo docker compose -f compose.yml'
```

## Health and logs

```bash
dc ps                      # every service Up; api and web healthy
dc logs -f api             # or ingest, rules, worker, simulator, web …
dc logs --since 1h worker | grep -i error
```

- The API answers `GET /ping` with `pong`; compose checks it every 10 seconds.
- Services log JSON lines (pino). Useful ones: ingest's rejected readings, the worker's
  `priced intervals`, `nightly bills` and `forecast accuracy (MAPE %)`, and the rules service's
  failing rules.
- **Settings → Site → Gateway** shows each site's gateway: online, firmware, backlog and clock
  offset. A backlog older than an hour opens an alert.

## Updating

```bash
dc pull && dc up -d
```

or run `setup.sh` again, which also updates the repository (the compose file and broker settings)
and keeps `.env` and the data. Pin a version with `IMAGE_TAG=sha-<commit>` in `.env`. Services
create any new collections and indexes themselves when they start.

## Backups

| What | How |
| ---- | --- |
| **MongoDB** (everything: sites, people, devices, readings, intervals, bills, files) | `dc exec mongodb mongodump --archive --gzip > ecomanage-$(date +%F).archive.gz` |
| **The broker's certificates**, including the CA key | the `mqtt_certs` volume: `sudo docker run --rm -v ecomanage-demo_mqtt_certs:/c -v "$PWD":/b alpine tar czf /b/certs.tgz -C /c .` |
| **Settings and secrets** | `infra/deploy/.env` |
| **Uploaded 3D models** | the `objects_data` volume, or your S3 store's own backups |

Restore MongoDB with `dc exec -T mongodb mongorestore --archive --gzip --drop < ….archive.gz`.
Losing the CA means every gateway has to be registered and claimed again. Redis holds only caches,
events and job queues, which rebuild themselves.

A demo reset every night needs no backup: `dc run --rm seed` recreates it.

## Sites and people: provisioning

The app is invite-only, and inviting needs an owner. The `provision` script sets up sites and who
has access to them, from the command line or from a plan file, so the first owner of a new
installation (and any number of sites after it) needs no database work:

```bash
dc run --rm seed sh -c "cd api && node --import tsx src/scripts/provision.ts   --site 'Maple Grove School' --tz America/Toronto --owner owner@example.com"
```

In development: `docker compose exec api pnpm --filter @ecomanage/api provision --site … --owner …`.

It creates the site (if it doesn't exist) and gives the owner access: someone who already has an
account gets it straight away; anyone else gets an **invite**, emailed through the worker, and
chooses their own password when they accept it. No password ever goes through the script.

| Option | Does |
| ------ | ---- |
| `--site <name>`, `--owner <email>` | One site and its owner |
| `--tz <Area/City>` | The site's time zone (UTC otherwise; the owner can change it in Settings) |
| `--external-id <id>` | The site's id in the system the plan comes from (below) |
| `--file <plan.json>` | A whole plan instead; `--file -` reads it from standard input |
| `--dry-run` | Show the changes, make none |
| `--print-links` | Show each invite's link instead of emailing it, for installations without email yet. A link works once, for 7 days |
| `--prune` | Also remove access that provisioning gave and the plan no longer lists |

The owner then signs in, fills in the site's details, location and tariff in Settings, claims the
gateway and invites everyone else from Settings → People.

### From a directory or CRM

A plan lists sites and the people with access to each, which is the shape a directory group or a
CRM account export already has:

```json
{
  "sites": [
    {
      "externalId": "crm-4711",
      "name": "Maple Grove School",
      "tz": "America/Toronto",
      "currency": "CAD",
      "billDay": 1,
      "demandCapKw": 120,
      "members": [
        { "email": "priya.shah@maplegrove.example", "role": "owner" },
        { "email": "jamie.reyes@maplegrove.example", "role": "manager" },
        { "email": "ops@northsidesolar.example", "role": "installer", "until": "2026-12-31" }
      ]
    }
  ]
}
```

- **Sites** are found by `externalId` (the account's or group's id where the plan comes from), or by
  name when there is none. A site made in the app with the same name is adopted: it gets the
  external id instead of a second site being made. Any site detail Settings has can be set: `name`,
  `address`, `tz`, `lat`, `lon`, `currency`, `billDay`, `demandCapKw`.
- **Members** are matched by email address. `role` is `owner`, `manager` or `installer`; `until`
  is the last day of access (in the site's time zone), or left out for lasting access.
- **Applying a plan again changes only what differs,** so a scheduled export (nightly, or on every
  change in the directory) keeps EcoManage in step. With `--prune`, people removed from the group
  lose access too.
- **Provisioning owns what it grants.** Access it gave is marked as provisioned; if someone changes
  it in Settings → People, the next run puts it back as the plan says. Access given in the app is
  never removed by provisioning, though a plan that lists the same person takes it over.
- **Safe to run:** the whole plan is checked first, and nothing changes if any site in it has a
  problem: a site left without an owner with lasting access, access that would already have
  ended, an unknown role or time zone, a person or site listed twice. Every change is in the
  audit log as a system change.

Signing in is still EcoManage's own (email and password). Because access is keyed on the email
address and the plan carries no passwords, the same plans keep working if sign-in later moves to a
directory's single sign-on.

## Migrating from EcoManage 1

```bash
dc run --rm seed sh -c "cd api && node --import tsx src/scripts/migrate.ts"
```

brings a version 1 database up to date, and is safe to run repeatedly: old per-user data moves
aside, the current collections and indexes are created, and every user gets a site as its owner
(recorded in the audit log; the site's time zone is UTC until the owner sets it). Add
`--drop-legacy` to delete the retired collections.

## Resetting the demo

```bash
dc run --rm seed
```

It recreates the demo accounts (password `Demo1234!`) and the demo site's devices, clears its
readings and intervals (the simulator refills them), and computes the current bill. `setup.sh`
schedules it nightly at 04:15 in `/etc/cron.d/ecomanage-demo`.

## Rotating secrets

- `JWT_SECRET` or `REFRESH_TOKEN_SECRET`: change it in `.env` and `dc up -d api`. Everyone signs
  in again.
- `SECRETS_KEY`: owners must enter their language-model keys again.
- `S3_SECRET_KEY`: change it in `.env`, then `dc up -d` to restart the object store and every
  service that uses it together.
- The broker's CA: new certificates for every service and gateway. Remove the `mqtt_certs` volume
  and restart to make a new CA, then register and claim every gateway again.

## Data retention

Readings (the time series) expire after 13 months, and forecasts after 30 days. The 15-minute
intervals, bills, recommendations, commands, alerts and the audit log are kept. A report keeps its
last 24 files, and its emailed links work for 30 days.
