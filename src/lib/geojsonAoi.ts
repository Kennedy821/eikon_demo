/**
 * Parsing for user-uploaded GeoJSON areas of interest.
 *
 * Mirrors the notebook flow
 *   gp.read_file(...).rename(columns={"id": "unique_id"})
 *   → pd.concat([...])
 *   → get_location_verification(aoi_type="custom", gdf=..., unique_id_column="id")
 *
 * where the SDK sends `gdf[["unique_id","geometry"]].to_json()` — a GeoJSON
 * FeatureCollection whose features carry a single `unique_id` property. Each
 * uploaded polygon becomes one assessed location, and the backend returns its
 * `unique_id` on every result row so cells can be grouped per location.
 */

import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  MultiLineString,
  MultiPoint,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from "geojson";
import {
  cellToLatLng,
  cellsToMultiPolygon,
  gridDisk,
  gridPathCells,
  latLngToCell,
  polygonToCells,
} from "h3-js";
import { circle as turfCircle } from "@turf/turf";

/**
 * Points and lines are geocoded to H3 cells and assessed as those cells'
 * polygons. Resolution 9 matches the grid the backend assesses on, so an
 * uploaded point maps to exactly the cell that comes back in the results.
 * (h3-js v4 renamed the v3.7.7 calls: latLngToCell === geoToH3,
 * cellToBoundary === h3ToGeoBoundary — the cell indexes are identical.)
 */
export const AOI_H3_RESOLUTION = 9;

/**
 * Approximate across-the-flats size of a resolution-9 cell: twice the average
 * edge length (174.4 m), the same figure the drone corridor tab uses. A buffer
 * grows the AOI one ring of cells at a time, so buffer distances are offered in
 * multiples of this — expressed in metres rather than ring counts.
 */
export const HEX_DIAMETER_M = 348;

/** Buffer radii offered in the UI, in metres. */
export const BUFFER_OPTIONS_M = [0, 100, 500, 1000];

/** Label for a buffer option. */
export function bufferLabel(metres: number): string {
  if (metres === 0) return "None";
  return metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
}

/**
 * Points are drawn as circles rather than hexagons so they still read as
 * points on the map. An unbuffered point becomes a circle centred on its H3
 * cell's centre with a radius of half a cell diameter; a buffered one becomes a
 * plain circle of the buffer radius. Either way the enclosed cell centres —
 * and so the assessed cells — match the equivalent ring expansion.
 */
export const POINT_RADIUS_M = HEX_DIAMETER_M / 2;
const CIRCLE_STEPS = 64;

export type AoiGeometry = Polygon | MultiPolygon;
export interface AoiProperties {
  unique_id: string;
  /** H3 cell centres for point-sourced features — these render as circles. */
  point_centres?: Position[];
}
export type AoiFeature = Feature<AoiGeometry, AoiProperties>;

export interface ParsedAoi {
  features: AoiFeature[];
  /** Per-file notes worth surfacing (skipped non-polygon features, renamed duplicate ids). */
  warnings: string[];
}

export class GeoJsonAoiError extends Error {}

/** Property names checked, in order, for a feature's location id. */
const ID_KEYS = ["unique_id", "id", "name", "Name", "NAME"];

function isAoiGeometry(g: Geometry | null | undefined): g is AoiGeometry {
  return !!g && (g.type === "Polygon" || g.type === "MultiPolygon");
}

/** Metres between two lon/lat positions (haversine). */
function metresBetween(a: Position, b: Position): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(a[0] - b[0]) * -1;
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cells covered by one line segment: the H3 grid path, or dense sampling. */
function segmentCells(a: Position, b: Position): string[] {
  const from = latLngToCell(a[1], a[0], AOI_H3_RESOLUTION);
  const to = latLngToCell(b[1], b[0], AOI_H3_RESOLUTION);
  try {
    // gridPathCells (v3: h3Line) walks the grid between the two cells.
    return gridPathCells(from, to);
  } catch {
    // Too far apart for a grid path — sample the segment instead, stepping
    // well inside one cell width so no cell along the way is missed.
    const stepM = 80;
    const steps = Math.max(1, Math.ceil(metresBetween(a, b) / stepM));
    const cells: string[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const lon = a[0] + (b[0] - a[0]) * t;
      const lat = a[1] + (b[1] - a[1]) * t;
      cells.push(latLngToCell(lat, lon, AOI_H3_RESOLUTION));
    }
    return cells;
  }
}

/** Every cell a line (or multi-line) passes through. */
function lineCells(coords: Position[][]): string[] {
  const cells = new Set<string>();
  for (const line of coords) {
    if (line.length === 1) {
      cells.add(latLngToCell(line[0][1], line[0][0], AOI_H3_RESOLUTION));
      continue;
    }
    for (let i = 0; i < line.length - 1; i += 1) {
      segmentCells(line[i], line[i + 1]).forEach((c) => cells.add(c));
    }
  }
  return Array.from(cells);
}

/** The merged outline of a set of cells, as a GeoJSON MultiPolygon. */
function cellsToGeometry(cells: string[]): MultiPolygon {
  return { type: "MultiPolygon", coordinates: cellsToMultiPolygon(cells, true) as Position[][][] };
}

/**
 * Convert a point or line geometry to the H3 cell polygons covering it.
 * Polygons pass through untouched. Returns null for anything unusable.
 */
/** H3 cell centres for a point geometry, or null for anything else. */
export function pointCentres(g: Geometry | null | undefined): Position[] | null {
  if (!g) return null;
  if (g.type === "Point") {
    const [lon, lat] = (g as Point).coordinates;
    return [cellCentre(lon, lat)];
  }
  if (g.type === "MultiPoint") {
    const cs = (g as MultiPoint).coordinates.map(([lon, lat]) => cellCentre(lon, lat));
    return cs.length ? cs : null;
  }
  return null;
}

export function toAoiGeometry(g: Geometry | null | undefined): AoiGeometry | null {
  if (!g) return null;
  switch (g.type) {
    case "Polygon":
    case "MultiPolygon":
      return g;
    case "Point": {
      const [lon, lat] = (g as Point).coordinates;
      return circleGeometry(cellCentre(lon, lat), POINT_RADIUS_M);
    }
    case "MultiPoint": {
      const centres = (g as MultiPoint).coordinates.map(([lon, lat]) => cellCentre(lon, lat));
      return centres.length ? circlesGeometry(centres, POINT_RADIUS_M) : null;
    }
    case "LineString": {
      const cells = lineCells([(g as LineString).coordinates]);
      return cells.length ? cellsToGeometry(cells) : null;
    }
    case "MultiLineString": {
      const cells = lineCells((g as MultiLineString).coordinates);
      return cells.length ? cellsToGeometry(cells) : null;
    }
    default:
      return null;
  }
}

/** A circle of `radiusM` around a lon/lat position. */
function circleGeometry(centre: Position, radiusM: number): Polygon {
  return turfCircle(centre as [number, number], radiusM, {
    units: "meters",
    steps: CIRCLE_STEPS,
  }).geometry as Polygon;
}

/** The H3 cell centre a raw coordinate falls in. */
function cellCentre(lon: number, lat: number): Position {
  const [clat, clon] = cellToLatLng(latLngToCell(lat, lon, AOI_H3_RESOLUTION));
  return [clon, clat];
}

/** One circle per centre, merged into a single geometry. */
function circlesGeometry(centres: Position[], radiusM: number): AoiGeometry {
  if (centres.length === 1) return circleGeometry(centres[0], radiusM);
  return {
    type: "MultiPolygon",
    coordinates: centres.map((c) => circleGeometry(c, radiusM).coordinates),
  };
}

/** Cells covering a polygon or multipolygon. */
function geometryCells(g: AoiGeometry): string[] {
  const polys: Position[][][] =
    g.type === "Polygon" ? [g.coordinates as Position[][]] : (g.coordinates as Position[][][]);
  const cells = new Set<string>();
  for (const rings of polys) {
    polygonToCells(rings as number[][][], AOI_H3_RESOLUTION, true).forEach((c) => cells.add(c));
    if (cells.size === 0) {
      // Polygon too small to contain a cell centre — fall back to the cell its
      // first vertex sits in so the shape is still assessable.
      const first = rings[0]?.[0];
      if (first) cells.add(latLngToCell(first[1], first[0], AOI_H3_RESOLUTION));
    }
  }
  return Array.from(cells);
}

/**
 * Grow a geometry by whole rings of H3 cells — one ring per HEX_DIAMETER_M of
 * buffer, minimum one. 0 leaves the geometry untouched. Used for lines and
 * polygons; points get a true circular buffer instead.
 */
export function bufferAoiGeometry(g: AoiGeometry, metres: number): AoiGeometry {
  if (!Number.isFinite(metres) || metres <= 0) return g;
  // Rings are the finest step available, so a buffer smaller than one cell
  // still grows the shape by a single ring.
  const k = Math.max(1, Math.round(metres / HEX_DIAMETER_M));
  const cells = geometryCells(g);
  if (cells.length === 0) return g;
  const expanded = new Set<string>();
  for (const c of cells) gridDisk(c, k).forEach((x) => expanded.add(x));
  return cellsToGeometry(Array.from(expanded));
}

/**
 * Apply a buffer to every feature, keeping ids intact.
 * Point-sourced features stay circular — the buffer becomes the circle radius —
 * while lines and polygons grow by whole rings of H3 cells.
 */
export function bufferAoiFeatures(features: AoiFeature[], metres: number): AoiFeature[] {
  if (!metres) return features;
  return features.map((f) => {
    const centres = f.properties.point_centres;
    if (centres?.length) {
      return { ...f, geometry: circlesGeometry(centres, metres) };
    }
    return { ...f, geometry: bufferAoiGeometry(f.geometry, metres) };
  });
}

/** Human-readable label for the conversion note. */
const CONVERTED_LABEL: Record<string, string> = {
  Point: "point",
  MultiPoint: "multi-point",
  LineString: "line",
  MultiLineString: "multi-line",
};

/**
 * The RFC 7946 default is WGS84 lon/lat. Older files may carry a `crs` member;
 * anything that is not WGS84 would be silently mis-placed, so reject it rather
 * than send wrong coordinates.
 */
function assertWgs84(doc: Record<string, unknown>, filename: string) {
  const crs = doc.crs as { properties?: { name?: string } } | undefined;
  const name = crs?.properties?.name;
  if (!name) return;
  const ok = /(CRS84|4326)/i.test(name);
  if (!ok) {
    throw new GeoJsonAoiError(
      `${filename} declares ${name}. Re-project it to EPSG:4326 (WGS84) before uploading.`,
    );
  }
}

/** Pull the id for one feature, falling back to the filename and position. */
function featureId(
  feature: Feature,
  index: number,
  filename: string,
  idKey: string | null,
): string {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const keys = idKey ? [idKey] : ID_KEYS;
  for (const k of keys) {
    const v = props[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  if (feature.id !== undefined && feature.id !== null) return String(feature.id);
  const stem = filename.replace(/\.(geo)?json$/i, "");
  return index === 0 ? stem : `${stem}_${index + 1}`;
}

/** Parse one uploaded file into AOI features. Throws on unusable input. */
export function parseGeoJsonFile(
  text: string,
  filename: string,
  idKey: string | null = null,
): ParsedAoi {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new GeoJsonAoiError(`${filename} is not valid JSON.`);
  }
  if (typeof doc !== "object" || doc === null) {
    throw new GeoJsonAoiError(`${filename} is not valid GeoJSON.`);
  }
  assertWgs84(doc as Record<string, unknown>, filename);

  // Accept a FeatureCollection, a bare Feature, or a bare geometry.
  const typed = doc as { type?: string };
  let rawFeatures: Feature[];
  if (typed.type === "FeatureCollection") {
    rawFeatures = ((doc as FeatureCollection).features ?? []).filter(Boolean);
  } else if (typed.type === "Feature") {
    rawFeatures = [doc as Feature];
  } else if (typed.type === "Polygon" || typed.type === "MultiPolygon") {
    rawFeatures = [{ type: "Feature", properties: {}, geometry: doc as AoiGeometry }];
  } else {
    throw new GeoJsonAoiError(`${filename} contains no features.`);
  }

  if (rawFeatures.length === 0) throw new GeoJsonAoiError(`${filename} contains no features.`);

  const warnings: string[] = [];
  const features: AoiFeature[] = [];
  const converted = new Map<string, number>();
  let skipped = 0;

  rawFeatures.forEach((f, i) => {
    const source = f?.geometry?.type;
    const geometry = toAoiGeometry(f?.geometry);
    if (!geometry) {
      skipped += 1;
      return;
    }
    if (source && !isAoiGeometry(f.geometry)) {
      converted.set(source, (converted.get(source) ?? 0) + 1);
    }
    const centres = pointCentres(f?.geometry);
    features.push({
      type: "Feature",
      properties: {
        unique_id: featureId(f, i, filename, idKey),
        ...(centres ? { point_centres: centres } : {}),
      },
      geometry,
    });
  });

  converted.forEach((count, type) => {
    const label = CONVERTED_LABEL[type] ?? type;
    const plural = count === 1 ? "" : "s";
    const how =
      type === "Point" || type === "MultiPoint"
        ? `assessed as ${POINT_RADIUS_M} m circle${plural}`
        : `assessed at H3 resolution ${AOI_H3_RESOLUTION}`;
    warnings.push(`${filename}: ${count} ${label}${plural} ${how}.`);
  });
  if (skipped > 0) {
    warnings.push(
      `${filename}: skipped ${skipped} feature${skipped === 1 ? "" : "s"} with no usable geometry.`,
    );
  }
  if (features.length === 0) {
    throw new GeoJsonAoiError(`${filename} contains no usable geometry.`);
  }
  return { features, warnings };
}

/**
 * Concatenate features from several files, the equivalent of pd.concat.
 * Duplicate ids are suffixed so every assessed location stays addressable.
 */
export function combineAoiFeatures(parsed: ParsedAoi[]): ParsedAoi {
  const features: AoiFeature[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>();

  for (const p of parsed) {
    warnings.push(...p.warnings);
    for (const f of p.features) {
      const id = f.properties.unique_id;
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      if (n === 0) {
        features.push(f);
      } else {
        const renamed = `${id}_${n + 1}`;
        warnings.push(`Duplicate id "${id}" renamed to "${renamed}".`);
        features.push({ ...f, properties: { unique_id: renamed } });
      }
    }
  }
  return { features, warnings };
}

/** Build the payload the backend expects: gdf[["unique_id","geometry"]].to_json(). */
export function toGeodataframe(features: AoiFeature[]) {
  return {
    type: "FeatureCollection" as const,
    features: features.map((f) => ({
      type: "Feature" as const,
      properties: { unique_id: f.properties.unique_id },
      geometry: f.geometry,
    })),
  };
}

/** Rough lon/lat bounds across features, for map framing. */
export function featureBounds(
  features: AoiFeature[],
): { minLon: number; minLat: number; maxLon: number; maxLat: number } | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const visit = (coords: unknown) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const [lon, lat] = coords as [number, number];
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    coords.forEach(visit);
  };
  features.forEach((f) => visit(f.geometry.coordinates));
  return Number.isFinite(minLon) ? { minLon, minLat, maxLon, maxLat } : null;
}
