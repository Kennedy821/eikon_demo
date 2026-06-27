import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

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
      result?: unknown;
      error?: string;
    }>("chatStatus", { query: { job_id: jobId }, timeoutMs: 200_000 });

    return NextResponse.json({
      status: data?.status ?? "pending",
      result: data?.result,
      error: data?.error,
    });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat status failed" },
      { status },
    );
  }
}
