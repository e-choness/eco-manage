// GET /api/forecast (P2-10): the latest PV and load forecasts for the next 48 h, merged per step.

export interface ForecastPoint {
  ts: string; // start of the 15-minute step, UTC
  pvKw: number | null;
  loadKw: number | null;
  netKw: number | null; // load − PV: what the grid and battery must cover (negative = surplus)
  tempC: number | null;
  cloud: number | null;
}

export interface ForecastAccuracy {
  mape: number; // %
  n: number;
  issuedAt: string;
}

export interface ForecastView {
  issuedAt: { pv: string | null; load: string | null };
  source: string | null;
  points: ForecastPoint[];
  profiles: { date: string; label: string; days: number }[];
  accuracy: { pv: ForecastAccuracy | null; load: ForecastAccuracy | null };
}
