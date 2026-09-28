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

## The first site and owner

The app is invite-only, and inviting needs an owner. On a new installation (without the demo),
create the first account in MongoDB, then run the migration, which gives every account without a
site its own site, with that account as its owner:

```bash
# a bcrypt hash of the first owner's password
dc run --rm seed sh -c "cd api && node -e \"require('bcryptjs').hash(process.argv[1], 10).then(console.log)\" 'the password'"
dc exec mongodb mongosh ecomanage --quiet --eval '
  db.users.insertOne({ email: "owner@example.com", name: "Sam Owner", password: "<the hash>",
                       isActive: true, createdAt: new Date() })'
dc run --rm seed sh -c "cd api && node --import tsx src/scripts/migrate.ts"
```

The owner then signs in, sets the site's details, time zone, location and tariff in Settings,
claims the gateway and invites everyone else. There is no single command for this yet.

## Migrating from EcoManage 1

`src/scripts/migrate.ts` (above) also brings a version 1 database up to date, and is safe to run
repeatedly: old per-user data moves aside, the current collections and indexes are created, and
every user gets a site as its owner (recorded in the audit log; the site's time zone is UTC until
the owner sets it). `-- --drop-legacy` also deletes the retired collections.

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
