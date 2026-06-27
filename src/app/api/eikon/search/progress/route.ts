import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/search/progress  { apiKey }
 *   -> { latestCkpt, jobComplete }
 *
 * Mirrors crawl_uk's polling pattern: POST /check_if_eikon_search_agent_api_job_complete_web
 * and surface what the backend returns — no local file reads.
 */
export async function POST(req: NextRequest) {
  try {
    const { apiKey } = (await req.json()) as { apiKey?: string };
    if (!apiKey) {
      return NextResponse.json({ error: "apiKey required" }, { status: 400 });
    }

    const data = await callBackend<{ latest_ckpt?: string; job_complete?: boolean }>(
      "checkJobComplete",
      { json: { api_key: apiKey }, timeoutMs: 8_000 },
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
