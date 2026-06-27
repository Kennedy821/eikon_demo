import { NextRequest, NextResponse } from "next/server";
import { backendFetch, BackendError, NGROK_BASE } from "@/lib/server/backend";

/**
 * Memory endpoints (dynamic paths embed the api_key), from render_memory_tab:
 *   GET    /api/eikon/memory?apiKey=...        -> ngrok GET    /memory/{apiKey}
 *   POST   /api/eikon/memory   { apiKey, action:"reflect" }
 *                                              -> ngrok POST   /memory/{apiKey}/reflect
 *   DELETE /api/eikon/memory   { apiKey, snippetId }
 *                                              -> ngrok DELETE /memory/{apiKey}/snippet/{id}
 */

function errResponse(err: unknown, fallback: string) {
  const status = err instanceof BackendError ? err.status : 500;
  return NextResponse.json(
    { error: err instanceof Error ? err.message : fallback },
    { status },
  );
}

export async function GET(req: NextRequest) {
  const apiKey = req.nextUrl.searchParams.get("apiKey");
  if (!apiKey) return NextResponse.json({ error: "apiKey required" }, { status: 400 });
  try {
    const data = await backendFetch<{
      reflection?: { content: string; created_at: string; version: number } | null;
      snippets?: Array<{ id: string; type: string; content: string; created_at: string }>;
      snippet_count_since_reflection?: number;
    }>(NGROK_BASE, `/memory/${apiKey}`, { method: "GET", timeoutMs: 10_000 });
    return NextResponse.json({
      reflection: data?.reflection ?? null,
      snippets: data?.snippets ?? [],
      snippetCountSinceReflection: data?.snippet_count_since_reflection ?? 0,
    });
  } catch (err) {
    return errResponse(err, "Could not load memories");
  }
}

export async function POST(req: NextRequest) {
  const { apiKey } = (await req.json()) as { apiKey?: string };
  if (!apiKey) return NextResponse.json({ error: "apiKey required" }, { status: 400 });
  try {
    const data = await backendFetch<{ reflection?: unknown }>(
      NGROK_BASE,
      `/memory/${apiKey}/reflect`,
      { method: "POST", timeoutMs: 120_000 },
    );
    return NextResponse.json({ reflection: data?.reflection ?? null });
  } catch (err) {
    return errResponse(err, "Reflection failed");
  }
}

export async function DELETE(req: NextRequest) {
  const { apiKey, snippetId } = (await req.json()) as { apiKey?: string; snippetId?: string };
  if (!apiKey || !snippetId) {
    return NextResponse.json({ error: "apiKey and snippetId required" }, { status: 400 });
  }
  try {
    await backendFetch(NGROK_BASE, `/memory/${apiKey}/snippet/${snippetId}`, {
      method: "DELETE",
      timeoutMs: 10_000,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errResponse(err, "Delete failed");
  }
}
