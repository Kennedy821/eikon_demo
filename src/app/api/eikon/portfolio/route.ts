import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/portfolio
 *   { pairs: [{ orig, dest, origLat, origLon, destLat, destLon }],
 *     resolution, similarityType, apiKey }
 *   -> { results: [{ orig, dest, similarity_score }] }
 *
 * Mirrors eikonsai.jobs.eikon_portfolio_comparison
 *   POST ngrok /eikon_portfolio_comparison {
 *     origin_uniq_id[], destination_uniq_id[], origin_lat_list[],
 *     origin_lon_list[], destination_lat_list[], destination_lon_list[],
 *     api_key, resolution, similarity_type }
 *   -> { portfolio_comparison_result: <column-oriented DataFrame JSON string> }
 */

interface Pair {
  orig: string;
  dest: string;
  origLat: number;
  origLon: number;
  destLat: number;
  destLon: number;
}

/** Column-oriented dict ({col: {idx: val}}) -> row records. */
function columnsToRows(parsed: Record<string, Record<string, unknown>>): Record<string, unknown>[] {
  const columns = Object.keys(parsed);
  if (columns.length === 0) return [];
  const indices = Object.keys(parsed[columns[0]] ?? {});
  return indices.map((idx) => {
    const row: Record<string, unknown> = {};
    for (const col of columns) row[col] = parsed[col]?.[idx];
    return row;
  });
}

export async function POST(req: NextRequest) {
  try {
    const { pairs, resolution = "medium", similarityType = "combined", apiKey } =
      (await req.json()) as {
        pairs?: Pair[];
        resolution?: string;
        similarityType?: string;
        apiKey?: string;
      };

    if (!apiKey || !pairs || pairs.length === 0) {
      return NextResponse.json({ error: "apiKey and at least one pair required" }, { status: 400 });
    }

    const payload = {
      origin_uniq_id: pairs.map((p) => p.orig),
      destination_uniq_id: pairs.map((p) => p.dest),
      origin_lat_list: pairs.map((p) => p.origLat),
      origin_lon_list: pairs.map((p) => p.origLon),
      destination_lat_list: pairs.map((p) => p.destLat),
      destination_lon_list: pairs.map((p) => p.destLon),
      api_key: apiKey,
      resolution,
      similarity_type: similarityType,
    };

    const data = await callBackend<{ portfolio_comparison_result?: string }>("portfolio", {
      json: payload,
      timeoutMs: 1_000_000,
    });

    let rows: Record<string, unknown>[] = [];
    if (data?.portfolio_comparison_result) {
      const parsed = JSON.parse(data.portfolio_comparison_result) as Record<
        string,
        Record<string, unknown>
      >;
      rows = columnsToRows(parsed);
    }

    // Normalise to { orig, dest, similarity } — the endpoint may name the score
    // column `similarity` or `similarity_score`.
    const results = rows.map((r) => {
      const sim = r.similarity ?? r.similarity_score;
      const n = typeof sim === "number" ? sim : parseFloat(String(sim));
      return {
        orig: String(r.orig ?? ""),
        dest: String(r.dest ?? ""),
        similarity: Number.isFinite(n) ? n : null,
      };
    });
    return NextResponse.json({ results });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Portfolio comparison failed" },
      { status },
    );
  }
}
