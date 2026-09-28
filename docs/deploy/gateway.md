# Installing a gateway

The gateway is a small computer on the site's network (the reference is a **Raspberry Pi 5**) that
reads the site's devices and carries out approved commands. It connects out to the EcoManage broker
over MQTT with TLS, so the site needs no open ports.

| It does | How |
| ------- | --- |
| Reads inverters, batteries and meters | **Modbus TCP** on the network, and **Modbus RTU** over RS-485 with a USB adapter. Each device is read every few seconds according to its [profile](../reference/device-profiles.md) |
| Talks to EV chargers | It is the chargers' local **OCPP 1.6J** server, on `ws://<gateway>:8887/ocpp/<charge point id>` |
| Keeps readings through outages | Up to **7 days** in a local database, sent in order when the connection is back |
| Carries out commands safely | Refuses expired commands and values outside the device's limits, never takes the battery below its floor, ends every command on time on its own, and undoes everything the cloud set after **15 minutes** without a connection |
| Finds and commissions devices | Scans the network and the RS-485 bus, and runs the commissioning checks, when an installer asks in the app |

Not supported yet: heat pumps over SG-Ready relays, downloading new device profiles from the
cloud, certificate revocation, and a "safe test command" step during commissioning.

## How a gateway joins a site

Each gateway has a **serial number** and a one-time **claim code**, printed together as a QR code
on its label. On first start it makes its own key, connects with a shared **bootstrap
certificate** that only lets it ask for its own certificate, and waits. When an installer claims it
for a site in the app, EcoManage signs a certificate for that site and sends it back. From then on
the gateway connects with that certificate, and the broker lets it reach only its own site.

## 1. Register the gateway (once per gateway)

Registering creates the serial and claim code, and keeps only a hash of the code. In the
development stack:

```bash
docker compose exec api pnpm --filter @ecomanage/api gateway:register EM-GW-000123 --out /repo/factory.json
```

On a server running `infra/deploy`:

```bash
cd /opt/ecomanage/infra/deploy
sudo docker compose -f compose.yml run --rm seed \
  sh -c "cd api && node --import tsx src/scripts/registerGateway.ts EM-GW-000123"
```

It prints the claim code and the text for the QR code (`ecomanage-gw:1:<serial>:<code>`). Print
the label, and write the **factory file** for the gateway, `factory.json`:

```json
{ "serial": "EM-GW-000123", "claimCode": "<the code, without spaces>" }
```

Only the gateway and its label ever have the code. From Git Bash on Windows, prefix
`MSYS_NO_PATHCONV=1` so `/repo/…` isn't rewritten.

## 2. Set up the Raspberry Pi

Raspberry Pi OS Lite (64-bit), Node.js 24 or later, and a USB RS-485 adapter for meters.

1. **The agent:** the repository's `apps/gateway` with its packages (`pnpm deploy`), in
   `/opt/ecomanage-gateway`.
2. **Files:**
   - `/boot/firmware/ecomanage/factory.json`: the factory file from step 1.
   - `/etc/ecomanage/bootstrap.crt`, `bootstrap.key` and `ca.crt`: from the broker's certificates
     (`infra/mosquitto/certs` in development, the `mqtt_certs` volume on a server).
   - `/etc/ecomanage/gateway.json`: the configuration below.
3. **The service:**

   ```bash
   sudo useradd --system --home /var/lib/ecomanage-gateway --groups dialout ecomanage
   sudo cp apps/gateway/deploy/ecomanage-gateway.service /etc/systemd/system/
   sudo systemctl enable --now ecomanage-gateway
   journalctl -u ecomanage-gateway -f
   ```

   The unit restarts the agent whenever it exits, keeps the rest of the system read-only to it, and
   needs no extra privileges. The serial-port library ships a prebuilt binary for 64-bit Arm, so
   nothing is compiled on the Pi.

### Configuration

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

| Key | Meaning |
| --- | ------- |
| `mqttUrl` | The broker, as gateways reach it. Its name must be on the broker's certificate (`MQTT_SERVER_SAN` on a server) |
| `dataDir` | Where the gateway keeps its key, certificate, buffer and devices |
| `scan.tcp` | Networks to scan for SunSpec devices over Modbus TCP |
| `scan.rtu` | RS-485 buses to scan, with their settings and the range of unit ids |
| `ocpp` | The chargers' server: its port and an optional password (HTTP basic auth) |
| `devices` | Normally empty: commissioning adds devices and the gateway remembers them |

A device can also be listed up front (a bench, or a site set up without the app), with the device
id EcoManage gave it: `{ "id", "profileId", "type", "modbus": { "host", "port", "unitId" }` or
`{ "path", "baudRate", "unitId" }`, `"regOffset", "ocpp": { "chargePointId" } }`. `regOffset`
shifts every register of the device: `-1` for one documented from 1 (40001-style), or the
difference where its SunSpec block starts elsewhere.

**Chargers** are pointed at `ws://<gateway address>:8887/ocpp/<charge point id>` with the
subprotocol `ocpp1.6`, and the password if one is set.

## 3. Claim it for the site

1. Connect the gateway to the site's network and power it. It reaches the broker with the
   bootstrap certificate and waits; its log says "not claimed yet".
2. In the app, as the owner or an installer: **Settings → Site → Gateway**, then type the serial
   and claim code, or paste the QR text.
3. The card shows "Waiting to connect" until the certificate is signed, then the gateway's status.

The code is used up once the certificate is signed. A gateway belongs to one site: moving it, or
one that was reset (and made a new key), needs registering again.

## 4. Add the devices

In **Devices**, **Scan**, add what's found, and **commission** each device: a live read, the sign
check and the energy balance. See [Devices](../guide/devices.md#adding-and-commissioning-installers).

## Bench check

Before a first real site, check a gateway on a bench with one SunSpec inverter and one CT meter,
claimed for a test site:

1. **Scan:** the inverter is found with the `sunspec-inverter@3` profile, the meter as
   `ct-meter-3ph@2` on its RS-485 address.
2. **Commission** each: the live read, the sign check (the inverter positive while producing; the
   meter positive while importing) and, once both are live, the energy balance.
3. **Readings:** power, energy, voltage and frequency match the devices' own displays within their
   accuracy, and the meter's sign flips when the site exports.
4. **Export limit:** approve a 50% export limit for 10 minutes. The inverter's output caps, and
   returns when it ends (and on the inverter's own timeout if the gateway is unplugged).
5. **Outage:** unplug the gateway's uplink for 20 minutes. Readings are kept, the limit is undone
   after 15 minutes, and everything arrives in order when it's back (Settings → Site shows the
   backlog while it drains).

Profiles give 0-based register addresses for devices whose SunSpec common model is 65 registers
long. If an inverter's readings are off by one register, set its `regOffset`; if a write needs a
scale factor or a different type, add `scaleReg`, `mult` or `type` to the profile's write action.

## In the development stack

`docker compose --profile gateway up -d gateway gateway-devices` runs the agent (unclaimed, with
the development bootstrap certificate) beside stand-ins for the bench: a SunSpec inverter on Modbus
TCP port 502, a CT meter on 1503, and an OCPP charger that connects to the agent. Register it first
with `--out /repo/infra/gateway/factory.json` (gitignored). Its data lives in the `gateway_data`
volume, like the SD card of a real one.

## When it doesn't connect

See [Troubleshooting](./troubleshooting.md#a-claimed-gateway-stays-waiting-to-connect).
