// Sign convention (plan §0.6): p_kw is positive when power flows INTO the site switchboard.
//   pv       positive (produces)
//   meter    positive when importing from the grid, negative when exporting
//   battery  positive when discharging, negative when charging
//   ev, heatpump, submeter   negative (loads)
// Stored values keep these signs; only the UI flips loads to positive.

export const DEVICE_TYPES = ['pv', 'battery', 'meter', 'submeter', 'ev', 'heatpump', 'gateway'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

const LOADS: ReadonlySet<DeviceType> = new Set(['ev', 'heatpump', 'submeter']);

export const isLoad = (type: DeviceType): boolean => LOADS.has(type);

/** Power as the UI shows it: loads become positive consumption, everything else keeps its sign. */
export const displayKw = (type: DeviceType, pKw: number): number => (isLoad(type) ? -pKw : pKw);

/** Normalises a reading that arrived as a positive load value into the site sign convention. */
export const toSiteSign = (type: DeviceType, magnitudeKw: number): number =>
  isLoad(type) ? -Math.abs(magnitudeKw) : magnitudeKw;

export type FlowDirection = 'in' | 'out' | 'idle';

/** Direction of flow relative to the site switchboard, with a small dead band. */
export const flowDirection = (pKw: number, deadBandKw = 0.05): FlowDirection =>
  pKw > deadBandKw ? 'in' : pKw < -deadBandKw ? 'out' : 'idle';

export interface SiteBalanceInput {
  pv: number; // + produced
  battery: number; // + discharge, - charge
  meter: number; // + import, - export
  ev: number; // site sign (<= 0)
  heatpump: number; // site sign (<= 0)
  submeters?: number; // site sign (<= 0)
}

/**
 * Building load that isn't metered separately, as a positive number:
 * everything flowing in (pv + battery + grid) minus the metered loads.
 */
export const buildingKw = ({ pv, battery, meter, ev, heatpump, submeters = 0 }: SiteBalanceInput): number =>
  pv + battery + meter + ev + heatpump + submeters;
