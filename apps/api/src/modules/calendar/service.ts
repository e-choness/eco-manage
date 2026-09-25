import { Calendar, recordAudit, type CalendarDoc, type SiteDoc } from '@ecomanage/db';
import type { CalendarInput, CalendarView } from '@ecomanage/shared';

// Settings → Calendar (plan P2-06). One calendar per site; a site without one is closed on
// weekends and open 08:00–17:00 on weekdays outside any term, which the forecast treats as closed.

const EMPTY: CalendarInput = { terms: [], daysOff: [], open: '08:00', close: '17:00', weekends: 'closed' };

const ranges = (list: CalendarDoc['terms'] | undefined) => (list ?? []).map((r) => ({ name: r.name!, start: r.start!, end: r.end! }));

const toView = (c: CalendarDoc | null): CalendarView =>
  c
    ? {
        terms: ranges(c.terms),
        daysOff: ranges(c.daysOff),
        open: c.open,
        close: c.close,
        weekends: c.weekends as CalendarInput['weekends'],
        updatedAt: (c as unknown as { updatedAt?: Date }).updatedAt?.toISOString() ?? null,
      }
    : { ...EMPTY, updatedAt: null };

export const getCalendar = async (site: SiteDoc): Promise<CalendarView> => toView(await Calendar.findOne({ siteId: site._id }).lean<CalendarDoc>());

const byStart = <T extends { start: string }>(list: T[]) => [...list].sort((a, b) => a.start.localeCompare(b.start));

/** Replaces the calendar. The load forecast (P2-10) picks it up on its next hourly run. */
export const putCalendar = async (site: SiteDoc, userId: string, input: CalendarInput): Promise<CalendarView> => {
  const before = await getCalendar(site);
  const next = { ...input, terms: byStart(input.terms), daysOff: byStart(input.daysOff), updatedBy: userId };
  const doc = await Calendar.findOneAndUpdate({ siteId: site._id }, { $set: next }, { upsert: true, new: true }).lean<CalendarDoc>();
  const { updatedAt: _, ...beforeData } = before;
  await recordAudit({ siteId: site._id, userId, action: 'calendar.update', target: `calendar:${site._id}`, before: beforeData, after: input });
  return toView(doc);
};
