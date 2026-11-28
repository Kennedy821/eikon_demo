/**
 * Distance on the H3 res-9 grid, expressed as rings of neighbouring cells.
 *
 * The backend takes a k-ring — how many rings of cells out from a centre to
 * include — wherever a distance is wanted, and a user thinks in metres. The
 * conversion is one edge length per ring, which is how the corridor tab's
 * acceptable landing distance has always worked; it lives here because site
 * selection's catchment areas are the same arithmetic over the same grid, and
 * two copies of an edge length would be two things to get wrong.
 *
 * Rings are floored, never rounded: a ring is either reached or it is not, and
 * rounding 260m up to two rings would search 348m of ground for a distance the
 * user said was 260m.
 */

/** Mean edge length of an H3 resolution 9 cell, in metres. */
export const H9_EDGE_M = 174;

/** Rings fully inside a distance. 0 is the centre cell on its own. */
export function metresToKring(metres: number): number {
  if (!Number.isFinite(metres) || metres <= 0) return 0;
  return Math.floor(metres / H9_EDGE_M);
}

/** The distance a ring count stands for. */
export function kringToMetres(kring: number): number {
  return kring * H9_EDGE_M;
}

/** A ring count as a distance, for a label. */
export function kringLabel(kring: number): string {
  return `${kringToMetres(kring).toLocaleString()} m`;
}
