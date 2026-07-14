import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/history  { apiKey, numSearches? }  ->
 *   { searches: Array<{ columns: string[]; rows: Record<string, unknown>[] }> }
 *
 * Mirrors eikonsai.utils.get_previous_search_api_results:
 *   POST ngrok /get_latest_results_for_eikon_search_agent_api_job_web_many
 *   { api_key, num_searches }  -> { latest_search_results: "<json>|<json>|..." }
 *
 * The server joins one pandas .to_json() (column-oriented) per search with
 * "|". The SDK simply does `str.split("|")` and parses each fragment — that is
 * the proven-correct behaviour, so we do exactly the same, running each
 * fragment through a real JSON parser. A previous hand-rolled balanced-brace
 * scanner could desync on real to_json output and shift user_search_query onto
 * the wrong search block. Cap is 5.
 */

/** Split the "|"-joined payload into per-search JSON objects, exactly as the SDK does. */
function splitSearchObjects(s: string): Record<string, Record<string, unknown>>[] {
  return s
    .split("|")
    .map((fragment) => fragment.trim())
    .filter(Boolean)
    .map((fragment) => {
      try {
        return JSON.parse(fragment) as Record<string, Record<string, unknown>>;
      } catch {
        return null; // skip a malformed fragment rather than shift alignment
      }
    })
    .filter((o): o is Record<string, Record<string, unknown>> => o !== null);
}

function columnsToRows(parsed: Record<string, Record<string, unknown>>): {
  columns: string[];
  rows: Record<string, unknown>[];
} {
  const columns = Object.keys(parsed);
  if (columns.length === 0) return { columns, rows: [] };
  const indices = Object.keys(parsed[columns[0]] ?? {});
  const rows = indices.map((idx) => {
    const row: Record<string, unknown> = {};
    for (const col of columns) row[col] = parsed[col]?.[idx];
    return row;
  });
  return { columns, rows };
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, numSearches = 3 } = (await req.json()) as {
      apiKey?: string;
      numSearches?: number;
    };
    if (!apiKey) {
      return NextResponse.json({ error: "apiKey required" }, { status: 400 });
    }

    const data = await callBackend<{ latest_search_results?: string }>("previousSearches", {
      json: { api_key: apiKey, num_searches: Math.trunc(numSearches) },
      timeoutMs: 360_000,
    });

    const raw = data?.latest_search_results ?? "";
    // Hide heavy columns, like the Streamlit history view does.
    const HIDE = new Set(["objects_detected", "ai_rationale"]);
    const searches = splitSearchObjects(raw).map((obj) => {
      const { columns, rows } = columnsToRows(obj);
      const visible = columns.filter((c) => !HIDE.has(c));
      return { columns: visible.length ? visible : columns, rows };
    });

    return NextResponse.json({ searches });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "History fetch failed" },
      { status },
    );
  }
}
