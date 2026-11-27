/**
 * SERVER-ONLY: the H3 cells covering a named area.
 *
 * The site selection endpoint takes `h3_cells` and nothing else — no area
 * name, no scope (probed 2026-11-27). The UK district geometry lives on the
 * backend, so resolving a name to cells is a backend question, and
 * /get_h3_cells_for_area is the answer to it. A by-area run is therefore two
 * upstream calls: resolve, then score.
 *
 * It resolves named areas only. A whole country is not a supported area name,
 * so a "- all" scope has no answer here and is refused by the route before it
 * gets this far.
 *
 * Kept apart from the site selection module because it is a general
 * area → cells lookup: anything else that needs the cells for a named area
 * should call this rather than grow its own copy.
 */
import { callBackend } from "@/lib/server/backend";

/** A lookup, not a scoring job — it should answer quickly. */
const AREA_CELLS_TIMEOUT_MS = 120_000;

/**
 * Request fields, confirmed against the endpoint on 2026-11-27.
 *
 * `area_name` and nothing else — not `selected_area`, which is what the search
 * submit route calls the same thing, and not `area`. Anything else is ignored.
 * The name must be one the backend recognises; it answers an unknown one with
 * 400 and points at /list_supported_areas for the valid set, which is what
 * src/content/uk_areas.json is a copy of.
 */
function requestFor(input: { apiKey: string; area: string }) {
  return {
    api_key: input.apiKey,
    area_name: input.area,
  };
}

/** Response fields that could plausibly carry the list, best first. */
const CELL_KEYS = ["h3_cells", "cells", "h3_cell_list", "h3_index_9", "hexes"];

export async function fetchAreaCells(input: {
  apiKey: string;
  /** A supported area name, as uk_areas.json spells it ("CityofLondon"). */
  area: string;
}): Promise<string[]> {
  const data = await callBackend<unknown>("areaCells", {
    json: requestFor(input),
    timeoutMs: AREA_CELLS_TIMEOUT_MS,
  });
  return cellsFrom(data);
}

/**
 * The cell list out of whatever shape the response arrived in: a bare array,
 * a named field, or either of those JSON-encoded as a string — the encoding
 * the assessment endpoints use for their tables.
 *
 * Anything that is not a string is dropped rather than coerced: a cell id is
 * a string, and a number here would mean the response is something other than
 * what this expects.
 */
export function cellsFrom(payload: unknown): string[] {
  const asList = (value: unknown): string[] | null => {
    let parsed = value;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return null;
      }
    }
    if (!Array.isArray(parsed)) return null;
    const cells = parsed.filter((c): c is string => typeof c === "string");
    return cells.length > 0 ? cells : null;
  };

  const direct = asList(payload);
  if (direct) return direct;
  if (!payload || typeof payload !== "object") return [];

  const body = payload as Record<string, unknown>;
  const ordered = [
    ...CELL_KEYS.filter((k) => k in body),
    ...Object.keys(body).filter((k) => !CELL_KEYS.includes(k)),
  ];
  for (const key of ordered) {
    const cells = asList(body[key]);
    if (cells) return cells;
  }
  return [];
}
