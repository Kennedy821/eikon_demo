import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";
import {
  getAiModelThoughts,
  getStage1Info,
  getRelevantLocationCount,
} from "@/lib/server/searchFiles";

/**
 * POST /api/eikon/search/progress  { apiKey }  ->
 *   { latestCkpt, jobComplete, thoughtsCount, latestEvaluation,
 *     candidateCount, stage1 }
 *
 * Combines the HTTP checkpoint (check_job_complete -> latest_ckpt/job_complete)
 * with the server-local progress files the backend writes (AI model thoughts,
 * Stage-1 prompt info, candidate location count) — the same files the Streamlit
 * app reads, now read server-side. See src/lib/server/searchFiles.ts.
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

    // Local progress-file enrichments (no-ops if files aren't present).
    const thoughts = getAiModelThoughts(apiKey);
    const candidateCount = getRelevantLocationCount(apiKey);
    const stage1 = getStage1Info(apiKey);

    return NextResponse.json({
      latestCkpt: data?.latest_ckpt ?? "",
      jobComplete: !!data?.job_complete,
      thoughtsCount: thoughts.count,
      latestEvaluation: thoughts.latestEvaluation,
      candidateCount,
      stage1,
    });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Progress check failed" },
      { status },
    );
  }
}
