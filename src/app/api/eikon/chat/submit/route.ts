import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/chat/submit
 *   { message, modelCotHistory[], conversationHistory[], apiKey, pageContext? }
 *     -> { jobId }
 *
 * Mirrors send_chat_message() submit step:
 *   POST ngrok /eikon_ai_chat_queue {
 *     model_cot_history:  last 10 joined by "\n -",
 *     conversation_history: last 10 + "USER: <message>" joined by "\n\n ",
 *     api_key, model_backend:"doubleword" }  -> { job_id }
 *
 * pageContext is what the tab behind the chat panel is showing. The queue
 * endpoint takes no field of its own for it, so it rides in the conversation
 * history, immediately before the message it belongs to: the model reads that
 * as prose either way, and placing it last keeps it next to the question that
 * refers to it rather than stranded behind ten turns of history.
 *
 * It is deliberately not part of the stored history the client keeps. The
 * client re-attaches the current snapshot on every message, so what the model
 * sees is what the tab holds now — a re-run search replaces its results rather
 * than adding a second, contradictory copy, and the history does not grow by a
 * results table per turn.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      message?: string;
      modelCotHistory?: string[];
      conversationHistory?: string[];
      apiKey?: string;
      pageContext?: string;
    };
    const {
      message,
      modelCotHistory = [],
      conversationHistory = [],
      apiKey,
      pageContext,
    } = body;
    if (!message || !apiKey) {
      return NextResponse.json({ error: "message and apiKey required" }, { status: 400 });
    }

    const cleanedUserMessage = `USER: ${message}`;
    // Fenced so the model can tell the attached results from the user's own
    // words, and so a long table cannot read as something they typed.
    const contextTurn = pageContext?.trim()
      ? [`[EIKON page context]\n${pageContext.trim()}\n[end page context]`]
      : [];
    const payload = {
      model_cot_history: modelCotHistory.slice(-10).join("\n -"),
      conversation_history: [
        ...conversationHistory.slice(-10),
        ...contextTurn,
        cleanedUserMessage,
      ].join("\n\n "),
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
