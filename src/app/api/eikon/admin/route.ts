import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/eikon/admin  { email }  ->  { isAdmin }
 *
 * The allow-list lives in EIKON_ADMIN_EMAILS (server-only, comma separated) so
 * it never reaches the browser bundle.
 *
 * This gates which tabs are *shown*. It is not a security boundary: the email
 * comes from the client's stored session, so treat it as UI tailoring rather
 * than authorisation. Anything genuinely sensitive must be checked server-side
 * against the API key.
 */
export async function POST(req: NextRequest) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  const allowed = (process.env.EIKON_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const isAdmin = !!email && allowed.includes(email.trim().toLowerCase());
  return NextResponse.json({ isAdmin });
}
