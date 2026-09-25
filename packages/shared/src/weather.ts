import { siteDate, siteMinuteOfDay } from './time';
import { hashRandom } from './random';

// Seeded weather profile: one cloud factor and temperature offset per local day, with a diurnal
// temperature curve. The simulator and the forecast worker (P2-10, WEATHER_PROVIDER=simulated)
// both use it, so forecasts for the simulated site are made from the weather it will get.

export interface Weather {
  cloud: number; // share of clear-sky irradiance that reaches the panels, 0.15–1
  tempC: number;
}

// Monthly mean temperatures for Toronto (°C), January first.
const MONTHLY_MEAN_C = [-5.5, -4.5, 0, 7, 13.5, 19, 22, 21, 17, 10, 4, -2];

export const weatherAt = (at: Date, tz: string, seed: number): Weather => {
  const day = siteDate(at, tz);
  const month = Number(day.slice(5, 7)) - 1;
  // Clear, mixed and overcast days in roughly equal measure.
  const r = hashRandom(seed, `cloud:${day}`);
  const cloud = r < 0.35 ? 0.9 + 0.1 * hashRandom(seed, `cloudhi:${day}`) : r < 0.7 ? 0.5 + 0.3 * hashRandom(seed, `cloudmid:${day}`) : 0.15 + 0.3 * hashRandom(seed, `cloudlo:${day}`);
  const offset = (hashRandom(seed, `temp:${day}`) - 0.5) * 6;
  // Warmest at 15:00 local time, ±6 °C around the daily mean.
  const minute = siteMinuteOfDay(at, tz);
  const diurnal = 6 * Math.cos((2 * Math.PI * (minute - 15 * 60)) / 1440);
  return { cloud, tempC: MONTHLY_MEAN_C[month] + offset + diurnal };
};

/**
 * Share of clear-sky irradiance that gets through a given cloud cover (Kasten–Czeplak), so a
 * weather service's cloud cover feeds the same PV model as the simulated profile.
 */
export const cloudFromCover = (coverPct: number): number => {
  const c = Math.min(100, Math.max(0, coverPct)) / 100;
  return 1 - 0.75 * Math.pow(c, 3.4);
};
