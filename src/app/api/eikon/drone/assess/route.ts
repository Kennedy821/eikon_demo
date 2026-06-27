import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/drone/assess  { apiKey, criteria[], h3Cells[] }  ->
 *   { assessment: AssessmentCell[] }
 *
 * Ports run_corridor_assessment: first checks the worker is awake
 * (POST /eikon_search_worker_awake), then POSTs the H3 cells + criteria to
 * /run_assessment_custom_polygon_cuda and returns the parsed assessment records.
 * A single POST (no retries) — matching the app's deliberate no-retry behaviour.
 */
export async function POST(req: NextRequest) {
  try {
    const { apiKey, criteria, h3Cells } = (await req.json()) as {
      apiKey?: string;
      criteria?: string[];
      h3Cells?: string[];
    };
    if (!apiKey || !criteria?.length || !h3Cells?.length) {
      return NextResponse.json(
        { error: "apiKey, criteria and h3Cells are required" },
        { status: 400 },
      );
    }

    // Worker-awake gate.
    try {
      const awake = await callBackend<{ status?: string }>("workerAwake", {
        json: { check: "placeholder" },
        timeoutMs: 30_000,
      });
      if (awake?.status !== "awake") {
        return NextResponse.json(
          { error: "Eikon assessment server is not available right now. Please try again shortly." },
          { status: 503 },
        );
      }
    } catch (exc) {
      return NextResponse.json(
        { error: `Could not reach Eikon assessment server: ${exc instanceof Error ? exc.message : exc}` },
        { status: 502 },
      );
    }

    const data = await callBackend<{ assessment_result?: string }>("corridorAssessment", {
      json: { api_key: apiKey, assessment_criteria: criteria, h3_cells: h3Cells },
      timeoutMs: 1_200_000, // corridors can take several minutes
    });

    const assessment = data?.assessment_result ? JSON.parse(data.assessment_result) : [];
    // assessment_result is a column-oriented dict (pd.DataFrame.from_dict); flatten to rows.
    const rows = Array.isArray(assessment) ? assessment : columnsToRows(assessment);
    return NextResponse.json({ assessment: rows });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Assessment failed" },
      { status },
    );
  }
}

function columnsToRows(parsed: Record<string, Record<string, unknown>>): Record<string, unknown>[] {
  const cols = Object.keys(parsed);
  if (cols.length === 0) return [];
  const idx = Object.keys(parsed[cols[0]] ?? {});
  return idx.map((i) => {
    const row: Record<string, unknown> = {};
    for (const c of cols) row[c] = parsed[c]?.[i];
    return row;
  });
}
