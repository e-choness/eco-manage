import type { SiteDoc } from '@ecomanage/db';
import { OSM_ATTRIBUTION, OSM_SEARCH_M, osmFootprint, type OsmFootprintView, type OsmWay } from '@ecomanage/shared';
import { z } from 'zod';
import { HttpError } from '../../lib/http';

// Settings → Site model → "Pull from OpenStreetMap" (P5-03): the outline of the building at the
// site's location, from the Overpass API. Only the point is sent; nothing about the site or user.

/** The `building` ways around a point. */
export type OsmLookup = (at: { lat: number; lon: number }) => Promise<OsmWay[]>;

type Fetch = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export const overpassLookup =
  (url: string, fetchFn: Fetch = fetch): OsmLookup =>
  async ({ lat, lon }) => {
    const data = `[out:json][timeout:10];way(around:${OSM_SEARCH_M},${lat},${lon})["building"];out tags geom;`;
    const res = await fetchFn(url, {
      method: 'POST',
      body: new URLSearchParams({ data }),
      headers: { 'User-Agent': 'EcoManage (site model outline lookup)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Overpass answered ${res.status}`);
    return ((await res.json()) as { elements?: OsmWay[] }).elements ?? [];
  };

const fail = (status: number, message: string) => new HttpError(status, { error: { code: status, message } });

export const osmQuery = z
  .object({ lat: z.coerce.number().min(-90).max(90).optional(), lon: z.coerce.number().min(-180).max(180).optional() })
  .refine((q) => (q.lat == null) === (q.lon == null), 'Give both `lat` and `lon`, or neither');

/** The building at the given point, or at the site's location. */
export const findOsmFootprint = async (lookup: OsmLookup | undefined, site: SiteDoc, q: z.infer<typeof osmQuery>): Promise<OsmFootprintView> => {
  if (!lookup) throw fail(503, 'Looking up OpenStreetMap is turned off on this server. Enter the width and depth instead.');
  const at = q.lat != null && q.lon != null ? { lat: q.lat, lon: q.lon } : site.lat != null && site.lon != null ? { lat: site.lat, lon: site.lon } : null;
  if (!at) throw fail(422, 'The site has no location yet. Set it in Settings → Site, or enter a latitude and longitude.');
  let ways: OsmWay[];
  try {
    ways = await lookup(at);
  } catch {
    throw fail(502, 'OpenStreetMap didn’t answer. Try again in a minute, or enter the width and depth.');
  }
  const found = osmFootprint(ways, at);
  if (!found) throw fail(404, `OpenStreetMap has no building outline within ${OSM_SEARCH_M} m of this point.`);
  return { ...found, at, attribution: OSM_ATTRIBUTION };
};
