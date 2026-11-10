/**
 * SERVER-ONLY: resolve which country an area of interest sits in.
 *
 * A drawn or uploaded AOI can sit anywhere, and the country-aware backend
 * routes need to be told which country's reference data to assess it against.
 * /get_location_country answers that for a single point, so the AOI is probed
 * point by point until one resolves.
 */
import { callBackend } from "@/lib/server/backend";

/** Cap on country lookups per AOI, so an intricate geometry cannot fan out. */
export const MAX_COUNTRY_LOOKUPS = 8;

/**
 * Points to try the country lookup against, best first: the centre of the
 * AOI's bounding box, then its corners, then the geometry's own vertices. The
 * centre alone is not enough — the middle of a box drawn over Hong Kong lands
 * in Victoria Harbour, where the lookup answers null and the AOI would be
 * taken for a country it is nowhere near. A vertex on land settles it.
 */
export function candidatePoints(geojson: unknown): [number, number][] {
  const box = boundingBox(geojson);
  if (!box) return [];
  const { minLon, minLat, maxLon, maxLat } = box;

  const points: [number, number][] = [
    [(minLat + maxLat) / 2, (minLon + maxLon) / 2],
    [minLat, minLon],
    [maxLat, maxLon],
    [minLat, maxLon],
    [maxLat, minLon],
  ];

  for (const v of vertices(geojson)) {
    if (points.length >= MAX_COUNTRY_LOOKUPS) break;
    points.push(v);
  }
  return points.slice(0, MAX_COUNTRY_LOOKUPS);
}

/** Every [lon, lat] pair in the collection, as [lat, lon]. */
function vertices(geojson: unknown): [number, number][] {
  const out: [number, number][] = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node) || out.length >= MAX_COUNTRY_LOOKUPS) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      const [lon, lat] = node as [number, number];
      if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lat, lon]);
      return;
    }
    for (const child of node) walk(child);
  };
  for (const f of features(geojson)) {
    walk((f as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates);
  }
  return out;
}

export function boundingBox(geojson: unknown): {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
} | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      const [lon, lat] = node as [number, number];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const child of node) walk(child);
  };

  const fs = features(geojson);
  if (fs.length === 0) return null;
  for (const f of fs) {
    walk((f as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates);
  }

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

function features(geojson: unknown): unknown[] {
  const fs = (geojson as { features?: unknown })?.features;
  return Array.isArray(fs) ? fs : [];
}

/**
 * Resolve the country serving a point. The endpoint answers 200 with
 * { country: null } for a point it does not cover — open water, or anywhere
 * outside the served countries — so a null is an answer, not a failure, and
 * the caller moves on to the next candidate point.
 */
export async function countryFor(
  location: [number, number],
  apiKey: string,
): Promise<string | null> {
  try {
    const res = await callBackend<{ country?: string | null }>("locationCountry", {
      json: { location, api_key: apiKey },
      timeoutMs: 20_000,
    });
    return res?.country ?? null;
  } catch {
    return null;
  }
}

/** First candidate point that resolves to a country, or null if none do. */
export async function countryForAoi(
  geojson: unknown,
  apiKey: string,
): Promise<string | null> {
  for (const point of candidatePoints(geojson)) {
    const country = await countryFor(point, apiKey);
    if (country) return country;
  }
  return null;
}
