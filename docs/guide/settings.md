# Settings

Seven tabs: **Site, Tariff, Rules, Calendar, Site model, People and Notifications**. The tab is in
the address (`?tab=`), and the arrow keys move between tabs.

![Settings](/screenshots/site-model.png){.shot}

## Saving

Each section is a draft until you save. Switching tabs keeps your drafts, and a bar at the bottom
lists the tabs with changes. **Save** sends each changed section on its own, only the fields you
changed; if one fails, its draft stays with the error and the others are saved. Leaving the page
with unsaved changes asks first. **People** changes are the exception: they apply straight away.

Tabs you can't edit are shown read-only with a note saying who can. See
[Roles and access](./roles.md).

## Site

- **Details** (owner): name, address, time zone, location (latitude and longitude, used for the
  solar forecast, the weather and OpenStreetMap), currency (CAD, USD, EUR, GBP or AUD), bill day
  (1–28) and the **demand cap** in kW.
- **Solar arrays** (owner, installer): each array's name, the inverter it's on, its size in kWp,
  its tilt (0–90°) and which way it faces (0–360°, 180 = south). The solar forecast uses them.
- **Battery** (owner, installer): usable capacity, maximum power, and the **floor**: the lowest
  charge any command may take it to (at least 10%). The floor is sent to the gateway, which
  enforces it itself; if the gateway can't be reached, it's sent when it next connects.
- **Gateway:** whether it's online (reported in the last 90 seconds), its firmware, uptime,
  readings waiting to be sent and the oldest of them, and its clock offset. Owners and installers
  claim a new gateway here with the serial and claim code from its label, or by pasting the text of
  its QR code. See [Installing a gateway](../deploy/gateway.md).

## Tariff

The owner edits it; managers can view it. Each period's prices show as a strip per season and day
type, gaps and overlaps are flagged as you type, and saving creates a new version from a date you
choose (today at the earliest). Start from a template (Commercial TOU-D or Flat). How tariffs work:
[Bills and tariffs](./bills.md#tariffs).

## Rules

For owners and managers (installers can view):

- **Approval:** who can approve (owners and managers, or owners only), how long before a window a
  decision must be made (15 minutes by default), and who is emailed new proposals (the approvers,
  the owner, or nobody).
- **Each rule** on or off, with its limits: for example the minimum battery charge on school days
  and other days, the maximum discharge and the forecast margin for peak shaving. Each rule also
  shows how often it was declined in the last 30 days, and why. The rules and their defaults are
  listed in the [Inbox](./inbox.md#the-rules) page.
- **Explanations** (owner): the site's own language model. See [Explanations](./explanations.md).

The rules pick up saved changes on their next run.

## Calendar

When the site is in use, for the load forecast and the rules (peak shaving keeps more charge on
school days). Owners and managers edit it.

- **Terms** and **days off,** each with a name and dates.
- **Opening hours** on weekdays, and whether weekends are open or closed.

A day counts as open if it's in a term, not a day off, and not a weekend (unless weekends are open).
A site with no calendar treats weekdays 08:00–17:00 as open.

## Site model

The 3D model Home draws, and where each device sits on it. See [The site model](./site-model.md).

## People

The owner invites people by email with a role and, optionally, an end date; changes roles and end
dates; removes people; and revokes invites not yet accepted. See
[Roles and access](./roles.md#invitations).

## Notifications

Each person's own email settings for this site:

- **Send to:** the address (your sign-in address by default).
- **Alerts** as they open, **daily summary**, **new proposals** to decide on, and **command
  failures** (always on for owners and managers).
- **Quiet hours** (22:00–06:30 by default): warnings wait until they end; failures always send.
  Set both ends, or neither to turn quiet hours off.
- **Escalation** (owners): email me if an alert isn't acknowledged within this many minutes (5 to
  1,440; 30 by default).

Your password and name are under your avatar → **Profile**. The light or dark theme switch is
saved with your account, so it follows you to other devices.
