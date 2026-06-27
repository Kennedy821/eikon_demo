import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/credits  { apiKey }  ->  { balance }
 * Mirrors get_user_credit_balance (POST ngrok /check_eikon_api_credits).
 */
export async function POST(req: NextRequest) {
  try {
    const { apiKey } = (await req.json()) as { apiKey?: string };
    if (!apiKey) {
      return NextResponse.json({ error: "apiKey required" }, { status: 400 });
    }
    const data = await callBackend<{ current_api_credit_balance?: number }>("credits", {
      json: { api_key: apiKey },
      timeoutMs: 10_000,
    });
    return NextResponse.json({ balance: data?.current_api_credit_balance ?? null });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Credit check failed" },
      { status },
    );
  }
}
