import { NextRequest, NextResponse } from "next/server";
import { BackendError } from "@/lib/server/backend";
import { fetchAssessment, workerAwakeCheck } from "@/lib/server/assessment";
import { countryForAoi } from "@/lib/server/aoiCountry";

/**
 * POST /api/eikon/risk-assessment
 *   { apiKey, criteria[], h3Cells[], geodataframe, country? }  ->
 *   { assessment: AssessmentCell[], country }
 *
 * The risk half of the drone corridor pipeline, run against any area of
 * interest instead of a corridor between two points. The country is resolved
 * from the AOI's own geometry rather than chosen in the UI, so an AOI drawn or
 * uploaded anywhere is assessed against the right reference data. No country
 * list is enforced here: whichever country the lookup names is passed
 * straight through, and the backend is the authority on what it covers.
 *
 * `country` in the request is only a fallback for when the lookup cannot
 * place the AOI at all.
 */
export async function POST(req: NextRequest) {
  try {
    const { apiKey, criteria, h3Cells, geodataframe, country } = (await req.json()) as {
      apiKey?: string;
      criteria?: string[];
      h3Cells?: string[];
      geodataframe?: unknown;
      country?: string;
    };

    if (!apiKey || !criteria?.length || !h3Cells?.length) {
      return NextResponse.json(
        { error: "apiKey, criteria and h3Cells are required" },
        { status: 400 },
      );
    }
    if (!geodataframe) {
      return NextResponse.json(
        { error: "An area of interest (geodataframe) is required" },
        { status: 400 },
      );
    }

    const resolved = (await countryForAoi(geodataframe, apiKey)) ?? country?.toLowerCase() ?? null;
    if (!resolved) {
      return NextResponse.json(
        {
          error:
            "Couldn't tell which country that area is in. Eikon covers land in the countries it has imagery for — check the area sits over one of them.",
        },
        { status: 422 },
      );
    }

    const gate = await workerAwakeCheck();
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const assessment = await fetchAssessment({
      apiKey,
      criteria,
      h3Cells,
      country: resolved,
    });
    return NextResponse.json({ assessment, country: resolved });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Risk assessment failed" },
      { status },
    );
  }
}
