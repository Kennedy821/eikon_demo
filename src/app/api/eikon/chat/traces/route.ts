import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/chat/traces  { apiKey, sinceIndex }  ->
 *   { traces[], latest_index, is_complete }
 *
 * Mirrors get_chat_reasoning_traces (POST ngrok /eikon_ai_chat_reasoning_traces
 * { api_key, since_index }). Each trace has { type, summary?, content }.
 */
export async function POST(req: NextRequest) {
  try {
    const { apiKey, sinceIndex = 0 } = (await req.json()) as {
      apiKey?: string;
      sinceIndex?: number;
    };
    if (!apiKey) {
      return NextResponse.json({ error: "apiKey required" }, { status: 400 });
    }
    const data = await callBackend<{
      traces?: unknown[];
      latest_index?: number;
      is_complete?: boolean;
    }>("chatTraces", { json: { api_key: apiKey, since_index: sinceIndex }, timeoutMs: 30_000 });

    return NextResponse.json({
      traces: data?.traces ?? [],
      latest_index: data?.latest_index ?? sinceIndex,
      is_complete: data?.is_complete ?? false,
    });
  } catch {
    // Match the Python fallback: traces are best-effort, never fatal.
    const { sinceIndex = 0 } = await req.clone().json().catch(() => ({ sinceIndex: 0 }));
    return NextResponse.json({ traces: [], latest_index: sinceIndex, is_complete: false });
  }
}
