// Formatting for App v2 screens, in the site's time zone and currency.

export const clockAt = (at: string | number | Date, tz: string): string =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(at))

/** "Thu 24 Sep" (newer ICU writes "Sept"; App v2 uses three letters). */
export const dayLine = (at: Date, tz: string): string => {
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz }).formatToParts(at)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return `${part("weekday").slice(0, 3)} ${part("day")} ${part("month").slice(0, 3)}`
}

/** Whole units: "$3,418". */
export const money = (cents: number, currency: string): string =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(cents / 100)

/** A price per kWh: "$0.09". */
export const unitPrice = (cents: number, currency: string): string =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)

/** "4 h 50 min", "25 min" */
export const duration = (minutes: number): string => {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  return h ? `${h} h ${m % 60} min` : `${m} min`
}

/** "2 s ago", "4 min ago", then the local time, then the date: a device's last reading. */
export const ago = (at: string | null, now: number, tz: string): string => {
  if (!at) return "never"
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000))
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return clockAt(at, tz)
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: tz }).format(new Date(at))
}

/** "14 Mar 2024" */
export const longDay = (at: string, tz: string): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(new Date(at)).replace("Sept", "Sep")
