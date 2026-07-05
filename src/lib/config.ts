/**
 * EIKON backend endpoint inventory.
 * Mirrors EIKON_API_ENDPOINTS / f-string routes in eikon_demo_app_beta.py.
 * See EIKON_FRONTEND_MIGRATION_PLAN.md §3.
 */

export const EIKON_API_BASE_URL =
  process.env.NEXT_PUBLIC_EIKON_API_BASE_URL ?? "https://slugai.eikon.ngrok.app";

export const ENDPOINTS = {
  checkCredits: "/check_eikon_api_credits",
  searchQueue: "/eikon_search_agent_api_queue",
  searchSubmit: "/eikon_search_agent_api_uk_submit",
  searchStatus: "/eikon_search_agent_api_uk_status",
  checkJobComplete: "/check_if_eikon_search_agent_api_job_complete_web",
  chatReasoningTraces: "/eikon_ai_chat_reasoning_traces",
  objectsDetected: "/get_objects_detected_in_location",
  yoloDetection: "/yolo_object_detection_on_image",
  tts: "/eikon_tts",
  workerAwake: "/eikon_search_worker_awake",
  corridorAssessment: "/run_assessment_custom_polygon_cuda",
  safestRoute: "/eikon_safest_route_pathfinder",
  // ⚠️ Auth currently goes through the Python SDK
  // (eikon.utils.get_api_key_from_credentials). Confirm the raw HTTP route
  // and fill this in. See migration plan §3 / §10 action item 1.
  // auth: "/<TBD>",
} as const;

export type EndpointKey = keyof typeof ENDPOINTS;

/** Poll intervals (ms) — replaces Streamlit's time.sleep + st.rerun loops. */
export const POLL = {
  // 5s: fast enough to catch completion promptly, not so aggressive it
  // hammers the backend during a 10-minute moderate/exhaustive run.
  searchStatus: 5000,
  searchProgress: 10_000,
  chatTraces: 1500,
  corridorAssessment: 3000,
} as const;

/** Cache staleness windows (ms) for TanStack Query. */
export const STALE = {
  credits: 60_000, // replaces manual _credit_balance_cache 60s guard
} as const;
