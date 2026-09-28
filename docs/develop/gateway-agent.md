# Gateway agent

`apps/gateway` is the reference edge gateway, a Node service for a Raspberry Pi 5. It speaks the
same MQTT topics as the simulator ([MQTT reference](../reference/mqtt.md)), so the cloud can't tell
them apart. Installing one is covered in [Installing a gateway](../deploy/gateway.md); this page is
about how it works.

## Layout

```text
src/
  main.ts        loads the config and factory file, starts everything
  identity.ts    its key, certificate request, claim proof and certificate
  uplink.ts      the MQTT connection: bootstrap → claim → site certificate
  agent.ts       polling, publishing, the buffer, jobs and commands
  modbus/        Modbus TCP and RTU, register decoding (SunSpec scale factors, types)
  ocpp/          the OCPP 1.6J server for chargers
  drivers/       a driver per protocol, from the device's profile
  commands.ts    applying commands within the safety limits, and undoing them
  scan.ts        finding devices on the networks and buses
  store.ts       SQLite (node:sqlite): readings buffer, devices, what to undo
  bench/         stand-in devices for tests and the dev stack
```

## Identity and claiming

1. On first start it makes an EC P-256 key and a certificate request, and keeps them in its data
   directory.
2. It connects with the shared bootstrap certificate, using its serial as the client id. The
   broker's access list lets that identity only publish `claim/<serial>/csr` and read
   `claim/<serial>/cert`.
3. Every 30 s it publishes `{ csr, proof, fw, ts }`, where `proof` is an HMAC of the request keyed
   by a key derived from its claim code (`@ecomanage/shared/claim-proof`), until an answer comes.
4. When the site claims it, the answer carries a certificate with the site id as its name, and the
   CA certificate. The agent checks the certificate is for its own key, names a site and is signed
   by that CA, stores it, and reconnects as the site. The broker's `site/%u/#` pattern keeps it to
   its own site from then on.

## Reading devices

Each device is read every `pollMs` according to its [profile](../reference/device-profiles.md):
Modbus register blocks (holding or input registers, with types, SunSpec scale-factor registers and
multipliers), states and fault bits; or, for chargers, OCPP `MeterValues`, `StatusNotification`
and transactions. Devices on one RS-485 bus take turns. Each reading is converted to the standard
field set in the site's sign convention and published on
`site/{siteId}/dev/{deviceId}/telemetry`.

**OCPP:** the agent is the chargers' local central system on `ws://<gateway>:8887/ocpp/<id>`
(subprotocol `ocpp1.6`, optional basic auth). Sessions become the reading's `session`, and limits
become charging profiles (`SetChargingProfile`).

## The buffer

Every reading goes into SQLite first. While the cloud is reachable they're sent at once; while it
isn't, they wait, for up to 7 days. On reconnect the agent reports its status (with the backlog)
first, then sends batches of 500 in order, with new readings queued behind them. The gateway status
message carries the backlog and its oldest reading, which Settings shows and which opens an alert
past an hour.

## Commands

Every command goes through `checkCommandSafety` from `@ecomanage/profiles`, the same code the
simulator runs:

- expired commands are refused, including ones that waited out an outage;
- parameters must be within the profile's limits, and no reserve may go below the site's battery
  floor (from the retained config);
- nothing runs past the action's `maxDurationMin`;
- a reserve change is put back at its end even if the cloud's revert never comes;
- after 15 minutes without the cloud, everything the cloud set is undone;
- forced discharge never goes below the reserve.

What to undo is kept in SQLite, so a restart still ends a command on time. The ack
(`{ ok, error?, ts }`) goes to `site/{siteId}/cmd/{id}/ack`.

## Jobs

`site/{siteId}/job/{id}` with `{ type, params }`, answered on `…/result`:

- **scan:** SunSpec devices on the configured TCP networks, meters on the RS-485 ranges, and
  connected chargers; only what the site doesn't have yet.
- **commission:** starts reading the device and checks a live read, the sign (from the device's
  role) and the energy balance at the meter.
- **restart:** the agent exits and systemd starts it again.

## Tests

The agent's tests run with the rest (see [Testing](./testing.md#gateway-agent)). Its devices are
fakes on localhost: a SunSpec inverter and a CT meter over real Modbus TCP
(`src/bench/fakeDevices.ts`) and OCPP chargers over a real WebSocket.
