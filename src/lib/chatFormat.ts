/**
 * Chat response parsing + trace formatting.
 * Ported from extract_chat_response / format_trace_for_display in
 * eikon_demo_app_beta.py so the migrated chat renders identically.
 */

/** Raw reasoning trace as returned by /eikon_ai_chat_reasoning_traces. */
export interface RawTrace {
  type?: string;
  summary?: string;
  content?: string;
}

const TRACE_TYPE_LABELS: Record<string, string> = {
  thinking: "Reasoning",
  tool_result: "Tool results received",
  similarity: "Comparing locations",
  comparison: "Running comparison",
  area_comparison: "Comparing areas",
  vision: "Analysing aerial imagery",
  object_detection: "Detecting objects",
  location_summary: "Summarising location",
  surroundings: "Analysing surroundings",
  screening: "Screening locations",
  search: "Searching locations",
  prev_search: "Reviewing previous search",
  inner_voice: "Reflecting",
  map_error: "Map generation issue",
  complete: "Ready to respond",
  init: "Loading context",
};

/** Extract the clean response from the model's XML-tagged output. */
export function extractChatResponse(modelResponse: string): string {
  if (!modelResponse) return "";
  let text = modelResponse;

  const output = /<output>([\s\S]*?)<\/output>/.exec(text);
  if (output) text = output[1];

  const response = /<response>([\s\S]*?)<\/response>/.exec(text);
  if (response) text = response[1];

  text = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  text = text.replace(/<tool>[\s\S]*?<\/tool>/g, "");
  text = text.replace(/<map>[\s\S]*?<\/map>/g, "");

  // Remove known standalone tags then any leftover lowercase tags (catch-all).
  text = text.replace(
    /<\/?(output|response|think|tool|map|topic|area|similarity|vision|sat_img|yolo|inputs|map_type|portfolio_comparison|area_comparison|dist_check|loc_context|area_filter)>/g,
    "",
  );
  text = text.replace(/<\/?[a-z_]+>/g, "");

  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

/** Strip large base64 blobs from text kept in conversation history. */
export function stripBase64FromText(text: string): string {
  return text
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{200,}/g, "[image]")
    .replace(/(?<![A-Za-z0-9+/=])[A-Za-z0-9+/=]{200,}(?![A-Za-z0-9+/=])/g, "[image]");
}

/**
 * Trace types that must never be surfaced to the user. `inner_voice`
 * ("Reflecting") is the model's private self-talk and is intentionally hidden.
 */
const HIDDEN_TRACE_TYPES = new Set(["inner_voice"]);

export function isHiddenTrace(trace: RawTrace): boolean {
  return HIDDEN_TRACE_TYPES.has(trace.type ?? "");
}

export interface TraceStep {
  /** Friendly type label, e.g. "Reasoning", "Geocoding location". */
  label: string;
  /** Concise summarised text for the step (LLM summary, or trimmed content). */
  text: string;
}

/**
 * Turn a raw reasoning trace into a tidy timeline step — ports
 * format_trace_for_display. The type maps to a friendly label (so "thinking"
 * reads as "Reasoning"), and we show the LLM `summary` when present, falling
 * back to a trimmed slice of the raw content — never the full chain-of-thought.
 */
export function traceStep(trace: RawTrace): TraceStep {
  const label = TRACE_TYPE_LABELS[trace.type ?? ""] ?? trace.type ?? "Working";
  const summary = trace.summary?.trim();
  const text = summary && summary.length > 0 ? summary : (trace.content ?? "").trim().slice(0, 160);
  return { label, text };
}
