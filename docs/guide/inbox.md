# Inbox: decisions and alerts

Everything that needs someone, in one list: **decisions** waiting for approval, **alerts**, and
**commands** waiting or running on devices. The badge on the Inbox icon counts decisions waiting and
open alerts, and updates live.

![Inbox with a decision open](/screenshots/inbox.png){.shot}

- Filter by type (decide, alerts, active commands) and by open or closed; the tabs show counts.
- Items are in the order they arrived; **Show more** loads older ones.
- The selected item is in the address (`?item=`), and links in emails open straight to theirs.

## Decisions

A decision is a **recommendation**: a change to one device for a time window, proposed by a rule
or asked for by a person on the [Devices](./devices.md#asking-for-a-change) page. Opening one shows:

- **Why:** the rule, the window and the numbers it looked at.
- **Checks** against the site's limits, each passing or failing.
- **The expected saving** and how it was worked out.
- **Who can decide** and by when, and exactly **what approving sends** to the device.
- A **timeline** that follows the command once approved.

**Adjusting.** Numbers with limits (the discharge power, a current limit …) are sliders within the
device's safe range. After each change the checks run again; Approve stays off while a check fails
or a re-check is pending.

**Approving** runs every check again against the site as it is at that moment, then creates the
command. If two people approve at once, one of them gets "already decided". **Declining** needs a
reason; the reasons are counted per rule in Settings → Rules, to show which rules need tuning.

**Who decides:** owners and managers, or owners only if Settings → Rules → Approval says so.
Installers never decide. A decision not made in time **expires**: by default 15 minutes before its
window starts, and a proposal emails the approvers when it arrives (both in Settings → Rules).

**Explain in plain words** asks a language model to explain the decision, if one is set up. See
[Explanations](./explanations.md).

## The rules

Rules run every 15 minutes (:00, :15, :30, :45 site time) on the live data, the 48-hour forecast
and the tariff. Each can be turned on or off, and its limits changed, in Settings → Rules.

| Rule | What it proposes | When | Default limits |
| ---- | ---------------- | ---- | -------------- |
| **Peak shaving** | Discharge the battery at a set kW through the coming peak | The forecast net load in the next tariff peak goes over the cap minus a margin | Keep at least 30% charge on school days, 15% on others; at most 60 kW; 10 kW margin |
| **EV off-peak** | Pause a fleet vehicle's charging now, and charge at full current from the cheapest hours until it leaves | A fleet vehicle is charging in mid or peak hours and its usual energy fits the cheap hours before departure | 20% energy buffer; fleet vehicles only |
| **EV limit near cap** | Limit the busiest charger's current for this interval and the next | This interval is heading within 5% of the cap while EVs charge | Never below 10 A; decide within 10 minutes |
| **Heat pump pre-condition** | Boost the heat pump before a peak, then block it during the peak (SG-Ready) | A peak starts within 2 hours and the heat pump is running | 60 min boost, block up to 120 min |
| **Storm reserve** | Raise the battery reserve until a storm warning ends | A thunderstorm warning within the lead time | 80% reserve, 12 h ahead; off by default |
| **Zero export at low prices** | Cap the largest inverter's export (up to 4 hours) | The export rate is at or below a threshold and there's a surplus the battery can't take | At or below 0¢ |

Each rule proposes at most one open decision per device and window, and rules only ever propose:
nothing reaches a device without an approval.

## After approval: commands

An approved decision becomes a **command**. It is sent to the gateway when its window starts, then:

1. **Sent → acknowledged.** The gateway accepts it (or refuses it, with its reason). No answer
   within 60 seconds fails the command.
2. **Verified.** The readings must show the change within 5 minutes: the battery's power, the new
   reserve or current limit, the heat pump's mode, the inverter's output. If not, it fails and is
   undone.
3. **Reverted** at the end of the window: the device goes back to how it was.

The gateway also protects the site on its own, whatever it's sent: it refuses expired commands and
values outside the device's limits, never takes the battery below its floor, ends everything on
time even if the cloud's "undo" never arrives, and undoes everything the cloud set after 15 minutes
without a connection.

Owners and managers can **cancel early**: a command not sent yet is dropped, one already running is
undone. A failed command opens an alert and emails owners and managers.

## Alerts

| Alert | Opens when | Closes when |
| ----- | ---------- | ----------- |
| **Device not reporting** | A device has been silent for 5 minutes | It reports again |
| **Solar output below expected** | An inverter makes under 90% of what's expected for 2 hours of daylight | It's within 5% for an hour of daylight |
| **Battery below reserve** | The charge is more than half a point under the reserve | It's back at the reserve |
| **Demand close to the cap** | This interval is heading for 90% of the cap or more | It's heading under 85% |
| **Command confirmed late** (information) | A command sent over 30 seconds ago has no answer yet | Someone closes it with a cause |
| **Command failed** | A command failed | Someone closes it with a cause |
| **Gateway holding old readings** | The gateway has readings older than an hour waiting to send | The backlog is newer than an hour |

An alert shows what triggered it, how it closes, a timeline and what you can do now:

- **Acknowledge:** you're on it (the others see who).
- **Pause emails** for 24 hours while the condition is still true.
- **Remote fix,** when the device's profile has one: a charger's soft reset, an inverter's restart.
- **Resolve** with a cause (fixed on site, known issue, device replaced) and a note, once the
  condition has cleared. The cause and note go on the device's maintenance log.
- **False alarm,** even while the condition is true: it closes the alert, mutes that rule for that
  device for 7 days, and flags the rule's threshold for review.

Alerts that can clear close themselves when their condition does. One occurrence someone closed
doesn't reopen.

## Emails

Depending on each person's [notification settings](./settings.md#notifications):

- New alerts as they open (not information ones); warnings wait for your quiet hours to end. Command
  failures always go to owners and managers.
- **Escalation:** an alert nobody has acknowledged after the owner's escalation time (30 minutes by
  default) is emailed to the owner.
- **New proposals** to the approvers named in the approval settings.
- A **daily summary** after 07:00: yesterday's cost, grid energy, peak, savings and open alerts.
