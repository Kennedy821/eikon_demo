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
 * The metric CRS each country is measured in. Anything unrecognised falls back
 * to the UK grid, which is the behaviour every caller had before countries
 * existed.
 */
const METRIC_CRS: Record<string, string> = {
  uk: "EPSG:27700",
  hongkong: "EPSG:2326",
};

export type CountryCode = keyof typeof METRIC_CRS | string;

/** The projected CRS used to measure distances in `country`. */
export function metricCrs(country: CountryCode = "uk"): string {
  return METRIC_CRS[String(country).toLowerCase()] ?? "EPSG:27700";
}

/** [lon, lat] (WGS84) -> [easting, northing] (metres) in the country's grid. */
export function toMetric(
  [lon, lat]: [number, number],
  country: CountryCode = "uk",
): [number, number] {
  return proj4(WGS84, metricCrs(country), [lon, lat]) as [number, number];
}

/** [easting, northing] in the country's grid -> [lon, lat] (WGS84). */
export function fromMetric(
  [x, y]: [number, number],
  country: CountryCode = "uk",
): [number, number] {
  return proj4(metricCrs(country), WGS84, [x, y]) as [number, number];
}

