# What it does

EcoManage watches one site (a school, an office, a small business) through a gateway on its
network, and helps the people who run it spend less on energy without risking the building. Power
is in kW and energy in kWh; everything is shown in the site's own time zone.

Who sees what depends on their role on the site: **owner** (everything), **manager** (money,
decisions and rules) or **installer** (devices, the site model and the gateway; no money). The
server enforces it on every request.

## Home

![Home: the live site](/screenshots/home.png){.shot}

The site as a 3D model with power flowing between solar, the battery, the grid, EV chargers, the
heat pump and the building, updated about every 5 seconds. Beside it: demand in the current
15-minute interval against the cap and where it's heading, the month's peak, the bill so far and
where it's heading, the battery's charge and reserve, today's prices, and anything that needs you.
Browsers without WebGL get a 2D flow diagram, and every value is also in a table for screen readers.

It follows your system's light or dark theme, or the one you choose:

![Home in the light theme](/screenshots/home-light.png){.shot}

## Devices

![Devices](/screenshots/devices.png){.shot}

Every device with its status (live, stale after 60 s without data, offline after 5 minutes), latest
reading and a 24-hour chart. Installers **scan** the site's network through the gateway, add what
it finds, and **commission** each device: a live read, a sign check and the energy balance must
pass before it goes live. Visits and repairs go on each device's maintenance log. Owners and
managers can ask for a manual change (a battery reserve, an EV limit, a heat-pump mode), which then
goes through the same checks and approval as a recommendation.

## History

![History](/screenshots/history.png){.shot}

Any date range by hour, day or month, with totals for solar, the grid, the battery and the loads,
and the cost of each. A CSV of every 15-minute interval is emailed as a link.

## Bills

![Bills](/screenshots/bills.png){.shot}

Bills are computed from the site's tariff: time-of-use energy prices, a demand charge on the
month's highest 15 minutes, fixed fees and export credit. Tariffs have versions, so a price change
only affects bills from its date. For each month: the estimate line by line, the peak and when it
happened, the savings from solar and battery shifting (after 7 days of data), a PDF statement, and
the utility's own bill uploaded as a PDF or CSV and compared with the estimate. Spending for any
date range is one click away.

## Inbox: decisions, alerts, commands

![Inbox with a decision open](/screenshots/inbox.png){.shot}

**Recommendations** come from rules that run every 15 minutes on live data, the forecast, the tariff
and the site's limits:

| Rule | What it proposes |
| ---- | ---------------- |
| Peak shaving | Discharge the battery before a demand peak |
| EV off-peak | Pause fleet charging until the cheap hours, still full by departure |
| EV limit near cap | Limit charging current while demand is near the cap |
| Heat pump pre-condition | Boost before a peak, then block during it (SG-Ready) |
| Storm reserve | Raise the battery reserve before a storm warning |
| Zero export at low prices | Cap solar export when the export rate is too low |

Each shows why it was suggested, its checks against the site's limits and the expected saving.
Nothing reaches a device until an owner (or a manager, if the owner allows it) **approves**; the
checks run again at that moment. Then the command goes to the gateway, is confirmed, ends on
time on its own, and the actual saving is measured the next day. Rules and their limits are in
Settings → Rules. With a language model plugged in, any recommendation can be
[explained in plain words](./explanations.md).

**Alerts** open when a device goes silent, solar is well below what the weather says, the battery
drops below its reserve, demand nears the cap, a command fails or is slow, or the gateway is
holding old readings. They email the right people, escalate if nobody acknowledges them, offer
remote fixes from the device's profile, and resolve themselves when the problem clears.

## Reports

Scheduled (weekly or monthly, in the site's time) or one-off reports in PDF, CSV or Excel,
with the sections you choose, emailed to the people you pick as links that work for 30 days.

## Settings

Site details and location, solar arrays (for the forecast), the battery's floor, tariffs from
templates, rules and who can approve, the school calendar, notification preferences, people and
invitations (with roles and an end date for installers), and the gateway.

**Site model:** the 3D scene Home draws. Generate it from the building's width and depth, or pull
its outline from OpenStreetMap, then set storeys and roof array rows; or upload a glTF, GLB, OBJ,
FBX or IFC file (up to 30 MB), which is converted, simplified and compressed in a sandbox. Then
place each device and the switchboard on it.

![Settings: the site model](/screenshots/site-model.png){.shot}

## Forecasts

Solar and site load for the next 48 hours in 15-minute steps, from the weather (Open-Meteo, or the
simulator's own), the arrays' tilt and orientation, and the calendar. The rules and the bill
projection use them.

## The gateway

A reference agent for a Raspberry Pi 5 on the site's network. It reads inverters, batteries and
meters over Modbus TCP and RS-485 from their profiles, is the local OCPP 1.6J server for EV
chargers, keeps 7 days of readings when the internet is down, and enforces the safety limits on
every command itself. It's claimed for a site with the QR code on its label. See
[Gateway agent](../GATEWAY.md).

## Everything is recorded

Every change (who, when, before and after) is in the audit log, from approving a recommendation to
editing a tariff or claiming a gateway.
