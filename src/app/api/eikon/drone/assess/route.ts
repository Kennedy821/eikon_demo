import { NextRequest, NextResponse } from "next/server";
import { BackendError } from "@/lib/server/backend";
import { fetchAssessment, workerAwakeCheck } from "@/lib/server/assessment";

/**
 * POST /api/eikon/drone/assess  { apiKey, criteria[], h3Cells[], country }  ->
 *   { assessment: AssessmentCell[] }
 *
 * The corridor's own country comes from the origin/destination presets, so it
 * is taken from the request rather than resolved from the geometry.
 */
const VALID_COUNTRIES = ["uk", "hongkong"];

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
    // The backend only recognises these two; reject anything else here rather
    // than letting it fail deeper in with a less obvious message.
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
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Assessment failed" },
      { status },
    );
  }
}
