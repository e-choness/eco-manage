# Devices

Every device on the site in one list, with its status, power now and last reading. Select one to
see its details on the right; the address keeps it (`?device=`), so links from alerts open it
straight away.

![Devices](/screenshots/devices.png){.shot}

## Status

| Status | Meaning |
| ------ | ------- |
| **Live** | Reporting normally |
| **Stale** | No reading for 60 seconds |
| **Offline** | No reading for 5 minutes. After 5 minutes a "Device not reporting" alert opens too |
| **Pending** | Added but not commissioned yet: the gateway doesn't read it |

## A device's details

- **Power now** and the **last 24 hours** by hour. Hours made partly from estimates (a gap in
  the readings filled from power) are paler.
- **Model, protocol and address**, the **profile** that says how to read and control it, and the
  quality of its data.
- **Commissioning:** when and by whom.
- **Maintenance log:** installers' visit notes, and the causes and notes people give when they
  close its alerts. The newest 20 are shown.
- **The last message** exactly as received, for troubleshooting.

## Asking for a change

Owners and managers can ask for a change the device supports: a battery reserve, a charger's
current limit, a heat-pump mode and so on (restarts and schedules aren't offered here). Numbers
with limits are sliders within the device's safe range, and actions that run for a time end at the
end of the window you pick.

The request goes to the [Inbox](./inbox.md) as a decision with the same checks as a rule's
proposal: the device supports the action, the values are within its limits, the window is still
ahead and not too long, and the battery stays above its hardware floor. It then needs approving
like any other. Installers see the controls but can't use them.

## Adding and commissioning (installers)

1. **Scan.** The gateway looks for devices on the site's network: SunSpec inverters and batteries
   on the local network, meters on the RS-485 bus, and chargers connected to it. Only devices the
   site doesn't have yet are listed. A scan takes up to 20 seconds.
2. **Add** what it found. It appears as *pending*.
3. **Commission** it. The gateway starts reading it and runs three checks: a **live read**, the
   **sign check** (power in the right direction: an inverter positive while producing, a meter
   positive while importing) and the **energy balance** (the site's sources and loads add up at the
   meter). When all pass the device goes live; a failed check leaves it pending with the reason.

A pending device can be commissioned later from its details. Installers can also rename a device,
change its role or address, replace its profile, and remove it (its readings are kept until they
expire, after 13 months). **Log a visit** adds a note to the maintenance log.

## Sign convention

EcoManage counts power at the switchboard: **positive flows in** (solar, battery discharging, grid
import) and **negative flows out** (loads, battery charging, export). The Devices list shows loads
as positive numbers to keep them readable; the data underneath keeps the signs.
