"use client";

import maplibregl from "maplibre-gl";

/**
 * A tile loader that can tell "no imagery here" from imagery.
 *
 * Esri declares its World Imagery pyramid to z23 everywhere, but the imagery
 * behind it stops at a different level in each country, and an absent tile is
 * not a 404 that maplibre could fall back from: the service answers 200 with a
 * grey "Map data not yet available" JPEG. maplibre cannot tell that from a
 * photograph, so it draws it, and a deep zoom goes blank instead of blurry.
 *
 * How deep the imagery goes is not a fact the app can hold as a constant. One
 * tile sampled at eight locations per country: Spain, Austria and Denmark are
 * clean to z20, Belgium to z19, and Bulgaria, Croatia, Cyprus, Czechia,
 * Estonia and Finland only to z18 — and that is today's answer, from an
 * imagery set that is updated continuously. A per-country table would be wrong
 * the moment Esri flies somewhere new.
 *
 * So the tile itself is asked instead. The placeholder is one static JPEG,
 * byte-identical everywhere it was seen — across zooms, countries and
 * neighbouring tiles — so it can be recognised and reported as a failure,
 * which makes maplibre keep the parent tile on screen and scale it. The
 * deepest level with real imagery then wins everywhere, and nowhere goes grey.
 *
 * What maplibre keeps is a parent it has already loaded, so this depends on
 * the view arriving at depth rather than starting there: a map created at z19
 * over a country that stops at z18 has nothing to fall back to and draws
 * blank. The card always opens fitted to its cell, around z15, and is zoomed
 * in from there, so the levels in between are loaded on the way. Anything that
 * opens a map at full zoom needs its own answer.
 */
export const ESRI_SCHEME = "eikon-esri";

/** Marks the "tile is the grey placeholder" failure, so it can be ignored. */
export const NO_IMAGERY = "eikon: no imagery at this level";

/**
 * The placeholder's length, plus four bytes spot-checked inside it. The length
 * alone is nearly enough; the probes make a real tile of exactly that size
 * vanishingly unlikely to be mistaken for it. A false positive would cost one
 * tile, which falls back to its parent, so the failure mode is mild either way.
 */
const PLACEHOLDER_BYTES = 2_521;
const PLACEHOLDER_PROBES: ReadonlyArray<readonly [number, number]> = [
  [600, 0],
  [1200, 222],
  [1800, 86],
  [2400, 0],
];

function isPlaceholder(data: ArrayBuffer): boolean {
  if (data.byteLength !== PLACEHOLDER_BYTES) return false;
  const bytes = new Uint8Array(data);
  return PLACEHOLDER_PROBES.every(([at, value]) => bytes[at] === value);
}

let registered = false;

/** Registers the loader. Safe to call repeatedly; only the first one counts. */
export function registerEsriTileFilter(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  maplibregl.addProtocol(ESRI_SCHEME, async (params, abortController) => {
    const res = await fetch(params.url.replace(`${ESRI_SCHEME}://`, "https://"), {
      signal: abortController.signal,
    });
    const data = await res.arrayBuffer();
    if (isPlaceholder(data)) throw new Error(NO_IMAGERY);
    return { data };
  });
}

/** Points a tile URL at the loader above. */
export function throughTileFilter(url: string): string {
  return url.replace(/^https:\/\//, `${ESRI_SCHEME}://`);
}
