/**
 * Corridor geometry + route post-processing — TS ports of the app-side
 * functions in eikon_demo_app_beta.py. Logic is preserved; only the language
 * and libraries change (proj4 for EPSG:27700, h3-js for polyfill, a WKT parser
 * for the pathfinder response).
 */
import { polygonToCells, latLngToCell } from "h3-js";
import wellknown from "wellknown";
import {
  crsNearest,
  fromCrs,
  metricCrs,
  metricCrsForPoint,
  solveProjection,
  toCrs,
  utmCrsFor,
  type Anchor,
  type CountryCode,
} from "./projection";
import type { AssessmentCell, CorridorSummary, DroneRoute } from "./types";

// geopandas GeoSeries.buffer default is resolution=16 (16 segments per 90°
// quadrant), so each 180° semicircular cap = 32 segments. Matching this makes
// the corridor polygon (and thus the H3 polyfill) match the Streamlit app.
const CAP_SEGMENTS = 32;

/**
 * Buffered corridor polygon between origin and destination, as a WGS84 ring of
 * [lon, lat] points. Ports generate_corridor_polygon: the buffer is computed in
 * planar metres in the country's grid (a "stadium" around the line) then
 * reprojected back to WGS84.
 */
export function corridorPolygon(
  origin: [number, number], // [lat, lon]
  dest: [number, number],
  bufferMetres: number,
  country: CountryCode = "uk",
): [number, number][] {
  // One CRS for the whole stadium, chosen from where the corridor actually
  // is rather than from the country selector: origin and destination can sit
  // in different UTM zones, and mixing them would tear the ring apart.
  const anchor: Anchor = [origin[1], origin[0]];
  const crs = metricCrsForPoint(country, anchor);
  const [oE, oN] = toCrs(crs, [origin[1], origin[0]]);
  const [dE, dN] = toCrs(crs, [dest[1], dest[0]]);

  const dx = dE - oE;
  const dy = dN - oN;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy; // unit normal
  const ny = ux;
  const r = bufferMetres;
  const baseAngle = Math.atan2(uy, ux);

  const ring: [number, number][] = [];
  const push = (e: number, n: number) => ring.push(fromCrs(crs, [e, n]));

  // Left edge: origin -> dest, offset by +r·n
  push(oE + r * nx, oN + r * ny);
  push(dE + r * nx, dN + r * ny);
  // Cap around destination: sweep 180° clockwise through the forward direction
  for (let i = 1; i < CAP_SEGMENTS; i++) {
    const a = baseAngle + Math.PI / 2 - (Math.PI * i) / CAP_SEGMENTS;
    push(dE + r * Math.cos(a), dN + r * Math.sin(a));
  }
  // Right edge: dest -> origin, offset by -r·n
  push(dE - r * nx, dN - r * ny);
  push(oE - r * nx, oN - r * ny);
  // Cap around origin: sweep 180° clockwise through the backward direction
  for (let i = 1; i < CAP_SEGMENTS; i++) {
    const a = baseAngle - Math.PI / 2 - (Math.PI * i) / CAP_SEGMENTS;
    push(oE + r * Math.cos(a), oN + r * Math.sin(a));
  }
  ring.push(ring[0]); // close
  return ring;
}

/**
 * All H3 res-9 cells within the corridor polygon. Ports get_corridor_h3_cells
 * (resolution is fixed at 9, matching the live call). `ring` is [lon, lat].
 */
export function corridorH3Cells(ring: [number, number][], resolution = 9): string[] {
  // h3-js polygonToCells with isGeoJson=true expects [lng, lat] rings.
  return polygonToCells([ring], resolution, true);
}

/** geo_to_h3(lat, lon, res) — origin/dest parent hex (res 7 in live mode). */
export function geoToH3(lat: number, lon: number, res = 7): string {
  return latLngToCell(lat, lon, res);
}

/** Coerce a pandas read_json payload (column- or record-oriented) to rows. */
function toRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const cols = payload as Record<string, Record<string, unknown>>;
    const keys = Object.keys(cols);
    if (keys.length === 0) return [];
    const indices = Object.keys(cols[keys[0]] ?? {});
    return indices.map((idx) => {
      const row: Record<string, unknown> = {};
      for (const k of keys) row[k] = cols[k]?.[idx];
      return row;
    });
  }
  return [];
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Adapt the /eikon_safest_route_pathfinder response (WKT geometry in the
 * country's metric CRS)
 * to the routes list. Ports _parse_pathfinder_response: parse WKT, reproject to
 * WGS84, pick one recommended route by (combined_total_rank, risk_threshold).
 */
/** Where the route is known to begin and end: the two cell centres sent. */
export interface CorridorEndpoints {
  /** [lon, lat] centre of the origin H3 cell. */
  origin: Anchor;
  /** [lon, lat] centre of the destination H3 cell. */
  dest: Anchor;
}

/**
 * How to turn the pathfinder's projected coordinates back into lon/lat.
 *
 * It is sent no country and picks a CRS from the cells it was given, so the
 * client cannot derive it. Assuming the selected country's is what put the
 * route and its two markers off the map whenever the coordinates were for
 * somewhere else: the geometry decoded into the wrong hemisphere while the
 * hexes, which carry their own position, stayed put.
 *
 * Two steps, in order of exactness:
 *
 *  1. Try the CRSs it plausibly used and keep whichever decodes the first
 *     vertex nearest the origin cell. A named CRS is exact, and the right one
 *     lands on the cell while every wrong one is thousands of kilometres away,
 *     so there is no ambiguity. The selected country's is tried first and
 *     still wins wherever it is right, leaving the UK and Hong Kong unchanged.
 *
 *  2. Failing that, solve for the mapping from the two endpoints. Listing
 *     candidates is a treadmill — a corridor crossing a border can come back
 *     in the far country's zone, in a Europe-wide grid, in a national grid for
 *     a country the list has never heard of — and the list is wrong again each
 *     time. The endpoints are known whatever the backend chose.
 */
function routeDecoder(
  rows: Record<string, unknown>[],
  country: CountryCode,
  endpoints?: CorridorEndpoints,
): (point: [number, number]) => [number, number] {
  const fallbackCrs = endpoints
    ? metricCrsForPoint(country, endpoints.origin)
    : metricCrs(country);
  const asFallback = (point: [number, number]) => fromCrs(fallbackCrs, point);
  if (!endpoints) return asFallback;

  const { origin, dest } = endpoints;
  const line = firstLine(rows);
  if (!line || line.length === 0) return asFallback;

  // Both endpoints' zones, and the dropdown's, since a cross-border corridor
  // may come back in either end's. ETRS89 UTM needs no entry of its own: it
  // agrees with the WGS84 zone to about a metre, far inside the tolerance.
  const candidates = [
    metricCrs(country, origin),
    utmCrsFor(origin),
    utmCrsFor(dest),
    "EPSG:27700",
    "EPSG:2326",
    // Some responses may already be in degrees; decoding those as metres is
    // what sends a route to the Gulf of Guinea.
    "EPSG:4326",
  ].filter((crs, i, all) => all.indexOf(crs) === i);

  const matched = crsNearest(line[0], origin, candidates);
  if (matched) return (point) => fromCrs(matched, point);

  const solved =
    line.length > 1 ? solveProjection([line[0], line[line.length - 1]], [origin, dest]) : null;
  if (solved) {
    console.warn(
      "[corridor] pathfinder geometry is in an unrecognised CRS; placing it " +
        "from the origin and destination cells instead.",
    );
    return solved;
  }

  console.warn(
    "[corridor] could not place the pathfinder geometry near the corridor " +
      `in any known CRS; drawing it as ${fallbackCrs}.`,
  );
  return asFallback;
}

/** Vertices of the first route that parses, for identifying the CRS. */
function firstLine(rows: Record<string, unknown>[]): [number, number][] | null {
  for (const row of rows) {
    const geom = wellknown.parse(String(row.geometry));
    if (geom?.type === "LineString") {
      const line = geom.coordinates as [number, number][];
      if (line.length) return line;
    } else if (geom?.type === "MultiLineString") {
      const line = (geom.coordinates as [number, number][][]).flat();
      if (line.length) return line;
    }
  }
  return null;
}

export function parsePathfinderResponse(
  routesGdfJson: string,
  country: CountryCode = "uk",
  /** The cell centres the route runs between; lets the CRS be identified. */
  endpoints?: CorridorEndpoints,
): DroneRoute[] {
  const rows = toRows(JSON.parse(routesGdfJson));
  if (rows.length === 0) return [];

  const decode = routeDecoder(rows, country, endpoints);

  // Recommended index: lowest combined_total_rank, tie-break lowest risk_threshold.
  const order = rows
    .map((row, idx) => ({ idx, row }))
    .sort(
      (a, b) =>
        num(a.row.combined_total_rank) - num(b.row.combined_total_rank) ||
        num(a.row.risk_threshold) - num(b.row.risk_threshold),
    );
  const recommendedIdx = order.length ? order[0].idx : -1;

  const routes: DroneRoute[] = rows.map((row, idx) => {
    const geom = wellknown.parse(String(row.geometry));
    let coords: [number, number][] = [];
    if (geom && geom.type === "LineString") {
      coords = (geom.coordinates as [number, number][]).map(([x, y]) => decode([x, y]));
    } else if (geom && geom.type === "MultiLineString") {
      // A path split into segments still draws as one line; concatenating is
      // what the pydeck PathLayer showed. Without this the route parses to an
      // empty path and silently disappears from the map while still appearing
      // in the routes table, which reads its length from route_length.
      coords = (geom.coordinates as [number, number][][])
        .flat()
        .map(([x, y]) => decode([x, y]));
    } else if (geom) {
      console.warn(
        `[corridor] route ${idx} has unsupported geometry type "${geom.type}"; it will not be drawn.`,
      );
    } else {
      console.warn(`[corridor] route ${idx} has unparseable geometry; it will not be drawn.`);
    }
    return {
      percentile: Math.trunc(num(row.risk_threshold)),
      thresholdValue: num(row.cut_off_threshold),
      cells: [],
      coords,
      routeLengthKm: Math.round((num(row.route_length) / 1000) * 100) / 100,
      riskThresholdRank: Math.trunc(num(row.risk_threshold_rank)),
      routeLengthRank: Math.trunc(num(row.route_length_rank)),
      combinedRank: Math.trunc(num(row.combined_total_rank)),
      recommended: idx === recommendedIdx,
    };
  });

  return routes.sort((a, b) => a.combinedRank - b.combinedRank);
}

/** Summary statistics for the corridor. Ports compute_corridor_summary. */
export function corridorSummary(
  assessment: AssessmentCell[],
  routes: DroneRoute[],
): CorridorSummary {
  const scores = assessment.map((c) => num(c.cum_score));
  const areaKm2 = Math.round(assessment.length * 0.1053 * 100) / 100;
  const recommended = routes.find((r) => r.recommended) ?? null;
  return {
    totalCells: assessment.length,
    areaKm2,
    meanScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    maxScore: scores.length ? Math.max(...scores) : 0,
    minScore: scores.length ? Math.min(...scores) : 0,
    routesFound: routes.length,
    recommendedLengthKm: recommended?.routeLengthKm ?? null,
    recommendedThreshold: recommended?.thresholdValue ?? null,
    recommendedPercentile: recommended?.percentile ?? null,
  };
}

/**
 * Re-rank routes by a safety↔efficiency weighting. Ports rerank_routes:
 * combined = safety·risk_threshold_rank + efficiency·route_length_rank, then
 * dense-rank and flag the single best as recommended. Returns a new array.
 */
export function rerankRoutes(routes: DroneRoute[], safetyWeight = 0.5): DroneRoute[] {
  if (routes.length === 0) return routes;
  const efficiencyWeight = 1.0 - safetyWeight;

  const scored = routes.map((r) => ({
    ...r,
    combinedRank:
      Math.round(
        (safetyWeight * r.riskThresholdRank + efficiencyWeight * r.routeLengthRank) * 1000,
      ) / 1000,
    recommended: false,
  }));

  const sortedScores = Array.from(new Set(scored.map((r) => r.combinedRank))).sort(
    (a, b) => a - b,
  );
  const rankMap = new Map<number, number>();
  sortedScores.forEach((v, i) => rankMap.set(v, i + 1));

  const ranked = scored.map((r) => ({ ...r, combinedRank: rankMap.get(r.combinedRank)! }));
  const best = Math.min(...ranked.map((r) => r.combinedRank));
  let flagged = false;
  for (const r of ranked) {
    if (!flagged && r.combinedRank === best) {
      r.recommended = true;
      flagged = true;
    }
  }
  return ranked;
}

/**
 * Route geometry as WKT in the metric CRS the route sits in (for CSV export).
 * Input coords are [lon, lat]. Use `wktCrs(coords, country)` to label the column.
 */
/** The CRS routeToWkt writes, so the CSV header can name it correctly. */
export function wktCrs(coords: [number, number][], country: CountryCode = "uk"): string {
  return coords.length ? metricCrsForPoint(country, coords[0]) : metricCrs(country);
}

export function routeToWkt(
  coords: [number, number][],
  country: CountryCode = "uk",
): string {
  // The whole line shares the first vertex's CRS, so a long route cannot come
  // out split across two zones.
  const crs = wktCrs(coords, country);
  const pts = coords.map(([lon, lat]) => {
    const [e, n] = toCrs(crs, [lon, lat]);
    return `${e} ${n}`;
  });
  return `LINESTRING (${pts.join(", ")})`;
}
