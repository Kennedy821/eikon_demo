import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/search/progress  { apiKey, jobId? }
 *   -> { latestCkpt, jobComplete }
 *
 * Mirrors crawl_uk's polling pattern: POST /check_if_eikon_search_agent_api_job_complete_web
 * and surface what the backend returns — no local file reads.
 *
 * jobId is optional: when present it is forwarded as job_id so the backend
 * reports progress for that job only (users/{api_key}/search_progress/{job_id}/).
 * When absent, the body is identical to before and the backend falls back to
 * the most-recently-updated job — preserving legacy single-search behaviour.
 */
export async function POST(req: NextRequest) {
  try {
    const { apiKey, jobId } = (await req.json()) as { apiKey?: string; jobId?: string };
    if (!apiKey) {
      return NextResponse.json({ error: "apiKey required" }, { status: 400 });
    }

    const data = await callBackend<{ latest_ckpt?: string; job_complete?: boolean }>(
      "checkJobComplete",
      { json: { api_key: apiKey, ...(jobId ? { job_id: jobId } : {}) }, timeoutMs: 8_000 },
    );

    return NextResponse.json({
      latestCkpt: data?.latest_ckpt ?? "",
      jobComplete: !!data?.job_complete,
    });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Progress check failed" },
      { status },
    );
  }
}
