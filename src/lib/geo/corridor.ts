/**
 * Corridor geometry + route post-processing — TS ports of the app-side
 * functions in eikon_demo_app_beta.py. Logic is preserved; only the language
 * and libraries change (proj4 for EPSG:27700, h3-js for polyfill, a WKT parser
 * for the pathfinder response).
 */
import { polygonToCells, latLngToCell } from "h3-js";
import wellknown from "wellknown";
import { toBNG, toWGS84 } from "./projection";
import type { AssessmentCell, CorridorSummary, DroneRoute } from "./types";

// geopandas GeoSeries.buffer default is resolution=16 (16 segments per 90°
// quadrant), so each 180° semicircular cap = 32 segments. Matching this makes
// the corridor polygon (and thus the H3 polyfill) match the Streamlit app.
const CAP_SEGMENTS = 32;

/**
 * Buffered corridor polygon between origin and destination, as a WGS84 ring of
 * [lon, lat] points. Ports generate_corridor_polygon: the buffer is computed in
 * planar EPSG:27700 metres (a "stadium" around the straight line) then
 * reprojected back to WGS84.
 */
export function corridorPolygon(
  origin: [number, number], // [lat, lon]
  dest: [number, number],
  bufferMetres: number,
): [number, number][] {
  const [oE, oN] = toBNG([origin[1], origin[0]]);
  const [dE, dN] = toBNG([dest[1], dest[0]]);

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
  const pushBNG = (e: number, n: number) => ring.push(toWGS84([e, n]));

  // Left edge: origin -> dest, offset by +r·n
  pushBNG(oE + r * nx, oN + r * ny);
  pushBNG(dE + r * nx, dN + r * ny);
  // Cap around destination: sweep 180° clockwise through the forward direction
  for (let i = 1; i < CAP_SEGMENTS; i++) {
    const a = baseAngle + Math.PI / 2 - (Math.PI * i) / CAP_SEGMENTS;
    pushBNG(dE + r * Math.cos(a), dN + r * Math.sin(a));
  }
  // Right edge: dest -> origin, offset by -r·n
  pushBNG(dE - r * nx, dN - r * ny);
  pushBNG(oE - r * nx, oN - r * ny);
  // Cap around origin: sweep 180° clockwise through the backward direction
  for (let i = 1; i < CAP_SEGMENTS; i++) {
    const a = baseAngle - Math.PI / 2 - (Math.PI * i) / CAP_SEGMENTS;
    pushBNG(oE + r * Math.cos(a), oN + r * Math.sin(a));
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
 * Adapt the /eikon_safest_route_pathfinder response (WKT geometry in EPSG:27700)
 * to the routes list. Ports _parse_pathfinder_response: parse WKT, reproject to
 * WGS84, pick one recommended route by (combined_total_rank, risk_threshold).
 */
export function parsePathfinderResponse(routesGdfJson: string): DroneRoute[] {
  const rows = toRows(JSON.parse(routesGdfJson));
  if (rows.length === 0) return [];

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
      coords = (geom.coordinates as [number, number][]).map(
        ([x, y]) => toWGS84([x, y]),
      );
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

/** Route geometry as EPSG:27700 WKT (for CSV export). Coords are [lon, lat]. */
export function routeToWktBNG(coords: [number, number][]): string {
  const pts = coords.map(([lon, lat]) => {
    const [e, n] = toBNG([lon, lat]);
    return `${e} ${n}`;
  });
  return `LINESTRING (${pts.join(", ")})`;
}
