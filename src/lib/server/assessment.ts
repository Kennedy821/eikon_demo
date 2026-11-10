/**
 * SERVER-ONLY: the H3-cell risk assessment shared by the drone corridor and
 * the risk assessment tab.
 *
 * Ports run_corridor_assessment: check the worker is awake
 * (POST /eikon_search_worker_awake), then POST the H3 cells + criteria to
 * /run_assessment_custom_polygon_cuda. A single POST (no retries) — matching
 * the app's deliberate no-retry behaviour.
 */
import { callBackend } from "@/lib/server/backend";

/** Assessments take minutes on a large AOI. */
const ASSESSMENT_TIMEOUT_MS = 1_200_000;

export type WorkerGate = { ok: true } | { ok: false; status: number; error: string };

/** The assessment worker has to be awake before any cells are sent to it. */
export async function workerAwakeCheck(): Promise<WorkerGate> {
  try {
    const awake = await callBackend<{ status?: string }>("workerAwake", {
      json: { check: "placeholder" },
      timeoutMs: 30_000,
    });
    if (awake?.status !== "awake") {
      return {
        ok: false,
        status: 503,
        error: "Eikon assessment server is not available right now. Please try again shortly.",
      };
    }
    return { ok: true };
  } catch (exc) {
    return {
      ok: false,
      status: 502,
      error: `Could not reach Eikon assessment server: ${exc instanceof Error ? exc.message : exc}`,
    };
  }
}

/** Assessed rows, one per H3 cell. */
export async function fetchAssessment(input: {
  apiKey: string;
  criteria: string[];
  h3Cells: string[];
  /** Selects the backend's reference data for that country. */
  country: string;
}): Promise<Record<string, unknown>[]> {
  const data = await callBackend<{ assessment_result?: string }>("corridorAssessment", {
    json: {
      api_key: input.apiKey,
      assessment_criteria: input.criteria,
      h3_cells: input.h3Cells,
      country: input.country,
    },
    timeoutMs: ASSESSMENT_TIMEOUT_MS,
  });

  const assessment = data?.assessment_result ? JSON.parse(data.assessment_result) : [];
  // assessment_result is a column-oriented dict (pd.DataFrame.from_dict); flatten to rows.
  return Array.isArray(assessment) ? assessment : columnsToRows(assessment);
}

function columnsToRows(parsed: Record<string, Record<string, unknown>>): Record<string, unknown>[] {
  const cols = Object.keys(parsed);
  if (cols.length === 0) return [];
  const idx = Object.keys(parsed[cols[0]] ?? {});
  return idx.map((i) => {
    const row: Record<string, unknown> = {};
    for (const c of cols) row[c] = parsed[c]?.[i];
    return row;
  });
}
