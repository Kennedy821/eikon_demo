/**
 * SERVER-ONLY backend bridge for the EIKON APIs.
 *
 * The Streamlit app talked to two different backends:
 *   - NGROK    (https://slugai.eikon.ngrok.app) — app-level endpoints
 *     (credits, search submit/status, object detection, chat queue, TTS).
 *   - PAGEKITE (https://slugai.pagekite.me)      — the eikonsai SDK endpoints
 *     (auth, location description/image, similarity).
 *
 * Endpoint names + payload shapes below are taken verbatim from
 * eikon_demo_app_beta.py and the installed `eikonsai` package source, so the
 * migrated client is byte-for-byte compatible with the live backend.
 *
 * This module must never be imported into a Client Component — it is used only
 * by route handlers under src/app/api/eikon/*. That keeps the api_key and the
 * upstream URLs off the browser and sidesteps CORS entirely.
 */

// NOTE: only import this from route handlers (src/app/api/**), which always run
// on the server. Never import it into a Client Component.

export const NGROK_BASE =
  process.env.EIKON_NGROK_BASE_URL ?? "https://slugai.eikon.ngrok.app";
export const PAGEKITE_BASE =
  process.env.EIKON_PAGEKITE_BASE_URL ?? "https://slugai.pagekite.me";
export const GILGAMESH_BASE =
  process.env.EIKON_GILGAMESH_BASE_URL ?? "https://slugai.gilgamesh.ngrok.app";

export interface BackendCall {
  base: string;
  path: string;
  method?: "GET" | "POST";
}

/** Endpoint registry — single source of truth for upstream routes. */
export const BACKEND = {
  // ---- auth (pagekite, via eikonsai.utils.get_api_key_from_credentials) ----
  auth: { base: NGROK_BASE, path: "/eikon_get_api_key_for_user", method: "POST" },

  // ---- credits (ngrok) ----
  credits: { base: NGROK_BASE, path: "/check_eikon_api_credits", method: "POST" },

  // ---- search (ngrok, submit + poll) ----
  searchSubmit: { base: NGROK_BASE, path: "/eikon_search_agent_api_uk_submit", method: "POST" },
  searchStatus: { base: NGROK_BASE, path: "/eikon_search_agent_api_uk_status", method: "GET" },
  checkJobComplete: {
    base: NGROK_BASE,
    path: "/check_if_eikon_search_agent_api_job_complete_web",
    method: "POST",
  },

  // ---- context (pagekite, via eikonsai.context) ----
  locationDescription: { base: NGROK_BASE, path: "/get_location_description", method: "POST" },
  locationImage: { base: NGROK_BASE, path: "/get_location_image", method: "POST" },

  // ---- similarity (pagekite, via eikonsai.similarity) ----
  visualSimilarity: { base: NGROK_BASE, path: "/get_similarity_image", method: "POST" },
  descriptiveSimilarity: { base: NGROK_BASE, path: "/get_similarity_descriptive", method: "POST" },
  combinedSimilarity: { base: NGROK_BASE, path: "/get_combined_location_similarity", method: "POST" },

  // ---- object detection (ngrok) ----
  objectsDetected: { base: NGROK_BASE, path: "/get_objects_detected_in_location", method: "POST" },
  yoloDetection: { base: NGROK_BASE, path: "/yolo_object_detection_on_image", method: "POST" },

  // ---- chat (ngrok, queue + poll + reasoning traces) ----
  chatSubmit: { base: NGROK_BASE, path: "/eikon_ai_chat_queue", method: "POST" },
  chatStatus: { base: NGROK_BASE, path: "/eikon_ai_chat_queue_status", method: "GET" },
  chatTraces: { base: NGROK_BASE, path: "/eikon_ai_chat_reasoning_traces", method: "POST" },

  // ---- portfolio (ngrok, via eikonsai.jobs.eikon_portfolio_comparison) ----
  portfolio: { base: NGROK_BASE, path: "/eikon_portfolio_comparison", method: "POST" },

  // ---- history (ngrok, via eikonsai.utils.get_previous_search_api_results) ----
  previousSearches: {
    base: NGROK_BASE,
    path: "/get_latest_results_for_eikon_search_agent_api_job_web_many",
    method: "POST",
  },

  // ---- drone corridor (ngrok) ----
  workerAwake: { base: NGROK_BASE, path: "/eikon_search_worker_awake", method: "POST" },
  corridorAssessment: {
    base: NGROK_BASE,
    path: "/run_assessment_custom_polygon_cuda",
    method: "POST",
  },
  safestRoute: { base: NGROK_BASE, path: "/eikon_safest_route_pathfinder", method: "POST" },

  // ---- voice ----
  tts: { base: NGROK_BASE, path: "/eikon_tts", method: "POST" },
  kokoroTts: { base: GILGAMESH_BASE, path: "/kokoro_tts", method: "POST" },
} as const satisfies Record<string, BackendCall>;

export type BackendKey = keyof typeof BACKEND;

export class BackendError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BackendError";
    this.status = status;
  }
}

interface CallOptions {
  /** JSON body for POST. */
  json?: Record<string, unknown>;
  /** Query params for GET. */
  query?: Record<string, string | number | undefined>;
  /** Per-call timeout (ms). Matches the generous timeouts in the Python app. */
  timeoutMs?: number;
}

interface FetchOptions extends CallOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
}

/**
 * Low-level upstream fetch. Use this directly when the path is dynamic
 * (e.g. the memory endpoints embed the api_key: /memory/{api_key}).
 */
export async function backendFetch<T = unknown>(
  base: string,
  path: string,
  opts: FetchOptions = {},
): Promise<T> {
  const { json, query, timeoutMs = 120_000, method = json ? "POST" : "GET" } = opts;

  const url = new URL(path, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  // ngrok's free tier injects a browser-warning interstitial without this.
  if (base === NGROK_BASE) headers["ngrok-skip-browser-warning"] = "true";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: json ? JSON.stringify(json) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new BackendError(res.status, text.slice(0, 300));
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  } catch (err) {
    if (err instanceof BackendError) throw err;
    const message = err instanceof Error ? err.message : "Unknown backend error";
    throw new BackendError(502, message);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call a registered upstream EIKON endpoint and return parsed JSON.
 * Mirrors the requests.get/post calls in the Streamlit app.
 */
export function callBackend<T = unknown>(key: BackendKey, opts: CallOptions = {}): Promise<T> {
  const { base, path, method } = BACKEND[key];
  return backendFetch<T>(base, path, { ...opts, method });
}
