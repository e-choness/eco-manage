// Formatting for Home, always in the site's time zone and currency.

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
