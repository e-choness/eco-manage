// Clear-sky solar model: sun position from date, time and location (NOAA-style approximations),
// then the Haurwitz clear-sky irradiance model. Good to a few percent, which is plenty here.
// The simulator and the PV forecast (P2-10) share it.

const RAD = Math.PI / 180;

export interface SunPosition {
  elevationDeg: number;
  azimuthDeg: number; // clockwise from north: 90 east, 180 south
}

export const sunPosition = (at: Date, latDeg: number, lonDeg: number): SunPosition => {
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
  const sinEl = Math.max(-1, Math.min(1, Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)));
  const el = Math.asin(sinEl);
  // Azimuth from north; afternoon (hour angle > 0) is west of south.
  const cosAz = (Math.sin(decl) - sinEl * Math.sin(lat)) / Math.max(1e-9, Math.cos(el) * Math.cos(lat));
  const az = Math.acos(Math.max(-1, Math.min(1, cosAz))) / RAD;
  return { elevationDeg: el / RAD, azimuthDeg: hourAngle > 0 ? 360 - az : az };
};

export const sunElevationDeg = (at: Date, latDeg: number, lonDeg: number): number => sunPosition(at, latDeg, lonDeg).elevationDeg;

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

/** The geometry PV_SYSTEM_FACTOR is calibrated for (the demo site's roof arrays). */
export const REFERENCE_ARRAY = { tiltDeg: 10, azimuthDeg: 180 } as const;

const DIFFUSE_SHARE = 0.15; // of global irradiance on a clear day

/** Plane-of-array irradiance ÷ horizontal irradiance: beam by incidence angle, diffuse by sky view. */
const planeRatio = (sun: SunPosition, tiltDeg: number, azimuthDeg: number): number => {
  if (sun.elevationDeg <= 0) return 0;
  const el = sun.elevationDeg * RAD;
  const tilt = tiltDeg * RAD;
  const cosIncidence = Math.sin(el) * Math.cos(tilt) + Math.cos(el) * Math.sin(tilt) * Math.cos((sun.azimuthDeg - azimuthDeg) * RAD);
  const beam = (Math.max(0, cosIncidence) / Math.max(Math.sin(el), 0.05)) * (1 - DIFFUSE_SHARE);
  return beam + (DIFFUSE_SHARE * (1 + Math.cos(tilt))) / 2;
};

/**
 * How much more (or less) an array with this tilt and azimuth yields than the reference array at
 * this moment. 1 for the reference geometry, so the simulator's calibration holds.
 */
export const arrayFactor = (at: Date, latDeg: number, lonDeg: number, tiltDeg: number, azimuthDeg: number): number => {
  const sun = sunPosition(at, latDeg, lonDeg);
  const ref = planeRatio(sun, REFERENCE_ARRAY.tiltDeg, REFERENCE_ARRAY.azimuthDeg);
  return ref > 0 ? planeRatio(sun, tiltDeg, azimuthDeg) / ref : 0;
};
