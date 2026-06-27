import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/history  { apiKey, numSearches? }  ->
 *   { searches: Array<{ columns: string[]; rows: Record<string, unknown>[] }> }
 *
 * Mirrors eikonsai.utils.get_previous_search_api_results + fetch_previous_searches:
 *   POST ngrok /get_latest_results_for_eikon_search_agent_api_job_web_many
 *   { api_key, num_searches }  -> { latest_search_results: "<json>|<json>|..." }
 *
 * The server joins JSON-encoded DataFrame dicts with "|", but a "|" inside a
 * JSON value shatters a naive split. So we scan for balanced JSON objects
 * instead (the JS equivalent of the Python raw_decode approach). Cap is 5.
 */

/** Extract top-level balanced {...} JSON objects from a string, ignoring "|". */
function extractJsonObjects(s: string): Record<string, Record<string, unknown>>[] {
  const objects: Record<string, Record<string, unknown>>[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          objects.push(JSON.parse(s.slice(start, i + 1)));
        } catch {
          /* skip malformed fragment */
        }
        start = -1;
      }
    }
  }
  return objects;
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
    const searches = extractJsonObjects(raw).map((obj) => {
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
