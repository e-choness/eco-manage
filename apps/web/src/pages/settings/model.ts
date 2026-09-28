import type { ApprovalConfig, BatteryPatch, CalendarInput, NotificationPrefs, PvArraysInput, SiteModelInput, SitePatch, TariffInput } from "@ecomanage/shared"

// Settings drafts (P4-08): each section is edited as a draft kept across tabs, and saved or
// discarded together from the sticky bar.

type SiteFields = Required<Omit<SitePatch, never>>
export type RulesDraft = { approval: ApprovalConfig; rules: Record<string, { on: boolean; params: Record<string, number | boolean> }> }

export interface Drafts {
  site: SiteFields
  pvArrays: PvArraysInput
  battery: Required<BatteryPatch>
  tariff: TariffInput
  rules: RulesDraft
  calendar: CalendarInput
  model: SiteModelInput
  notifications: NotificationPrefs
}
export type Section = keyof Drafts

export const SECTION_TAB: Record<Section, string> = {
  site: "Site",
  pvArrays: "Site",
  battery: "Site",
  tariff: "Tariff",
  rules: "Rules",
  calendar: "Calendar",
  model: "Site model",
  notifications: "Notifications",
}

export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The keys of `draft` that differ from `saved`. */
export const changed = <T extends object>(draft: T, saved: T): Partial<T> =>
  Object.fromEntries(Object.entries(draft).filter(([k, v]) => !same(v, (saved as Record<string, unknown>)[k]))) as Partial<T>

export const TIME_ZONES = ["America/Toronto", "America/Vancouver", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Australia/Sydney"]
