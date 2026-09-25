// Expected solar output (P2-07). Until the PV forecast exists (P2-10), an inverter is compared with
// the site's other inverters: expected = its kWp × (their output ÷ their kWp) in the same 5-minute
// bucket. That catches one inverter falling behind (a fault, soiling, a tripped string) whatever
// the weather. With a single inverter nothing is expected, so nothing is flagged.

export const BUCKET_MS = 5 * 60_000;
/** Below 5% of rated output across the peers counts as night (or heavy overcast): not judged. */
export const DAYLIGHT_SHARE = 0.05;

export interface PvPoint {
  deviceId: string;
  ts: Date;
  kw: number;
}

/** Average output per device and 5-minute bucket: deviceId → bucket start (ms) → kW. */
export const bucketize = (points: PvPoint[]): Map<string, Map<number, number>> => {
  const sums = new Map<string, Map<number, { sum: number; n: number }>>();
  for (const p of points) {
    const bucket = Math.floor(p.ts.getTime() / BUCKET_MS) * BUCKET_MS;
    const byBucket = sums.get(p.deviceId) ?? new Map<number, { sum: number; n: number }>();
    const s = byBucket.get(bucket) ?? { sum: 0, n: 0 };
    s.sum += Math.max(0, p.kw); // PV produces into the switchboard (positive); ignore standby draw
    s.n++;
    byBucket.set(bucket, s);
    sums.set(p.deviceId, byBucket);
  }
  return new Map([...sums].map(([id, byBucket]) => [id, new Map([...byBucket].map(([b, s]) => [b, s.sum / s.n]))]));
};

/**
 * Output ÷ expected per inverter, one value per daylight bucket, oldest first. Buckets where the
 * inverter or all of its peers have no data are skipped.
 */
export const pvRatios = (buckets: Map<string, Map<number, number>>, kwp: Map<string, number>): Map<string, number[]> => {
  const out = new Map<string, number[]>();
  const ids = [...kwp.keys()].filter((id) => (kwp.get(id) ?? 0) > 0);
  if (ids.length < 2) return out;
  const times = [...new Set(ids.flatMap((id) => [...(buckets.get(id)?.keys() ?? [])]))].sort((a, b) => a - b);
  for (const id of ids) {
    const ratios: number[] = [];
    for (const t of times) {
      const own = buckets.get(id)?.get(t);
      if (own === undefined) continue;
      let peerKw = 0;
      let peerKwp = 0;
      for (const other of ids) {
        const kw = other === id ? undefined : buckets.get(other)?.get(t);
        if (kw === undefined) continue;
        peerKw += kw;
        peerKwp += kwp.get(other)!;
      }
      if (peerKwp === 0 || peerKw / peerKwp < DAYLIGHT_SHARE) continue;
      ratios.push(own / (kwp.get(id)! * (peerKw / peerKwp)));
    }
    out.set(id, ratios);
  }
  return out;
};
