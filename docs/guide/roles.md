# Roles and access

EcoManage is invite-only: there is no sign-up page. A site's **owner** invites people by email,
each with one role, and optionally an end date for their access. The server checks the role on
every request, so hiding a button is never the only protection.

## The three roles

- **Owner.** Runs the site: everything a manager can do, plus people, the site's details, the
  tariff, who may approve, and the site's own language model.
- **Manager.** Looks after money and decisions: bills, approving or declining recommendations,
  rules, the calendar. Can't manage people or change the site's details or tariff.
- **Installer.** Looks after the hardware: devices, commissioning, the gateway, the solar arrays
  and battery settings, and the site model. Never sees money and never decides on changes.
  Installers are usually invited with an end date.

## What each role can do

| | Owner | Manager | Installer |
| --- | :---: | :---: | :---: |
| Home: live flows, demand, battery | ✓ | ✓ | ✓ |
| Home: bill so far and projection | ✓ | ✓ | |
| Devices: see devices and readings | ✓ | ✓ | ✓ |
| Devices: ask for a change (reserve, EV limit …) | ✓ | ✓ | |
| Devices: scan, add, commission, edit, remove; log a visit | | | ✓ |
| History: energy | ✓ | ✓ | ✓ |
| History: cost, and the cost section of reports | ✓ | ✓ | |
| History: exports and reports | ✓ | ✓ | ✓ |
| Bills | ✓ | ✓ | |
| Bills: upload or type the utility's bill | ✓ | | |
| Inbox: see decisions, alerts and commands | ✓ | ✓ | ✓ |
| Inbox: approve or decline a decision | ✓ | ✓ unless set to "Owner only" | |
| Inbox: cancel a running command early | ✓ | ✓ | |
| Inbox: acknowledge, pause, fix or close an alert | ✓ | ✓ | ✓ |
| Inbox: explain a decision in plain words | ✓ | ✓ | |
| Settings → Site: name, address, time zone, currency, bill day, demand cap | ✓ | | |
| Settings → Site: solar arrays and battery | ✓ | | ✓ |
| Settings → Site: claim the gateway | ✓ | | ✓ |
| Settings → Tariff | edit | view | |
| Settings → Rules and approval | ✓ | ✓ | view |
| Settings → Rules → Explanations (the site's model and key) | ✓ | | |
| Settings → Calendar | ✓ | ✓ | view |
| Settings → Site model | ✓ | view | ✓ |
| Settings → People: invite, change roles, remove | ✓ | | |
| Settings → Notifications (your own) | ✓ | ✓ | ✓ |
| The audit log (through the API) | ✓ | | |

## Invitations

An owner invites someone from **Settings → People** with an email address, a role and, if the
access should end, a last day. The invitee gets an email with a link that works once, for 7 days.
Following it, they choose a name and a password (at least 8 characters), or, if they already have
an EcoManage account with that email, enter its password to add this site to it.

- A new invite to the same address replaces the previous unused one.
- An invite not yet accepted can be revoked.
- **Access until** is a date in the site's time zone: access lasts to the end of that day.
- The site always keeps at least one owner with lasting access: the last one can't be removed or
  demoted.

## One site per person, for now

A person can belong to several sites, but the app shows the first one they joined. Switching
between sites isn't in the app yet.

## Everything is recorded

Every change to a site (who, when, before and after) is written to the audit log, from approving a
recommendation to editing a tariff or claiming a gateway. Owners can read it through the
[API](../reference/api.md#audit-log).
