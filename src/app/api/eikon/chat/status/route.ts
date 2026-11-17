import { NextRequest, NextResponse } from "next/server";
import { callBackend } from "@/lib/server/backend";
import {
  backendErrorResponse,
  safeUpstreamMessage,
  CHAT_FAILED_MESSAGE,
} from "@/lib/server/safeError";

/**
 * GET /api/eikon/chat/status?jobId=...  ->
 *   { status, result?, error? }
 *
 * Mirrors send_chat_message() poll step:
 *   GET ngrok /eikon_ai_chat_queue_status?job_id=...
 *   completed -> { status:"completed", result:{ in_conversation_information,
 *                  model_response, map_bytes? } }
 *   failed    -> { status:"failed", error }
 */
export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId required" }, { status: 400 });
    }
    const data = await callBackend<{
      status?: string;
      result?: { error?: string; model_response?: string } & Record<string, unknown>;
      error?: string;
    }>("chatStatus", { query: { job_id: jobId }, timeoutMs: 200_000 });

    // A job can come back "completed" carrying an error instead of an answer —
    // an inference backend that was unreachable, say. Reported as completed it
    // would render as an empty reply from EIKON, and the result object would
    // carry the upstream text to the browser, so it is turned into a failure
    // here and the result is dropped rather than forwarded.
    if (data?.result?.error) {
      return NextResponse.json({
        status: "failed",
        error: safeUpstreamMessage(data.result.error, CHAT_FAILED_MESSAGE),
      });
    }

    if (data?.error) {
      return NextResponse.json({
        status: data.status === "completed" ? "failed" : (data.status ?? "pending"),
        error: safeUpstreamMessage(data.error, CHAT_FAILED_MESSAGE),
      });
    }

    return NextResponse.json({
      status: data?.status ?? "pending",
      result: data?.result,
    });
  } catch (err) {
    return backendErrorResponse(err, CHAT_FAILED_MESSAGE);
  }
}
