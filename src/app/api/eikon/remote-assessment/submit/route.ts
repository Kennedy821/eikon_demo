import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { BACKEND, BackendError } from "@/lib/server/backend";
import {
  jobCache,
  pruneJobCache,
  parseVerificationResult,
  fireBlockingPost,
} from "@/lib/server/remoteAssessmentJobs";

/**
 * POST /api/eikon/remote-assessment/submit
 *   { apiKey, inspection, executionMode, area? | geodataframe? }  ->  { jobId }
 *
 * Mirrors eikonsai.jobs.get_location_verification's submit step. The upstream
 * POST blocks until the job completes, so we fire it without awaiting and
 * return the job_id straight away; the status route then polls the
 * completion endpoint (and checks the cached outcome of this POST).
 *
 *   aoi_type "standard": { api_key, aoi_type, inspection_list, area_list, job_id }
 *   aoi_type "custom":   { api_key, aoi_type, geodataframe, crs, inspection_list,
 *                          job_id, unique_id }
 * inspection_list is a single object class (e.g. "solar_panels") or "all".
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      apiKey?: string;
      inspection?: string;
      executionMode?: "fast" | "standard";
      area?: string | null;
      geodataframe?: unknown;
    };
    const { apiKey, inspection, executionMode = "fast", area, geodataframe } = body;

    if (!apiKey || !inspection) {
      return NextResponse.json({ error: "apiKey and inspection are required" }, { status: 400 });
    }
    if (!area && !geodataframe) {
      return NextResponse.json(
        { error: "Either an area name or a drawn polygon (geodataframe) is required" },
        { status: 400 },
      );
    }

    const jobId = `job_${randomBytes(6).toString("hex")}`;

    const payload: Record<string, unknown> = geodataframe
      ? {
          api_key: apiKey,
          aoi_type: "custom",
          geodataframe,
          crs: "EPSG:4326",
          inspection_list: inspection,
          job_id: jobId,
          unique_id: "unique_id",
        }
      : {
          api_key: apiKey,
          aoi_type: "standard",
          inspection_list: inspection,
          area_list: area,
          job_id: jobId,
        };

    pruneJobCache();
    const cache = jobCache();
    cache.set(jobId, { startedAt: Date.now() });

    const endpoint =
      executionMode === "standard" ? BACKEND.remoteVerificationStandard : BACKEND.remoteVerificationFast;

    // Fire-and-forget: the upstream call blocks for the life of the job, so it
    // goes through a raw http request with no response-headers timeout.
    void fireBlockingPost(endpoint.base, endpoint.path, payload)
      .then(({ status, body }) => {
        const entry = cache.get(jobId) ?? { startedAt: Date.now() };
        if (status >= 200 && status < 300) {
          const data = body as { eikon_remote_location_verification_result?: unknown } | null;
          entry.rows = parseVerificationResult(data?.eikon_remote_location_verification_result);
        } else {
          // A 4xx means the backend rejected the request outright — the poll
          // will never complete. A 5xx/gateway drop can still be rescued by
          // the completion endpoint (the job keeps running server-side).
          const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
          entry.error = {
            message: `Backend returned ${status}: ${text.slice(0, 200)}`,
            fatal: status >= 400 && status < 500,
          };
        }
        cache.set(jobId, entry);
      })
      .catch((err: unknown) => {
        const entry = cache.get(jobId) ?? { startedAt: Date.now() };
        entry.error = {
          message: err instanceof Error ? err.message : "Assessment request failed",
          fatal: false,
        };
        cache.set(jobId, entry);
      });

    return NextResponse.json({ jobId });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Assessment submit failed" },
      { status },
    );
  }
}
