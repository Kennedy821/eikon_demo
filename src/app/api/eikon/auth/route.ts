import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/auth  { email, password }  ->  { apiKey }
 * Mirrors eikonsai.utils.get_api_key_from_credentials
 * (POST pagekite /eikon_get_api_key_for_user { email_address, password }).
 */
export async function POST(req: NextRequest) {
  try {
    const { email, password } = (await req.json()) as {
      email?: string;
      password?: string;
    };
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const data = await callBackend<{ api_key?: string }>("auth", {
      json: { email_address: email, password: String(password) },
    });

    if (!data?.api_key) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    return NextResponse.json({ apiKey: data.api_key, email });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Auth failed";
    return NextResponse.json({ error: message }, { status });
  }
}
