import { NextRequest, NextResponse } from "next/server";
import { cellToLatLng } from "h3-js";
import { callBackend, BackendError } from "@/lib/server/backend";
import type { SearchResult, DetectedObject } from "@/lib/types";

/**
 * GET /api/eikon/search/status?jobId=...  ->
 *   { status: "completed" | "pending", results?: SearchResult[], raw?: ... }
 *
 * Mirrors search_locations() poll step:
 *   GET ngrok /eikon_search_agent_api_uk_status?job_id=...
 *   completed -> result is a JSON string of a column-oriented DataFrame dict.
 *
 * We normalise that into row records and derive lat/lon from H3 location_id
 * when coordinates are missing/zero (replicating the h3_to_geo fallback).
 */

interface StatusResponse {
  status?: string;
  result?: string;
}

/** Convert a column-oriented dict ({col: {idx: val}}) into row records. */
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

function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function toOptionalNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Parse the objects_detected column (JSON string or array) into a tidy list. */
function parseObjects(v: unknown): DetectedObject[] {
  let arr: unknown = v;
  if (typeof v === "string") {
    try {
      arr = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
    .map((o) => ({
      name: String(o.name ?? "unknown"),
      coverage: (o.coverage ?? o.proportion_of_area_that_is_label ?? undefined) as
        | string
        | number
        | undefined,
    }));
}

function normalise(rows: Record<string, unknown>[]): SearchResult[] {
  return rows.map((row) => {
    let lat = toNumber(row.latitude);
    let lon = toNumber(row.longitude);
    const locationId = (row.location_id ?? row.locationId ?? "") as string;

    if ((lat === 0 || lon === 0) && locationId) {
      try {
        const [h3Lat, h3Lon] = cellToLatLng(locationId);
        lat = h3Lat;
        lon = h3Lon;
      } catch {
        /* invalid cell — leave at 0 */
      }
    }

    return {
      locationId,
      lat,
      lon,
      // Relevance comes from `search_results` (falls back to `score`).
      relevance: toOptionalNumber(row.search_results ?? row.score) ?? undefined,
      name: (row.name ?? undefined) as string | undefined,
      description: (row.description ?? row.location_description) as string | undefined,
      aiModelEvaluation: toOptionalNumber(row.ai_model_evaluation),
      aiModelRationale: (row.ai_model_rationale ?? null) as string | null,
      aiEvaluation: toOptionalNumber(row.ai_evaluation),
      aiRationale: (row.ai_rationale ?? null) as string | null,
      objectsDetected: parseObjects(row.objects_detected),
      raw: row,
    };
  });
}

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId required" }, { status: 400 });
    }

    const data = await callBackend<StatusResponse>("searchStatus", {
      query: { job_id: jobId },
      timeoutMs: 30_000,
    });

    if (data?.status !== "completed") {
      return NextResponse.json({ status: data?.status ?? "pending" });
    }

    let rows: Record<string, unknown>[] = [];
    if (data.result) {
      const parsed = JSON.parse(data.result) as Record<string, Record<string, unknown>>;
      rows = columnsToRows(parsed);
    }

    return NextResponse.json({ status: "completed", results: normalise(rows) });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search status failed" },
      { status },
    );
  }
}
