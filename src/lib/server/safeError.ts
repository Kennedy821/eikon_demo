import { NextResponse } from "next/server";
import { BackendError } from "./backend";

/**
 * Keep backend failure detail on the server.
 *
 * The route handlers used to hand the upstream message straight to the browser,
 * which put things like
 *
 *   Inference unavailable (Doubleword and Mistral both failed):
 *   Expecting value: line 1 column 1 (char 0)
 *
 * in front of a user. That names the inference vendors, says one of them
 * returned something that was not JSON, and tells the reader nothing they can
 * act on. Upstream text is written for whoever operates the backend, so it is
 * logged rather than forwarded, and the browser gets a sentence chosen here.
 *
 * This is server-only, like the rest of lib/server, and must not be imported
 * into a Client Component.
 */

/** Log the real failure where operators can see it, and nowhere else. */
function logDetail(context: string, detail: unknown) {
  console.error(`[eikon] ${context}:`, detail);
}

/**
 * The response a route sends when a call fails.
 *
 * `fallback` is the whole of what the user will read, so write it as a
 * sentence addressed to them rather than as a log line. The upstream status is
 * preserved, since the client distinguishes a 404 from a 500 and the code
 * leaks nothing by itself.
 */
export function backendErrorResponse(err: unknown, fallback: string) {
  logDetail(fallback, err);
  return NextResponse.json(
    { error: fallback },
    { status: err instanceof BackendError ? err.status : 500 },
  );
}

/**
 * A safe stand-in for an error string the backend put in a 200 response.
 *
 * Some endpoints report failure in the body rather than the status code, so
 * the text arrives as data rather than as a thrown error and would otherwise
 * be passed along untouched.
 */
export function safeUpstreamMessage(detail: unknown, fallback: string): string {
  logDetail(fallback, detail);
  return fallback;
}

/** What a user is told when a chat job comes back unusable. */
export const CHAT_FAILED_MESSAGE =
  "EIKON could not answer that just now. Please try again.";

/** What a user is told when an assessment cannot be started or read back. */
export const ASSESSMENT_FAILED_MESSAGE =
  "The assessment could not be started. Please try running it again.";
