import { cloudFromCover, weatherAt } from '@ecomanage/shared';

// Weather for the forecasts (P2-10): the past (to learn how load follows temperature) and the next
// 48 h. `simulated` is the simulator's own seeded profile, so the simulated site is forecast from
// the weather it will actually get; `open-meteo` is a real service (no key needed).

export interface WeatherPoint {
  ts: Date;
  tempC: number;
  cloud: number; // share of clear-sky irradiance that gets through, 0–1
  storm: boolean; // a severe-weather (thunderstorm) warning
}

export interface WeatherSource {
  readonly name: string;
  /** Weather at each instant; instants may be in the past or up to 48 h ahead. */
  at(site: { lat: number; lon: number; tz: string }, instants: Date[]): Promise<WeatherPoint[]>;
}

export const simulatedWeather = (seed: number): WeatherSource => ({
  name: 'simulated',
  async at(site, instants) {
    return instants.map((ts) => ({ ts, ...weatherAt(ts, site.tz, seed) }));
  },
});

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface OpenMeteoHourly {
  hourly: { time: string[]; temperature_2m: number[]; cloud_cover: number[]; weather_code?: number[] };
}

/**
 * Open-Meteo hourly temperature and cloud cover, linearly interpolated to each instant. One
 * request covers the past days needed and two days ahead.
 */
export const openMeteoWeather = (fetchFn: Fetch = fetch as unknown as Fetch, baseUrl = 'https://api.open-meteo.com/v1/forecast'): WeatherSource => ({
  name: 'open-meteo',
  async at(site, instants) {
    if (!instants.length) return [];
    const first = Math.min(...instants.map((t) => t.getTime()));
    const pastDays = Math.min(92, Math.max(0, Math.ceil((Date.now() - first) / 86_400_000) + 1));
    const url = `${baseUrl}?latitude=${site.lat}&longitude=${site.lon}&hourly=temperature_2m,cloud_cover,weather_code&timezone=UTC&past_days=${pastDays}&forecast_days=3`;
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`open-meteo answered ${res.status}`);
    const { hourly } = (await res.json()) as OpenMeteoHourly;
    const times = hourly.time.map((t) => Date.parse(`${t}:00Z`));
    return instants.map((ts) => {
      const t = ts.getTime();
      let i = times.findIndex((x) => x > t);
      if (i <= 0) i = i === 0 ? 1 : times.length - 1; // clamp to the ends
      const [a, b] = [i - 1, i];
      const w = Math.min(1, Math.max(0, (t - times[a]) / (times[b] - times[a])));
      const lerp = (xs: number[]) => xs[a] + (xs[b] - xs[a]) * w;
      // WMO codes 95–99 are thunderstorms: the nearest hour decides.
      const code = hourly.weather_code?.[w < 0.5 ? a : b] ?? 0;
      return { ts, tempC: lerp(hourly.temperature_2m), cloud: cloudFromCover(lerp(hourly.cloud_cover)), storm: code >= 95 };
    });
  },
});
