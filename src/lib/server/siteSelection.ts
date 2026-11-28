/**
 * SERVER-ONLY: the site selection call.
 *
 * One POST to /eikon_site_selection with both criteria lists and their
 * weightings; the backend scores the desired criteria against the undesired
 * ones and answers with the net-desired table already combined. There is no
 * second call and no combining to do here — an earlier design had the two
 * halves fetched separately and netted off in this layer, which the endpoint
 * now does itself.
 *
 * Required by the endpoint, in the order it validates them: `api_key`,
 * `desired_criteria`, `undesired_criteria`, `h3_cells`. Both criteria lists
 * must be non-empty — an empty `undesired_criteria` is rejected, so "no
 * undesired criteria" is not a state the endpoint accepts.
 *
 * Cells are the only way in: probed 2026-11-27, the endpoint requires
 * `h3_cells` unconditionally and ignores an area name or a scope. A named
 * scope is therefore resolved to cells by /get_h3_cells_for_area before this
 * is called — see areaCells.
 *
 * The weightings are optional. Each is a parallel list of shares between 0
 * and 1, one per criterion, totalling no more than 1. Where the user set no
 * weights the field is left out of the payload altogether rather than sent as
 * a list of equal shares: the backend has its own default, and inventing one
 * here would quietly override it.
 *
 * Catchment mode is the same arrangement: `catchment_mode` and the two kring
 * lists go together or not at all. Sent, they ask the backend to score a cell
 * on what lies within so many H3 rings of it rather than on what it contains;
 * left out, the run is the plain one it has always been.
 */
import { callBackend } from "@/lib/server/backend";

/** Same budget as the corridor assessment: a large AOI is a long job. */
const SITE_SELECTION_TIMEOUT_MS = 1_200_000;

/**
 * Response fields that have carried a table in an EIKON response, best first.
 * The table arrives JSON-encoded inside one of them, as `assessment_result`
 * does on the assessment endpoint.
 */
const RESULT_KEYS = [
  "net_desired_result",
  "net_desired",
  "site_selection_result",
  "eikon_site_selection_result",
  "assessment_result",
  "result",
  "data",
];

export async function fetchSiteSelection(input: {
  apiKey: string;
  desiredCriteria: string[];
  undesiredCriteria: string[];
  /** However the scope was given, it is cells by the time it reaches here. */
  h3Cells?: string[];
  /** Omitted from the payload when absent. */
  desiredWeighting?: number[];
  undesiredWeighting?: number[];
  /**
   * Catchment radii in H3 rings, one per criterion. Both lists are present
   * together or both absent — a catchment run with only half its radii would
   * score one list against a distance and the other against nothing.
   */
  desiredKrings?: number[];
  undesiredKrings?: number[];
}): Promise<Record<string, unknown>[]> {
  // The flag is what switches the backend's behaviour, so it is derived from
  // the radii rather than passed in beside them: there is no way to ask for
  // catchment mode here and forget to send the distances it needs.
  const catchment = !!input.desiredKrings && !!input.undesiredKrings;
  const data = await callBackend<unknown>("siteSelection", {
    json: {
      api_key: input.apiKey,
      desired_criteria: input.desiredCriteria,
      undesired_criteria: input.undesiredCriteria,
      ...(input.h3Cells?.length ? { h3_cells: input.h3Cells } : {}),
      ...(input.desiredWeighting ? { desired_criteria_weighting: input.desiredWeighting } : {}),
      ...(input.undesiredWeighting
        ? { undesired_criteria_weighting: input.undesiredWeighting }
        : {}),
      ...(catchment
        ? {
            catchment_mode: 1,
            desired_criteria_krings: input.desiredKrings,
            undesired_criteria_krings: input.undesiredKrings,
          }
        : {}),
    },
    timeoutMs: SITE_SELECTION_TIMEOUT_MS,
  });

  return rowsFrom(data);
}

/**
 * Rows out of whatever shape the response arrived in.
 *
 * The known field names are tried first, then any remaining field that parses
 * into a table, because the field a new endpoint puts its table in is not
 * something to hard-code on one reading. A table is accepted either as a list
 * of records or as the column-oriented dict `pd.DataFrame.to_json` produces,
 * which is what the sibling assessment endpoint sends.
 */
export function rowsFrom(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];

  const body = payload as Record<string, unknown>;
  const ordered = [
    ...RESULT_KEYS.filter((k) => k in body),
    ...Object.keys(body).filter((k) => !RESULT_KEYS.includes(k)),
  ];

  for (const key of ordered) {
    const rows = asTable(body[key]);
    if (rows.length > 0) return rows;
  }
  return [];
}

function asTable(value: unknown): Record<string, unknown>[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed)) {
    return parsed.every((r) => r && typeof r === "object")
      ? (parsed as Record<string, unknown>[])
      : [];
  }
  if (parsed && typeof parsed === "object") return columnsToRows(parsed as Record<string, unknown>);
  return [];
}

/**
 * Column-oriented dict to rows. The row keys are the DataFrame's index, so
 * they are taken from the first column and applied across all of them.
 */
function columnsToRows(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const cols = Object.keys(parsed);
  if (cols.length === 0) return [];
  const first = parsed[cols[0]];
  if (!first || typeof first !== "object" || Array.isArray(first)) return [];

  const index = Object.keys(first as Record<string, unknown>);
  return index.map((i) => {
    const row: Record<string, unknown> = {};
    for (const c of cols) {
      const column = parsed[c];
      row[c] =
        column && typeof column === "object"
          ? (column as Record<string, unknown>)[i]
          : undefined;
    }
    return row;
  });
}
