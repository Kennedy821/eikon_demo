/**
 * Shared constants for the remote visual inspection pipeline, used by the
 * Remote Inspection tab and the Admin Tools cost calculator.
 */

/** Object classes the remote verification backend supports. */
export const OBJECT_OPTIONS = [
  "solar_panels",
  "industrial_buildings",
  "motorway",
  "railway_line",
  "lake",
  "parking_lot",
  "tennis_court",
  "wind_turbine",
  "electricity_pylon",
  "residential_buildings",
  "agricultural_land",
];

export const ALL_OBJECTS = "all";

/** Average area of a resolution-9 tile, for sizing an area in tiles. */
export const TILE_AREA_KM2 = 0.1053;

/**
 * Tiles a single buffered point covers: the circle of that radius, centred on
 * the tile centre, encloses this many tile centres. Measured against h3-js,
 * matching what the Remote Inspection tab actually submits.
 */
export const TILES_PER_POINT: Record<number, number> = {
  0: 1,
  100: 1,
  500: 7,
  1000: 35,
};

/**
 * Billing is on the size of the result payload, not the imagery. The result is
 * a column-oriented table with one row per tile per object class.
 *
 * Measured against a real completed job: the payload is ~142 bytes of fixed
 * overhead (the column names) plus ~188 bytes per row. Both are editable in
 * the calculator since row width varies with the columns a run returns.
 */
export const DEFAULT_BYTES_PER_ROW = 188;
export const DEFAULT_FIXED_BYTES = 142;

/** Price of AI-driven workloads, per KB of result payload. */
export const DEFAULT_RATE_PER_KB = 0.002;

export interface CostEstimate {
  tiles: number;
  objects: number;
  rows: number;
  kb: number;
  cost: number;
}

/** Rows are one per tile per object class; cost follows the payload size. */
export function estimateCost(opts: {
  tiles: number;
  objects: number;
  bytesPerRow: number;
  fixedBytes: number;
  ratePerKb: number;
}): CostEstimate {
  const tiles = Math.max(0, Math.round(opts.tiles));
  const objects = Math.max(0, Math.round(opts.objects));
  const rows = tiles * objects;
  const bytes = rows > 0 ? opts.fixedBytes + rows * opts.bytesPerRow : 0;
  const kb = bytes / 1024;
  return { tiles, objects, rows, kb, cost: kb * opts.ratePerKb };
}

export function labelForObject(name: string): string {
  return name === ALL_OBJECTS ? "All objects" : name.replace(/_/g, " ");
}
