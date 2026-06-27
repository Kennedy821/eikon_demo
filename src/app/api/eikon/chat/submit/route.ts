import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/chat/submit
 *   { message, modelCotHistory[], conversationHistory[], apiKey }  -> { jobId }
 *
 * Mirrors send_chat_message() submit step:
 *   POST ngrok /eikon_ai_chat_queue {
 *     model_cot_history:  last 10 joined by "\n -",
 *     conversation_history: last 10 + "USER: <message>" joined by "\n\n ",
 *     api_key, model_backend:"doubleword" }  -> { job_id }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      message?: string;
      modelCotHistory?: string[];
      conversationHistory?: string[];
      apiKey?: string;
    };
    const { message, modelCotHistory = [], conversationHistory = [], apiKey } = body;
    if (!message || !apiKey) {
      return NextResponse.json({ error: "message and apiKey required" }, { status: 400 });
    }

    const cleanedUserMessage = `USER: ${message}`;
    const payload = {
      model_cot_history: modelCotHistory.slice(-10).join("\n -"),
      conversation_history: [...conversationHistory.slice(-10), cleanedUserMessage].join("\n\n "),
      api_key: apiKey,
      model_backend: "doubleword",
    };

    const data = await callBackend<{ job_id?: string }>("chatSubmit", {
      json: payload,
      timeoutMs: 120_000,
    });
    if (!data?.job_id) {
      return NextResponse.json({ error: "No job_id returned" }, { status: 502 });
    }
    return NextResponse.json({ jobId: data.job_id });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat submit failed" },
      { status },
    );
  }
}
