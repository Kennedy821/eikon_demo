/**
 * Projected-CRS ↔ WGS84 reprojection, per country.
 *
 * The Streamlit app reprojected via geopandas/pyproj to buffer and measure
 * routes in metres. We mirror that with proj4 using full datum definitions
 * (with the +towgs84 7-parameter shifts) so distances/areas match pyproj as
 * closely as possible.
 *
 * Each country needs its own projection: British National Grid is a transverse
 * Mercator on a 2°W central meridian, so using it at Hong Kong's longitude
 * overstates distance by about 1.8x. Hong Kong uses EPSG:2326 instead, which
 * is what the backend measures and returns route geometry in.
 */
import proj4 from "proj4";
import { COUNTRIES } from "@/lib/countries";

export const EPSG_27700 =
  "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 " +
  "+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs";

/** EPSG:2326 (Hong Kong 1980 Grid System). */
export const EPSG_2326 =
  "+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 " +
  "+x_0=836694.05 +y_0=819069.8 +ellps=intl " +
  "+towgs84=-162.619,-276.959,-161.764,0.067753,-2.24365,-1.15883,-1.09425 " +
  "+units=m +no_defs";

proj4.defs("EPSG:27700", EPSG_27700);
proj4.defs("EPSG:2326", EPSG_2326);

const WGS84 = "EPSG:4326";

/**
 * The countries measured in their own national grid, which is what the
 * backend measures and returns route geometry in for each of them.
 */
const NATIONAL_GRID: Record<string, string> = {
  uk: "EPSG:27700",
  hongkong: "EPSG:2326",
};

/** UTM zone containing a longitude; 1..60, each six degrees wide. */
function utmZone(longitude: number): number {
  return Math.floor((longitude + 180) / 6) + 1;
}

/**
 * The UTM CRS covering a point, registering its definition on first use.
 * 326xx north of the equator, 327xx south.
 */
export function utmCrsFor([longitude, latitude]: Anchor): string {
  const zone = utmZone(longitude);
  const code = `EPSG:${(latitude < 0 ? 32700 : 32600) + zone}`;
  if (!proj4.defs(code)) {
    proj4.defs(
      code,
      `+proj=utm +zone=${zone}${latitude < 0 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`,
    );
  }
  return code;
}

/**
 * Every other country is measured in the UTM zone its map view sits in.
 *
 * Falling back to the British grid instead, as this did before there were
 * other countries, is the same mistake the comment above warns about with
 * Hong Kong, just less visible: a transverse Mercator on a 2°W meridian
 * overstates a Greek corridor by 6% and a Cypriot one by 13%, and since the
 * corridor buffer is applied in this CRS a "7.5 km" buffer would come out
 * 6.6 km wide on the ground. UTM is within 0.2% for all of them.
 *
 * A country wider than one zone is measured in the zone its centre falls in,
 * which costs a tenth of a percent at the far edge — far less than the error
 * it replaces.
 */
const UTM_CRS: Record<string, string> = Object.fromEntries(
  COUNTRIES.filter((c) => !(c.value in NATIONAL_GRID)).map((c) => [
    c.value,
    utmCrsFor([c.mapView.longitude, c.mapView.latitude]),
  ]),
);

export type CountryCode = keyof typeof NATIONAL_GRID | string;

/**
 * A [lon, lat] point used to pick a UTM zone when the country is not one of
 * the known ones. Everything converted for a single geometry must share one
 * anchor, or two points either side of a zone boundary land in different
 * grids and the shape tears.
 */
export type Anchor = [number, number];

/**
 * The projected CRS used to measure distances in `country`.
 *
 * A known country answers from its own grid or zone and the anchor is
 * ignored. Anything else — a country resolved upstream that the table has
 * never heard of — is measured in the UTM zone of the anchor, which is right
 * anywhere on earth. Without an anchor there is nothing to go on: the old
 * behaviour of quietly returning the British grid measured foreign corridors
 * on a 2°W meridian, and EPSG:4326 cannot stand in either, because these are
 * the units the corridor buffer is applied in — 7,500 m would become 7,500
 * degrees. So that case throws.
 */
export function metricCrs(country: CountryCode = "uk", anchor?: Anchor): string {
  const key = String(country).toLowerCase();
  const known = NATIONAL_GRID[key] ?? UTM_CRS[key];
  if (known) return known;
  if (anchor && Number.isFinite(anchor[0]) && Number.isFinite(anchor[1])) {
    return utmCrsFor(anchor);
  }
  throw new Error(
    `No metric CRS for country "${country}" and no anchor point to pick a ` +
      `UTM zone from. Distances and the corridor buffer are computed in ` +
      `metres in this CRS, so there is no safe default.`,
  );
}

/**
 * [lon, lat] (WGS84) -> [easting, northing] (metres) in the country's grid.
 * The anchor defaults to the point itself, which is right for a one-off
 * conversion; a caller converting several points for one geometry passes a
 * single shared anchor instead.
 */
export function toMetric(
  [lon, lat]: [number, number],
  country: CountryCode = "uk",
  anchor: Anchor = [lon, lat],
): [number, number] {
  return proj4(WGS84, metricCrs(country, anchor), [lon, lat]) as [number, number];
}

/**
 * [easting, northing] in the country's grid -> [lon, lat] (WGS84). Metres
 * carry no hint of where they are, so an unknown country needs the same
 * anchor the forward conversion used.
 */
export function fromMetric(
  [x, y]: [number, number],
  country: CountryCode = "uk",
  anchor?: Anchor,
): [number, number] {
  return proj4(metricCrs(country, anchor), WGS84, [x, y]) as [number, number];
}

/** Convert in an explicit CRS, for callers that have resolved one already. */
export function toCrs(crs: string, [lon, lat]: [number, number]): [number, number] {
  return proj4(WGS84, crs, [lon, lat]) as [number, number];
}

export function fromCrs(crs: string, [x, y]: [number, number]): [number, number] {
  return proj4(crs, WGS84, [x, y]) as [number, number];
}

/** Rough great-circle distance in km, for comparing candidate CRSs. */
function distanceKm([aLon, aLat]: Anchor, [bLon, bLat]: Anchor): number {
  const north = (bLat - aLat) * 111.32;
  const east = (bLon - aLon) * 111.32 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(north, east);
}

/**
 * Whether a point is plausibly inside a country, judged against the framing
 * its map view was fitted to. Generous on purpose: this only has to tell a
 * corridor in the selected country from one on another continent.
 */
function withinCountry(country: CountryCode, [lon, lat]: Anchor): boolean {
  const entry = COUNTRIES.find((c) => c.value === String(country).toLowerCase());
  if (!entry) return false;
  const { mapView } = entry;
  // The map view's zoom was fitted so the country fills the draw map, so the
  // span it covers is a usable stand-in for the country's own extent.
  const spanDeg = (360 / 2 ** mapView.zoom) * (511 / 256);
  const radiusKm = spanDeg * 111.32 * 0.75;
  return distanceKm([mapView.longitude, mapView.latitude], [lon, lat]) <= radiusKm;
}

/**
 * The CRS to measure a geometry in, given where that geometry actually is.
 *
 * The country selector says which reference data to assess against; it does
 * not constrain the coordinates, and nothing stops a corridor being drawn in
 * one country while another is selected. Measuring such a corridor in the
 * selected country's grid is how a Greek route ends up buffered on a 2°W
 * meridian. So the selected country's CRS is used only while the geometry is
 * actually in it, and anything further afield is measured in its own UTM zone.
 */
export function metricCrsForPoint(country: CountryCode, anchor: Anchor): string {
  return withinCountry(country, anchor) ? metricCrs(country, anchor) : utmCrsFor(anchor);
}

/**
 * Pick the CRS a set of projected coordinates is actually in.
 *
 * The pathfinder is sent no country and answers with WKT in a CRS it chooses
 * from the cells themselves, so the client cannot derive it — it previously
 * assumed the selected country's, and decoded the geometry into the sea
 * whenever the two disagreed. What the client does know is where the route
 * has to be: it starts at the origin cell. Decoding one vertex under each
 * candidate and keeping whichever lands nearest that cell identifies the CRS
 * without having to know how the backend chose it.
 *
 * Returns null when no candidate lands near enough to be believed, so the
 * caller can say so rather than draw a route in the wrong hemisphere.
 */
export function crsNearest(
  sample: [number, number],
  reference: Anchor,
  candidates: string[],
  toleranceKm = 50,
): string | null {
  let best: { crs: string; km: number } | null = null;
  for (const crs of candidates) {
    try {
      const [lon, lat] = fromCrs(crs, sample);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      const km = distanceKm(reference, [lon, lat]);
      if (!best || km < best.km) best = { crs, km };
    } catch {
      // A CRS that cannot represent the point is simply not the answer.
    }
  }
  return best && best.km <= toleranceKm ? best.crs : null;
}

/** Metres per degree, for a local tangent plane around a reference latitude. */
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320;

/**
 * Decode projected coordinates whose CRS could not be identified, by solving
 * for the mapping instead of naming it.
 *
 * The pathfinder routes between the H3 cells it was given, so its first and
 * last vertices are the origin and destination cell centres — two points
 * whose position is known exactly before the response is read. Over a
 * corridor of tens of kilometres any of these projections is, to within a few
 * metres, a rotation and a uniform scale about a local tangent plane, and two
 * correspondences pin that down exactly: the scale from the ratio of the two
 * separations, the rotation from the difference of the two bearings.
 *
 * This is what stops an unrecognised CRS putting the route on another
 * continent. It is a fallback, not a replacement: a named CRS is exact, while
 * this is accurate to tens of metres over a corridor, so it is used only when
 * no candidate fits.
 */
export function solveProjection(
  projected: [[number, number], [number, number]],
  geographic: [Anchor, Anchor],
): ((point: [number, number]) => [number, number]) | null {
  const [p0, p1] = projected;
  const [g0, g1] = geographic;

  const lonScale = M_PER_DEG_LON * Math.cos((g0[1] * Math.PI) / 180);
  const east = (g1[0] - g0[0]) * lonScale;
  const north = (g1[1] - g0[1]) * M_PER_DEG_LAT;

  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const projectedLength = Math.hypot(dx, dy);
  const groundLength = Math.hypot(east, north);
  if (!(projectedLength > 0) || !(groundLength > 0)) return null;

  const scale = groundLength / projectedLength;
  const rotation = Math.atan2(north, east) - Math.atan2(dy, dx);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return ([x, y]) => {
    const u = (x - p0[0]) * scale;
    const v = (y - p0[1]) * scale;
    return [g0[0] + (u * cos - v * sin) / lonScale, g0[1] + (u * sin + v * cos) / M_PER_DEG_LAT];
  };
}
