// Units used everywhere: power in kW, energy in kWh (plain numbers), money in integer cents.

/** Energy delivered by an average power over a number of minutes. */
export const kwhFromKw = (kw: number, minutes: number): number => (kw * minutes) / 60;

/** Average power that delivers an amount of energy over a number of minutes. */
export const kwFromKwh = (kwh: number, minutes: number): number => {
  if (minutes <= 0) throw new RangeError('minutes must be positive');
  return (kwh * 60) / minutes;
};

/** Rounds to a number of decimals without floating-point surprises such as 1.005 -> 1. */
export const round = (value: number, decimals = 2): number => {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
};

/** Converts a currency amount (e.g. dollars) to integer cents. */
export const toCents = (amount: number): number => Math.round(amount * 100);

/** Converts integer cents back to a currency amount. */
export const fromCents = (cents: number): number => cents / 100;

/** Price in cents per kWh times energy in kWh, rounded to whole cents. */
export const costCents = (kwh: number, rateCents: number): number => Math.round(kwh * rateCents);

/** Formats cents for display, e.g. 341800 -> "$3,418.00". */
export const formatMoney = (cents: number, currency = 'CAD', locale = 'en-CA'): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(cents / 100);
