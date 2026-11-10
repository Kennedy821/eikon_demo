/**
 * Fit a set of WGS84 points to a map canvas.
 *
 * Bucketing a lat+lon "spread" into fixed zoom steps was tuned on UK-sized
 * geometry and left anything smaller a few pixels wide, so the zoom is solved
 * from the bounding box against the canvas instead.
 */

export interface MapView {
  latitude: number;
  longitude: number;
  zoom: number;
}

/** Canvas the geometry is fitted to; height matches the map components' default. */
const DEFAULT_WIDTH_PX = 900;
const DEFAULT_HEIGHT_PX = 540;
const TILE_SIZE_PX = 512;
/** Leaves a margin so the geometry does not touch the canvas edge. */
const DEFAULT_PADDING = 0.85;

function mercatorY(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** `points` are [lon, lat]. */
export function fitView(
  points: [number, number][],
  {
    width = DEFAULT_WIDTH_PX,
    height = DEFAULT_HEIGHT_PX,
    padding = DEFAULT_PADDING,
  }: { width?: number; height?: number; padding?: number } = {},
): MapView {
  if (points.length === 0) return { latitude: 54, longitude: -2.5, zoom: 4.2 };

  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  const lonFraction = Math.max(maxLon - minLon, 1e-6) / 360;
  const latFraction = Math.max(Math.abs(mercatorY(maxLat) - mercatorY(minLat)), 1e-6);
  const zoom =
    Math.min(
      Math.log2(width / (TILE_SIZE_PX * lonFraction)),
      Math.log2(height / (TILE_SIZE_PX * latFraction)),
    ) + Math.log2(padding);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    zoom: Math.max(2, Math.min(15, zoom)),
  };
}
