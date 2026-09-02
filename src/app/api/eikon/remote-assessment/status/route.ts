import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";
import {
  jobCache,
  parseVerificationResult,
  parseProgress,
  type BackendProgressBlock,
} from "@/lib/server/remoteAssessmentJobs";
import type { RemoteAssessmentStatus } from "@/lib/types";

/**
 * POST /api/eikon/remote-assessment/status  { apiKey, jobId }
 *   -> { status: "running" | "completed" | "failed", progress, detail,
 *        latestCkpt, cells?, error?, note? }
 *
 * Mirrors the SDK's poll loop: the blocking submit POST (cached server-side)
 * and /check_if_eikon_remote_location_verification_job_complete can each
 * deliver the result — whichever lands first wins.
 */

// If the trigger call failed and the backend still hasn't written a first
// checkpoint after this long, the job never started.
const START_GRACE_MS = 3 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const { apiKey, jobId } = (await req.json()) as { apiKey?: string; jobId?: string };
    if (!apiKey || !jobId) {
      return NextResponse.json({ error: "apiKey and jobId are required" }, { status: 400 });
    }

    const cached = jobCache().get(jobId);

    if (cached?.rows) {
      const body: RemoteAssessmentStatus = {
        status: "completed",
        progress: 100,
        latestCkpt: "",
        cells: cached.rows,
      };
      return NextResponse.json(body);
    }
    if (cached?.error?.fatal) {
      const body: RemoteAssessmentStatus = {
        status: "failed",
        progress: 0,
        latestCkpt: "",
        error: cached.error.message,
      };
      return NextResponse.json(body);
    }

    const data = await callBackend<{
      job_complete?: boolean;
      latest_ckpt?: unknown;
      progress?: BackendProgressBlock | null;
      eikon_remote_location_verification_result?: unknown;
    }>("remoteVerificationStatus", {
      json: { api_key: apiKey, job_id: jobId },
      // The SDK gives each poll 60s; the backend can be slow to answer while
      // it is busy processing tiles.
      timeoutMs: 60_000,
    });

    if (data?.job_complete) {
      const cells = parseVerificationResult(data.eikon_remote_location_verification_result);
      const body: RemoteAssessmentStatus = {
        status: "completed",
        progress: 100,
        latestCkpt: String(data.latest_ckpt ?? ""),
        cells,
      };
      return NextResponse.json(body);
    }

    const { progress, detail } = parseProgress(data?.progress, data?.latest_ckpt);
    const hasCheckpoint = progress !== null || !!detail;

    // Trigger call failed and nothing ever started → give up rather than
    // polling forever.
    if (
      cached?.error &&
      !hasCheckpoint &&
      Date.now() - cached.startedAt > START_GRACE_MS
    ) {
      const body: RemoteAssessmentStatus = {
        status: "failed",
        progress: 0,
        latestCkpt: String(data?.latest_ckpt ?? ""),
        error: `The assessment could not be started: ${cached.error.message}`,
      };
      return NextResponse.json(body);
    }

    const body: RemoteAssessmentStatus = {
      status: "running",
      progress,
      detail,
      latestCkpt: String(data?.latest_ckpt ?? ""),
    };
    return NextResponse.json(body);
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Assessment status check failed" },
      { status },
    );
  }
}
