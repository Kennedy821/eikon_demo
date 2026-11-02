import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/register
 *   { firstName, lastName, email, password, accountType }  ->  { email }
 *
 * Ports eikon_registration_form.py from the Streamlit datastore app. Two
 * upstream calls, in the same order the form made them:
 *   1. /check_user_email_eikon_user  { user_email } -> { verification_flag }
 *      verification_flag === 1 means the email already has an account.
 *   2. /add_new_eikon_user  { user_id, first_name, last_name, email_address,
 *      password, account_type, registration_date } -> { updated_user_data }
 *
 * The backend mints the api_key and seeds a £5 credit balance, so there is
 * nothing to return but the email — the new user signs in through /login.
 */

const ACCOUNT_TYPES = ["student", "commercial"] as const;

/** dd-mm-yyyy, matching the Streamlit form's strftime("%d-%m-%Y"). */
function registrationDate(now = new Date()) {
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${now.getFullYear()}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      firstName?: string;
      lastName?: string;
      email?: string;
      password?: string;
      accountType?: string;
    };

    const firstName = body.firstName?.trim() ?? "";
    const lastName = body.lastName?.trim() ?? "";
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";
    const accountType = body.accountType?.trim() ?? "";

    if (!firstName || !lastName || !email || !password || !accountType) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "That email address isn't valid" }, { status: 400 });
    }
    if (!(ACCOUNT_TYPES as readonly string[]).includes(accountType)) {
      return NextResponse.json({ error: "Unknown account type" }, { status: 400 });
    }

    const check = await callBackend<{ verification_flag?: number }>("checkUserEmail", {
      json: { user_email: email },
      timeoutMs: 60_000,
    });
    if (check?.verification_flag === 1) {
      return NextResponse.json(
        { error: "This email address already has an account" },
        { status: 409 },
      );
    }

    const result = await callBackend<{ updated_user_data?: number | boolean }>("addNewUser", {
      json: {
        user_id: `eikon_user_${crypto.randomUUID()}`,
        first_name: firstName,
        last_name: lastName,
        email_address: email,
        password: String(password),
        account_type: accountType,
        registration_date: registrationDate(),
      },
      timeoutMs: 120_000,
    });

    // The backend answers 1 (not true) on success; anything else is a failure
    // it didn't report as an error status.
    if (!result?.updated_user_data) {
      return NextResponse.json(
        { error: "It was not possible to register your account" },
        { status: 502 },
      );
    }

    return NextResponse.json({ email });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Registration failed";
    return NextResponse.json({ error: message }, { status });
  }
}
