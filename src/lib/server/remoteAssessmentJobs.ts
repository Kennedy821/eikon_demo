/**
 * SERVER-ONLY helpers for the remote location assessment job lifecycle.
 *
 * The backend contract (eikonsai.jobs.get_location_verification) is:
 *   1. POST /get_eikon_remote_location_verification[_v2] — blocks until the
 *      job finishes (can be many minutes) and returns the result.
 *   2. Meanwhile, POST /check_if_eikon_remote_location_verification_job_complete
 *      reports `latest_ckpt` ("stage_2_processing_034pct_000091_of_000266_locations.txt"),
 *      a structured `progress` block, and, once done, `job_complete: true`
 *      plus the same result.
 *
 * The submit route fires (1) without awaiting it and records the outcome here,
 * keyed by job_id, so the status route can return it even if the poll
 * endpoint lags. The cache lives on globalThis so it survives dev-server
 * module reloads. Only import from route handlers.
 */

import http from "http";
import https from "https";
import { cellToLatLng } from "h3-js";
import { NGROK_BASE } from "@/lib/server/backend";
import type { RemoteAssessmentCell, RemoteAssessmentProgressDetail } from "@/lib/types";

export interface JobOutcome {
  rows?: RemoteAssessmentCell[];
  /** Set when the blocking POST failed. `fatal` means the backend rejected the request. */
  error?: { message: string; fatal: boolean };
  startedAt: number;
}

type Cache = Map<string, JobOutcome>;

const KEY = "__eikon_remote_assessment_jobs__";

export function jobCache(): Cache {
  const g = globalThis as unknown as Record<string, Cache | undefined>;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY] as Cache;
}

/** Drop entries older than 6h so a long-lived dev server doesn't leak. */
export function pruneJobCache(maxAgeMs = 6 * 60 * 60 * 1000) {
  const now = Date.now();
  const cache = jobCache();
  cache.forEach((v, k) => {
    if (now - v.startedAt > maxAgeMs) cache.delete(k);
  });
}

/**
 * Fire the blocking verification POST with NO response timeout.
 *
 * Node's built-in fetch (undici) aborts a request whose response headers
 * haven't arrived within 300s, which is exactly what a multi-minute
 * assessment looks like — the SDK's `requests.post(timeout=7200)` has no
 * such limit. A raw http(s) request lets the connection sit open for the
 * life of the job, mirroring the notebook behaviour.
 */
export function fireBlockingPost(
  base: string,
  path: string,
  payload: Record<string, unknown>,
  maxWaitMs = 7_200_000,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const lib = url.protocol === "https:" ? https : http;
    const data = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(data)),
    };
    if (base === NGROK_BASE) headers["ngrok-skip-browser-warning"] = "true";

    const req = lib.request(
      url,
      { method: "POST", headers, timeout: maxWaitMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: unknown = text;
          try {
            body = JSON.parse(text);
          } catch {
            /* non-JSON body — keep the text */
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Assessment request exceeded ${maxWaitMs / 1000}s`)));
    req.on("error", reject);
    req.write(data);
    req.end();
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

/** Column-oriented dict ({col: {idx: val}} or {col: [val]}) → row records. */
function columnsToRows(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const columns = Object.keys(parsed);
  if (columns.length === 0) return [];
  const first = parsed[columns[0]];
  const indices = Array.isArray(first)
    ? first.map((_, i) => String(i))
    : Object.keys((first as Record<string, unknown>) ?? {});
  return indices.map((idx) => {
    const row: Record<string, unknown> = {};
    for (const col of columns) {
      const colData = parsed[col];
      row[col] = Array.isArray(colData)
        ? colData[Number(idx)]
        : (colData as Record<string, unknown> | undefined)?.[idx];
    }
    return row;
  });
}

/**
 * Parse `eikon_remote_location_verification_result` (a JSON string of a
 * DataFrame dict, or already-parsed JSON) into typed cells. Tolerates the
 * column-oriented dict, a list of records, or an empty payload.
 */
export function parseVerificationResult(raw: unknown): RemoteAssessmentCell[] {
  if (raw === null || raw === undefined || raw === "") return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  let rows: Record<string, unknown>[] = [];
  if (Array.isArray(parsed)) {
    rows = parsed.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
  } else if (typeof parsed === "object" && parsed !== null) {
    rows = columnsToRows(parsed as Record<string, unknown>);
  }

  return rows
    .map((row) => {
      const locationId = String(row.location_id ?? row.h3_index ?? row.locationId ?? "");
      let lat = toNumber(row.lat ?? row.latitude);
      let lon = toNumber(row.lon ?? row.longitude);
      if ((lat === 0 || lon === 0) && locationId) {
        try {
          [lat, lon] = cellToLatLng(locationId);
        } catch {
          /* invalid cell — leave at 0 */
        }
      }
      const coverage = Math.max(0, Math.min(1, toNumber(row.clean_pct_float ?? row.coverage)));
      return {
        locationId,
        objectName: String(row.name ?? row.object ?? "unknown"),
        coverage,
        lat,
        lon,
        cellAreaKm2: toNumber(row.cell_area_km_2),
        objectAreaKm2: toNumber(row.area_of_objects_found_km_2),
        meanModelConfidence: toOptionalNumber(row.mean_model_confidence),
        areaName: row.area_name !== undefined && row.area_name !== null ? String(row.area_name) : undefined,
        raw: row,
      };
    })
    .filter((c) => c.locationId.length > 0);
}

/** Extract the percentage from a checkpoint name such as
 *  "stage_2_processing_034pct_000091_of_000266_locations.txt" — the same
 *  `(\d{1,3})pct` rule the SDK's progress bar uses. */
export function progressFromCheckpoint(ckpt: unknown): number | null {
  const m = /(?<!\d)(\d{1,3})pct(?!\d)/.exec(String(ckpt ?? ""));
  if (!m) return null;
  return Math.max(0, Math.min(100, parseInt(m[1], 10)));
}

/** The poll endpoint's optional structured progress block. */
export interface BackendProgressBlock {
  pct_complete?: unknown;
  locations_done?: unknown;
  locations_total?: unknown;
  locations_remaining?: unknown;
  elapsed_seconds?: unknown;
  estimated_seconds_remaining?: unknown;
  area_in_progress?: unknown;
}

/**
 * Combine the structured `progress` block (preferred — it is what the backend
 * itself reports) with the checkpoint-name fallback the SDK relies on.
 */
export function parseProgress(
  block: BackendProgressBlock | null | undefined,
  latestCkpt: unknown,
): { progress: number | null; detail: RemoteAssessmentProgressDetail | null } {
  const fromCkpt = progressFromCheckpoint(latestCkpt);
  if (!block || typeof block !== "object") return { progress: fromCkpt, detail: null };

  const done = toOptionalNumber(block.locations_done);
  const total = toOptionalNumber(block.locations_total);
  let pct = toOptionalNumber(block.pct_complete);
  if (pct === null && done !== null && total) pct = Math.round((done / total) * 100);
  if (pct !== null) pct = Math.max(0, Math.min(100, Math.round(pct)));

  return {
    progress: pct ?? fromCkpt,
    detail:
      done !== null && total !== null
        ? {
            locationsDone: done,
            locationsTotal: total,
            elapsedSeconds: toOptionalNumber(block.elapsed_seconds),
            etaSeconds: toOptionalNumber(block.estimated_seconds_remaining),
            area: block.area_in_progress ? String(block.area_in_progress) : null,
          }
        : null,
  };
}
