/**
 * EPSG:27700 (OSGB36 / British National Grid) ↔ WGS84 reprojection.
 *
 * The Streamlit app reprojected via geopandas/pyproj to buffer and measure
 * routes in metres. We mirror that with proj4 using the full OSGB36 datum
 * definition (with the +towgs84 7-parameter shift) so distances/areas match
 * pyproj as closely as possible.
 */
import proj4 from "proj4";

export const EPSG_27700 =
  "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 " +
  "+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs";

proj4.defs("EPSG:27700", EPSG_27700);

const WGS84 = "EPSG:4326";

/** [lon, lat] (WGS84) -> [easting, northing] (metres, EPSG:27700). */
export function toBNG([lon, lat]: [number, number]): [number, number] {
  return proj4(WGS84, "EPSG:27700", [lon, lat]) as [number, number];
}

/** [easting, northing] (EPSG:27700) -> [lon, lat] (WGS84). */
export function toWGS84([x, y]: [number, number]): [number, number] {
  return proj4("EPSG:27700", WGS84, [x, y]) as [number, number];
}
