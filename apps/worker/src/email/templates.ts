import type { AlertDoc, RecommendationDoc, SiteDoc } from '@ecomanage/db';
import type { Message } from './mailer';
import type { Recipient } from './notify';

// Plain, short emails (App v2 tone): what happened, where, and a link to act on it.

export interface DailySummary {
  date: string; // local YYYY-MM-DD
  intervals: number;
  costCents: number; // energy cost − export credit (demand is charged per billing period)
  gridKwh: number;
  peak: { kw: number; at: Date } | null;
  savedCents: number | null; // solar + battery, vs buying all energy from the grid
  openAlerts: string[];
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(cents / 100);

const time = (at: Date, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(at);

const longDate = (date: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

/** Builds text and HTML from the same lines; the last line is the call to action. */
const message = (to: string, subject: string, lines: string[], link: { label: string; url: string }): Message => ({
  to,
  subject,
  text: [...lines, '', `${link.label}: ${link.url}`, '', 'Change what you receive in Settings → Notifications.'].join('\n'),
  html: [
    ...lines.map((l) => (l ? `<p style="margin:0 0 8px">${escape(l)}</p>` : '')),
    `<p style="margin:16px 0"><a href="${escape(link.url)}">${escape(link.label)}</a></p>`,
    '<p style="margin:0;color:#888;font-size:12px">Change what you receive in Settings → Notifications.</p>',
  ].join('\n'),
});

const alertLink = (appUrl: string, a: AlertDoc) => ({ label: 'Open it in the Inbox', url: `${appUrl}/inbox?alert=${a._id}` });

export const alertEmail = (site: SiteDoc, a: AlertDoc, r: Recipient, appUrl: string): Message =>
  message(
    r.prefs.email,
    `[${site.name}] ${a.title}`,
    [`${a.detail || a.title}.`, `Opened ${time(a.openedAt, site.tz)} (${site.tz}).`, a.condition === 'active' ? 'It closes by itself when the condition clears.' : ''],
    alertLink(appUrl, a)
  );

export const escalationEmail = (site: SiteDoc, a: AlertDoc, r: Recipient, appUrl: string, now: Date): Message => {
  const minutes = Math.round((now.getTime() - a.openedAt.getTime()) / 60_000);
  return message(
    r.prefs.email,
    `[${site.name}] Not acknowledged for ${minutes} min: ${a.title}`,
    [`Nobody has acknowledged this alert since ${time(a.openedAt, site.tz)}.`, `${a.detail || a.title}.`],
    alertLink(appUrl, a)
  );
};

export const dailyEmail = (site: SiteDoc, s: DailySummary, r: Recipient, appUrl: string): Message => {
  const cur = site.currency || 'USD';
  const lines = s.intervals
    ? [
        `${longDate(s.date)} at ${site.name}:`,
        `Energy cost ${money(s.costCents, cur)} for ${s.gridKwh} kWh from the grid.`,
        s.peak ? `Peak demand ${s.peak.kw} kW at ${time(s.peak.at, site.tz).split(', ')[1] ?? ''}.` : '',
        s.savedCents != null ? `Solar and battery saved ${money(s.savedCents, cur)}.` : '',
      ]
    : [`${longDate(s.date)} at ${site.name}: no meter data for the day.`];
  lines.push(s.openAlerts.length ? `Open alerts (${s.openAlerts.length}): ${s.openAlerts.slice(0, 5).join('; ')}.` : 'No open alerts.');
  return message(r.prefs.email, `[${site.name}] Yesterday: ${s.intervals ? money(s.costCents, cur) : 'no data'}`, lines, { label: 'See the day in History', url: `${appUrl}/history?date=${s.date}` });
};

export const proposalEmail = (site: SiteDoc, rec: RecommendationDoc, r: Recipient, appUrl: string): Message => {
  const cur = site.currency || 'USD';
  const by = time(rec.expiresAt, site.tz).split(', ')[1] ?? '';
  const failing = (rec.checks ?? []).filter((c) => !c.pass);
  return message(
    r.prefs.email,
    `[${site.name}] Decide by ${by}: ${rec.title}`,
    [
      `${rec.title}, ${time(rec.window.start!, site.tz)}–${time(rec.window.end!, site.tz).split(', ')[1] ?? ''}.`,
      ...(rec.inputs ?? []).map((i) => `${i.label}: ${i.value}`),
      `Expected saving ${money(rec.expectedSavingCents ?? 0, cur)}${rec.calc ? ` (${rec.calc})` : ''}.`,
      failing.length ? `Not ready to approve: ${failing.map((c) => c.text).join('; ')}.` : 'All checks pass.',
      `It expires at ${by} if nobody decides. Nothing is sent to the device until someone approves.`,
    ],
    { label: 'Decide in the Inbox', url: `${appUrl}/inbox?recommendation=${rec._id}` }
  );
};
