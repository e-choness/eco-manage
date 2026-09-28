# Gateway agent (`apps/gateway`, P5-04)

The reference edge gateway: a Node service for a Raspberry Pi 5 that sits on the site's network,
talks to the devices and speaks the same MQTT topics as the simulator (`packages/shared/src/mqtt.ts`),
so the cloud can't tell them apart.

| Part | What it does |
| ---- | ------------ |
| Claim | First boot: makes its own key, connects with the shared bootstrap certificate and asks for a certificate, proving it knows its claim code. The installer claims it in the app; from then on it connects as the site only. |
| Modbus TCP / RTU | Polls each device every `pollMs` from its profile (`packages/profiles`): register blocks, SunSpec scale factors, states and fault bits. RS-485 via a USB adapter; devices on one bus take turns. |
| OCPP 1.6J | The chargers' local central system on `ws://<gateway>:8887/ocpp/<charge point id>` (subprotocol `ocpp1.6`, optional basic auth). Meter values, status and sessions become readings; limits become charging profiles. |
| Buffer | SQLite (`node:sqlite`) in its data directory. Readings wait there while the cloud is away (7 days) and are resent in order, 500 at a time. |
| Commands | The same limits as the simulator (`checkCommandSafety`): expired commands refused, parameters within the profile, reserve above the battery floor, nothing past its end, everything undone after 15 minutes offline. What to undo is kept in SQLite, so a restart still ends a command on time. |
| Jobs | Scan (SunSpec on the configured networks, meters on the RS-485 ranges, connected chargers), commission (live read, sign check, energy balance) and restart. |

Not yet: SG-Ready heat pumps (relay outputs), profile downloads from the cloud, certificate
revocation, and the "safe test command" step of commissioning.

## Files

- **Factory file** (`/boot/firmware/ecomanage/factory.json`): `{ "serial", "claimCode" }`, written
  by the registration step below. Only the gateway and its label have the code.
- **Config** (`/etc/ecomanage/gateway.json`, or `GATEWAY_CONFIG`):

```json
{
  "mqttUrl": "mqtts://mqtt.example.com:8883",
  "dataDir": "/var/lib/ecomanage-gateway",
  "bootstrap": { "cert": "/etc/ecomanage/bootstrap.crt", "key": "/etc/ecomanage/bootstrap.key", "ca": "/etc/ecomanage/ca.crt" },
  "scan": {
    "tcp": ["192.168.1.0/24"],
    "rtu": [{ "path": "/dev/ttyUSB0", "baudRate": 9600, "parity": "none", "ids": [1, 16] }]
  },
  "ocpp": { "port": 8887, "password": "change-me" },
  "devices": []
}
```

`devices` is normally empty: commissioning adds them, and the gateway remembers them. A device can
be listed up front (a bench, or a site set up without the app) with the cloud's device id:
`{ "id", "profileId", "type", "modbus": { "host", "port", "unitId" } | { "path", "baudRate", "unitId" }, "regOffset", "ocpp": { "chargePointId" } }`.
`regOffset` shifts every register of the device: `-1` for one documented from 1 (40001-style), or
the difference where its SunSpec block starts elsewhere.

## Registering and claiming

1. Factory, once per gateway (writes the factory file, prints the code and the QR text for the
   label; only a hash of the code is kept):

   ```bash
   docker compose exec api pnpm --filter @ecomanage/api gateway:register EM-GW-000123 --out /repo/factory.json
   ```

   From Git Bash on Windows, prefix `MSYS_NO_PATHCONV=1` so `/repo/…` isn't rewritten.

2. Site: power the gateway with a network cable. It connects with the bootstrap certificate and
   waits (log: "not claimed yet").
3. App: Settings → Site → Gateway → type the serial and claim code, or paste the QR text. The card
   shows "Waiting to connect" until the certificate is signed, then the gateway's status.

The code is used up once the certificate is signed. A gateway that has been reset (new key) needs a
new registration. A gateway belongs to one site; moving it means registering it again.

## On a Raspberry Pi 5

Raspberry Pi OS Lite (64-bit), Node 24 or later, and a USB RS-485 adapter for meters:

```bash
sudo useradd --system --home /var/lib/ecomanage-gateway --groups dialout ecomanage
# the agent: the workspace's apps/gateway with its packages (pnpm deploy), under /opt/ecomanage-gateway
sudo cp apps/gateway/deploy/ecomanage-gateway.service /etc/systemd/system/
sudo systemctl enable --now ecomanage-gateway
journalctl -u ecomanage-gateway -f
```

The unit restarts the agent when it exits (a restart job does exactly that). `serialport`'s
prebuilt binary for Linux arm64 is used; nothing is compiled on the Pi.

## In the dev stack

`docker compose --profile gateway up -d gateway gateway-devices` runs the agent (unclaimed, with the
dev bootstrap certificate) next to stand-ins for the bench: a SunSpec inverter on Modbus TCP 502, a
CT meter on 1503 and an OCPP charger that connects to the agent (`apps/gateway/src/bench`). Register
it first with `--out /repo/infra/gateway/factory.json` (gitignored). Its SQLite store is the
`gateway_data` volume.

## Bench acceptance (plan P5-04)

"Works with one real SunSpec inverter and one CT meter on a bench." With the gateway claimed for a
test site, the inverter on the LAN and the meter on RS-485 (unit id in the scan range):

1. **Scan** (Devices → Scan): the inverter is found as "maker model" with `sunspec-inverter@3`; the
   meter as `ct-meter-3ph@2` on its RS-485 address.
2. **Commission** each: Live read, the sign check (inverter positive while producing; the meter
   positive while importing) and, once both are live, the energy balance pass.
3. **Readings**: power, energy, voltage and frequency match the devices' own displays within their
   accuracy; the meter's power sign flips when the site exports.
4. **Export limit**: approve a 50% export limit for 10 minutes; the inverter's output caps, and
   returns when it ends (and on the inverter's own timeout if the gateway is unplugged).
5. **Outage**: unplug the gateway's uplink for 20 minutes: readings are kept, the limit is undone
   after 15 minutes, and everything arrives in order when it is back (Settings → Site shows the
   backlog while it drains).

Profiles give 0-based register addresses for devices whose SunSpec common model is 65 registers
long. If the inverter's readings are off by one register, set `regOffset` for it; if a write needs
a scale factor or type, add `scaleReg`, `mult` or `type` to the profile's write action.
