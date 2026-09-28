# Home: the live site

Home is the site as it is right now: a 3D model of the building with power flowing between its
sources and loads, updated about every 5 seconds, and the few numbers that matter today around it.

![Home](/media/walkthrough-dark.webp){.shot}

## The picture

Each device sits where it is on the site, joined to the switchboard (the **hub**). Moving dots show
power: towards the hub from sources (solar, battery discharging, grid import), away from it to
loads (EV chargers, the heat pump, the building, battery charging, export). More kW means faster,
denser dots. Each device has a floating label with its power now.

- Drag to turn the model. It sways slowly on its own unless your system asks for reduced motion.
- A device that has stopped reporting is marked stale after 60 seconds and offline after 5
  minutes.
- Without WebGL (or if the 3D view can't load), Home draws the same flows as a flat diagram.
- Every value is also in a table for screen readers.

The model itself (the building, and where each device sits) is set up in
[Settings → Site model](./site-model.md).

## Around it

**Demand.** The current 15-minute interval: what has been bought from the grid so far, where it's
heading if the current power holds, the site's cap, and a marker at the highest interval of the
billing month so far. Keeping under the cap avoids a higher demand charge; see
[Bills and tariffs](./bills.md#demand).

**Bill.** The open bill so far and where it's heading by the end of the period (owners and
managers only).

**Battery.** Charge, the reserve it keeps back, power in or out, and, while discharging, how long
until it reaches the reserve.

**Needs you.** The top five open decisions and alerts from the [Inbox](./inbox.md), newest first.
Owners and managers can approve a decision here, or decline it with a reason. A line below lists
commands waiting or running.

**Today's prices.** The tariff's periods for today as a strip (off-peak, mid-peak, peak) with the
next peak marked. Days when the clocks change are 23 or 25 hours long, and the strip follows.

## How fresh is it?

Readings arrive from the gateway every 5 seconds. Home keeps one connection open to the server and
applies each new reading as it comes, typically well under a second after the device was read. If
the connection drops, the app reconnects and reloads the whole picture.
