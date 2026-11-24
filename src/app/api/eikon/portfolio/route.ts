import { NextRequest, NextResponse } from "next/server";
import { callBackend } from "@/lib/server/backend";
import { backendErrorResponse } from "@/lib/server/safeError";
import { OSM_SEARCH_COUNTRY_LIST } from "@/lib/searchPipeline";

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

/**
 * Countries this route will forward. Derived from the OSM search list rather
 * than written out, so a country cannot be searchable and then be turned away
 * here — which is what happened while this read ["uk", "hongkong"]: every
 * country added to search after Hong Kong returned a result you could see and
 * a "More like this" that failed with a 400.
 *
 * There is one upstream endpoint and it decides what it can compare; this is
 * only a guard against a value the app never offers.
 */
const VALID_COUNTRIES = ["uk", "hongkong", ...OSM_SEARCH_COUNTRY_LIST];

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
    const { pairs, resolution = "medium", similarityType = "combined", apiKey, country } =
      (await req.json()) as {
        pairs?: Pair[];
        resolution?: string;
        similarityType?: string;
        apiKey?: string;
        country?: string;
      };

    if (!apiKey || !pairs || pairs.length === 0) {
      return NextResponse.json({ error: "apiKey and at least one pair required" }, { status: 400 });
    }

    // Reject an unknown country here rather than letting it fail deeper in.
    let countryValue: string | null = null;
    if (country !== undefined) {
      countryValue = country.toLowerCase();
      if (!VALID_COUNTRIES.includes(countryValue)) {
        return NextResponse.json(
          { error: `country must be one of: ${VALID_COUNTRIES.join(", ")}` },
          { status: 400 },
        );
      }
    }

    const payload: Record<string, unknown> = {
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
    // Callers that know their country send it; the Portfolio tab has no country
    // selector, so it omits the key entirely and the backend default applies.
    if (countryValue) payload.country = countryValue;

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
    return backendErrorResponse(err, "Portfolio comparison failed");
  }
}
