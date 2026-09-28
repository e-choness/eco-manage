# Introduction

EcoManage helps the people who run a building (a school, an office, a small business) see where
its energy goes and spend less on it, without putting the building at risk. It watches one
**site** through a small computer on the site's network, the **gateway**, which reads the
solar inverters, the battery, the EV chargers, the heat pump and the grid meter every few seconds.

![Home: the live site](/media/walkthrough-dark.webp){.shot}

## What you can do with it

| | |
| --- | --- |
| **See the site live** | [Home](./home.md) shows power moving between solar, the battery, the grid, the chargers, the heat pump and the building, updated about every 5 seconds, with demand against the site's cap and the bill so far. |
| **Look after the equipment** | [Devices](./devices.md) lists every device with its status and readings. Installers add new ones by scanning the network and commissioning them with checks. |
| **Understand the past** | [History](./history.md) shows energy and cost for any range by hour, day or month, and sends CSV exports and scheduled reports by email. |
| **Check the bills** | [Bills](./bills.md) computes each month's bill from the site's own tariff, shows what solar and the battery saved, and compares the estimate with the utility's bill. |
| **Decide on changes** | The [Inbox](./inbox.md) holds recommendations (discharge the battery before a peak, move EV charging to cheap hours …), each with its checks and expected saving. Nothing reaches a device until someone approves it. |
| **Hear about problems** | Also in the [Inbox](./inbox.md): alerts for silent devices, low solar, a battery below its reserve, demand near the cap and failed commands, by email too, closing themselves when the problem clears. |

## Ideas you'll meet

**Site.** One building or campus with its devices, tariff, calendar and people. Everything in
EcoManage belongs to a site. Times are shown in the site's time zone.

**Power and energy.** Power is in kW (how fast energy flows right now), energy in kWh (how much
flowed over a time). Readings arrive every 5 seconds; EcoManage also keeps a permanent record of
every **15-minute interval**, which bills, history and reports are built from.

**Demand.** The average power bought from the grid over a 15-minute interval (or 30, depending on
the tariff). Many commercial tariffs charge for the month's highest demand, so avoiding one peak
can matter more than saving energy all month. The site's **demand cap** is the level it tries to
stay under.

**Tariff.** How the utility prices energy: time-of-use periods (off-peak, mid-peak, peak) that
change with the season and the day, a demand charge, fixed fees and a credit for exported energy.
EcoManage prices every interval with the tariff in force on that day.

**Recommendation → command.** Rules look at the live data, the forecast and the tariff every
15 minutes and propose changes. An approved recommendation becomes a **command** that the gateway
carries out for a limited time and then undoes. The gateway enforces the device's safety limits
itself, whatever it is sent.

**Alert.** A problem EcoManage noticed. It stays open until its condition clears (then it closes
itself) or someone closes it with a cause.

**Roles.** Each person has one role on a site: **owner**, **manager** or **installer**. See
[Roles and access](./roles.md).

## Where to go next

- New here? [Try the demo](./getting-started.md): the whole system on your computer, with a
  simulated school.
- Running EcoManage for real? Start with [Deploy](../deploy/index.md).
- Changing the code? Start with [Development setup](../develop/index.md).
