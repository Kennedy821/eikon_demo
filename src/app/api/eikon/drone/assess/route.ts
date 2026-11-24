import { NextRequest, NextResponse } from "next/server";
import { BackendError } from "@/lib/server/backend";
import { backendErrorResponse } from "@/lib/server/safeError";
import { fetchAssessment, workerAwakeCheck } from "@/lib/server/assessment";
import { OSM_SEARCH_COUNTRY_LIST } from "@/lib/searchPipeline";

/**
 * POST /api/eikon/drone/assess  { apiKey, criteria[], h3Cells[], country }  ->
 *   { assessment: AssessmentCell[] }
 *
 * The corridor's own country comes from the origin/destination presets, so it
 * is taken from the request rather than resolved from the geometry.
 */
/**
 * Countries this route will forward, derived from the OSM search list so it
 * cannot turn away a country the corridor tab offers. It read
 * ["uk", "hongkong"] while every other country was already selectable
 * elsewhere, which meant part one of a corridor run failed with a 400 before
 * anything reached the assessment.
 *
 * This is the same upstream endpoint the risk assessment tab posts to, and
 * that endpoint decides what it holds reference data for; the list here is
 * only a guard against a value the app never offers.
 */
const VALID_COUNTRIES = ["uk", "hongkong", ...OSM_SEARCH_COUNTRY_LIST];

export async function POST(req: NextRequest) {
  try {
    const { apiKey, criteria, h3Cells, country } = (await req.json()) as {
      apiKey?: string;
      criteria?: string[];
      h3Cells?: string[];
      country?: string;
    };
    if (!apiKey || !criteria?.length || !h3Cells?.length) {
      return NextResponse.json(
        { error: "apiKey, criteria and h3Cells are required" },
        { status: 400 },
      );
    }
    // Reject a country the app never offers rather than letting it fail
    // deeper in with a less obvious message.
    const countryValue = (country ?? "uk").toLowerCase();
    if (!VALID_COUNTRIES.includes(countryValue)) {
      return NextResponse.json(
        { error: `country must be one of: ${VALID_COUNTRIES.join(", ")}` },
        { status: 400 },
      );
    }

    const gate = await workerAwakeCheck();
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const assessment = await fetchAssessment({
      apiKey,
      criteria,
      h3Cells,
      country: countryValue,
    });
    return NextResponse.json({ assessment });
  } catch (err) {
    return backendErrorResponse(err, "Assessment failed");
  }
}
