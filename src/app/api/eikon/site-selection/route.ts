import { NextRequest, NextResponse } from "next/server";
import { backendErrorResponse } from "@/lib/server/safeError";
import { workerAwakeCheck } from "@/lib/server/assessment";
import { fetchSiteSelection } from "@/lib/server/siteSelection";
import { fetchAreaCells } from "@/lib/server/areaCells";

import {
  MAX_CATCHMENT_KRING,
  MIN_CATCHMENT_KRING,
  MAX_CRITERIA,
  MAX_WEIGHT_TOTAL,
  isCellScope,
  projectTable,
} from "@/lib/siteSelection";

/**
 * Matches the tab's own limit, applied here because a named scope's cells are
 * counted on this side rather than in the browser.
 */
const CELL_LIMIT = 200_000;

/**
 * POST /api/eikon/site-selection
 *   { apiKey, desiredCriteria[], desiredWeighting[], undesiredCriteria[],
 *     undesiredWeighting[], desiredKrings[], undesiredKrings[], catchment,
 *     h3Cells[] }
 *   -> { rows, cellColumn, scoreColumns, unmatchedCriteria }
 *
 * The net-desired table for an area of interest: the desired criteria scored
 * against the undesired ones. One upstream call — the endpoint combines the
 * two halves itself.
 *
 * No country is sent. The endpoint takes H3 cells, which are globally unique
 * and carry their own location, so it resolves the reference data from them;
 * there is no country list to enforce here and nothing to pre-empt the
 * backend with. The AOI's country is only ever used in the UI to point the
 * drawing map at the right part of the world.
 *
 * The area of interest arrives one of two ways, following the search submit
 * route: a drawn or uploaded AOI as `h3Cells`, or a whole-country/by-area
 * scope as `spatialResolution` plus `selectedArea`.
 *
 * A named scope is resolved to cells here, by /get_h3_cells_for_area, because
 * the site selection endpoint takes `h3_cells` and nothing else. That keeps
 * the UK district geometry on the backend where it already lives, rather than
 * shipping 400 districts' worth of it to the browser, and makes a by-area run
 * two upstream calls: resolve, then score.
 *
 * The response is narrowed to the columns the user asked for before it leaves
 * this route — see projectTable. Everything else the model returns stays on
 * the server rather than being sent to the browser and hidden there.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      apiKey?: string;
      desiredCriteria?: string[];
      desiredWeighting?: number[];
      undesiredCriteria?: string[];
      undesiredWeighting?: number[];
      desiredKrings?: number[];
      undesiredKrings?: number[];
      catchment?: boolean;
      h3Cells?: string[];
      spatialResolution?: string;
      selectedArea?: string | null;
      country?: string;
    };
    const { apiKey, desiredCriteria, undesiredCriteria, h3Cells, spatialResolution } = body;
    // A drawn or uploaded AOI arrives as cells; a whole-country or by-area
    // scope is a name the backend resolves, so there are none to send.
    const needsCells = !spatialResolution || isCellScope(spatialResolution);

    if (!apiKey) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    // Both lists are required by the endpoint and neither may be empty: it
    // rejects an empty undesired_criteria outright, so there is no "desired
    // only" run to pass through.
    if (!desiredCriteria?.length) {
      return NextResponse.json(
        { error: "Please provide at least one desired criterion." },
        { status: 400 },
      );
    }
    if (!undesiredCriteria?.length) {
      return NextResponse.json(
        { error: "Please provide at least one undesired criterion." },
        { status: 400 },
      );
    }
    if (desiredCriteria.length > MAX_CRITERIA || undesiredCriteria.length > MAX_CRITERIA) {
      return NextResponse.json(
        { error: `Up to ${MAX_CRITERIA} criteria in each list.` },
        { status: 400 },
      );
    }
    // A by-area scope that names no area would be resolved by the backend as
    // whichever area it defaults to, which is not what anyone asked for.
    if (spatialResolution?.endsWith(" - area") && !body.selectedArea) {
      return NextResponse.json({ error: "Please choose an area." }, { status: 400 });
    }
    if (needsCells && !h3Cells?.length) {
      return NextResponse.json(
        { error: "No H3 cells fall inside that area. Try a larger area or a buffer." },
        { status: 400 },
      );
    }

    // Weighting is optional, and a list that does not line up with its
    // criteria is dropped rather than patched: a weight applied to the wrong
    // criterion is a wrong answer that looks like a right one, and the
    // backend's own default is the better fallback. Shares must each sit in
    // (0, 1] and total no more than 1.
    const weights = (supplied: number[] | undefined, criteria: string[]) => {
      if (!supplied?.length) return undefined;
      if (supplied.length !== criteria.length) return undefined;
      if (!supplied.every((w) => Number.isFinite(w) && w > 0 && w <= MAX_WEIGHT_TOTAL)) {
        return undefined;
      }
      const total = supplied.reduce((sum, w) => sum + w, 0);
      // Tolerance for the float arithmetic behind 0.1 + 0.2 + 0.7.
      return total > MAX_WEIGHT_TOTAL + 1e-9 ? undefined : supplied;
    };

    // Catchment radii, unlike weights, cannot be quietly dropped when they do
    // not line up: dropping them turns a catchment run into a plain one and
    // answers a different question than the one that was asked, so a bad list
    // is refused instead.
    let desiredKrings: number[] | undefined;
    let undesiredKrings: number[] | undefined;
    if (body.catchment) {
      const rings = (supplied: number[] | undefined, criteria: string[]) =>
        supplied?.length === criteria.length &&
        // 0 is the cell on its own, and the floor rather than a missing
        // value: a criterion always carries a radius in catchment mode.
        supplied.every(
          (k) =>
            Number.isInteger(k) &&
            k >= MIN_CATCHMENT_KRING &&
            k <= MAX_CATCHMENT_KRING,
        )
          ? supplied
          : undefined;
      desiredKrings = rings(body.desiredKrings, desiredCriteria);
      undesiredKrings = rings(body.undesiredKrings, undesiredCriteria);
      if (!desiredKrings || !undesiredKrings) {
        return NextResponse.json(
          {
            error: `With a catchment area, every criterion needs a radius between ${MIN_CATCHMENT_KRING} and ${MAX_CATCHMENT_KRING} rings.`,
          },
          { status: 400 },
        );
      }
    }

    // A named scope carries no cells, so they are looked up before anything
    // is scored. Done before the worker gate: there is no point waking the
    // assessment worker for an area that resolves to nothing.
    // The cell lookup serves named areas only — a country is not a supported
    // area name — so a whole-country scope is refused here, with the reason,
    // rather than failing further in as an unrecognised area.
    if (spatialResolution?.endsWith(" - all")) {
      return NextResponse.json(
        {
          error:
            "Whole-country runs aren't available yet. Choose an area, draw one on the map, or upload a GeoJSON.",
        },
        { status: 400 },
      );
    }

    let cells = needsCells ? h3Cells : undefined;
    if (!needsCells && spatialResolution) {
      cells = await fetchAreaCells({ apiKey, area: body.selectedArea! });
      if (cells.length === 0) {
        return NextResponse.json(
          { error: "No cells were found for that area." },
          { status: 422 },
        );
      }
      if (cells.length > CELL_LIMIT) {
        return NextResponse.json(
          {
            error: `That area covers ${cells.length.toLocaleString()} cells, over the ${CELL_LIMIT.toLocaleString()}-cell limit. Choose a smaller area.`,
          },
          { status: 400 },
        );
      }
    }

    const gate = await workerAwakeCheck();
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const rows = await fetchSiteSelection({
      apiKey,
      desiredCriteria,
      undesiredCriteria,
      // Always cells by this point, whichever way the scope was given.
      h3Cells: cells,
      desiredWeighting: weights(body.desiredWeighting, desiredCriteria),
      undesiredWeighting: weights(body.undesiredWeighting, undesiredCriteria),
      desiredKrings,
      undesiredKrings,
    });

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Site selection returned no cells for that area." },
        { status: 502 },
      );
    }

    const projected = projectTable(rows, [...desiredCriteria, ...undesiredCriteria]);
    if (!projected.cellColumn) {
      return NextResponse.json(
        { error: "Site selection returned a table with no recognisable H3 cell column." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      rows: projected.rows,
      cellColumn: projected.cellColumn,
      scoreColumns: projected.scoreColumns,
      unmatchedCriteria: projected.unmatchedCriteria,
    });
  } catch (err) {
    return backendErrorResponse(err, "Site selection failed");
  }
}
