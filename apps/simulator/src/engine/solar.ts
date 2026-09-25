// Clear-sky solar model: sun elevation from date, time and location (NOAA-style approximations),
// then the Haurwitz clear-sky irradiance model. Good to a few percent, which is plenty here.

const RAD = Math.PI / 180;

export const sunElevationDeg = (at: Date, latDeg: number, lonDeg: number): number => {
  const start = Date.UTC(at.getUTCFullYear(), 0, 1);
  const dayOfYear = (at.getTime() - start) / 86_400_000; // fractional
  const gamma = ((2 * Math.PI) / 365) * dayOfYear;
  const decl =
    0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const eqTimeMin =
    229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const utcMinutes = at.getUTCHours() * 60 + at.getUTCMinutes() + at.getUTCSeconds() / 60;
  const solarMinutes = utcMinutes + eqTimeMin + 4 * lonDeg;
  const hourAngle = (solarMinutes / 4 - 180) * RAD;
  const lat = latDeg * RAD;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD;
};

/** Global horizontal irradiance under a clear sky, W/m². */
export const clearSkyGhi = (elevationDeg: number): number => {
  if (elevationDeg <= 0) return 0;
  const s = Math.sin(elevationDeg * RAD);
  return 1098 * s * Math.exp(-0.057 / s);
};

// Low-tilt south-facing arrays gain a little over horizontal; combined with inverter and wiring
// losses the net factor is close to 0.95 of the horizontal STC rating.
export const PV_SYSTEM_FACTOR = 0.95;

/** AC output of an array before the inverter's own limit. */
export const pvKw = (kwp: number, ghi: number, cloud: number, factor = PV_SYSTEM_FACTOR): number =>
  (kwp * ghi * cloud * factor) / 1000;
