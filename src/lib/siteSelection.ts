/**
 * Site selection: which columns of the net-desired table belong to the user.
 *
 * The backend's /eikon_site_selection answers with the net-desired table —
 * the desired criteria scored against the undesired ones, already combined —
 * and that table carries working columns alongside the ones a user asked for.
 * Only `cum_score`, the three hierarchical predictions and one column per
 * submitted criterion are theirs; the rest are the model's internals and are
 * dropped before the table leaves the route.
 *
 * The naming of a criterion's column is the backend's choice, not ours, and a
 * criterion is free text, so the match is made on a normalised form rather
 * than on an exact string. That keeps a renamed or re-slugified column from
 * silently disappearing out of the map's selector.
 */
import { isValidCell } from "h3-js";

/** Criteria per list. Both lists are required and neither may be empty. */
export const MAX_CRITERIA = 5;

/** The combined score: desired against undesired, per cell. */
export const SCORE_COLUMN = "cum_score";

/**
 * Hierarchical scores, kept because they are the per-resolution breakdown of
 * the same answer rather than model internals.
 */
export const HIERARCHY_COLUMNS = ["pred_h9", "pred_h8", "pred_h7"] as const;

/** Column names that have held the H3 index in an EIKON table. */
const CELL_COLUMN_CANDIDATES = ["h3_index_9", "h3_index", "h3_cell", "h3", "hex_id"];

/**
 * Prefixes a criterion's column may carry. Stripped before matching so
 * `desired_large_warehouses` still resolves to "large warehouses".
 */
const COLUMN_PREFIXES = ["desired_", "undesired_", "net_desired_", "net_", "score_", "criterion_"];

/**
 * How the area of interest is given, in the Search tab's own vocabulary.
 *
 * Search already settled this: a scope is held as a mode and the submitted
 * value is derived from the country, so "UK - all" and "spain - all" come out
 * of one rule rather than a literal per country. The same values are reused
 * here so the two tabs mean the same thing by the same string, and so the
 * backend sees the vocabulary it already handles for search.
 *
 * The two map-shaped scopes resolve to H3 cells in the browser; the two
 * country-shaped ones are resolved by the backend from the area name, exactly
 * as a search by area is.
 */
export const MAP_SCOPE = "Map selection";
export const UPLOAD_SCOPE = "GeoJSON upload";

/** Scopes whose cells are enumerated client-side and sent as `h3_cells`. */
export function isCellScope(scope: string): boolean {
  return scope === MAP_SCOPE || scope === UPLOAD_SCOPE;
}

/** Scopes the backend resolves itself, from the country or the area name. */
export function isNamedScope(scope: string): boolean {
  return scope.endsWith(" - all") || scope.endsWith(" - area");
}

export type SiteRow = Record<string, unknown>;

/** A column the map can be coloured by. */
export interface ScoreColumn {
  key: string;
  /** What the selector calls it — the criterion as typed, where it is one. */
  label: string;
}

/**
 * Lowercase, non-alphanumerics collapsed to single underscores, ends trimmed.
 * "Large warehouses!" and "large_warehouses" both reach "large_warehouses".
 */
export function normaliseColumn(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function stripPrefix(normalised: string): string {
  for (const prefix of COLUMN_PREFIXES) {
    if (normalised.startsWith(prefix) && normalised.length > prefix.length) {
      return normalised.slice(prefix.length);
    }
  }
  return normalised;
}

/**
 * Which column holds the H3 index.
 *
 * By name where the table uses one of the names EIKON tables have used, and
 * otherwise by looking at the values: an H3 index is self-identifying, so a
 * column whose values are valid cells is the cell column whatever it is
 * called. Returns null for a table with neither, which the caller treats as
 * an unusable response rather than guessing a column.
 */
export function detectCellColumn(rows: SiteRow[]): string | null {
  if (rows.length === 0) return null;
  const columns = Object.keys(rows[0]);

  for (const candidate of CELL_COLUMN_CANDIDATES) {
    const hit = columns.find((c) => normaliseColumn(c) === candidate);
    if (hit) return hit;
  }

  // Sampled rather than exhaustive: a column either holds H3 indices or it
  // does not, and a whole-country table is not worth walking to find out.
  const sample = rows.slice(0, 20);
  for (const column of columns) {
    const values = sample.map((r) => r[column]).filter((v) => typeof v === "string");
    if (values.length === 0) continue;
    if (values.every((v) => isValidCell(v as string))) return column;
  }
  return null;
}

/**
 * The column holding one criterion's score, or null when the table has none.
 *
 * Exact match on the normalised form first. Where that misses, a single
 * column containing the criterion counts — a backend that prefixes or suffixes
 * the name still resolves — but only if exactly one does, because two partial
 * matches mean the guess could go either way.
 */
export function criterionColumn(criterion: string, columns: string[]): string | null {
  const target = normaliseColumn(criterion);
  if (!target) return null;

  const exact = columns.find((c) => stripPrefix(normaliseColumn(c)) === target);
  if (exact) return exact;

  const partial = columns.filter((c) => normaliseColumn(c).includes(target));
  return partial.length === 1 ? partial[0] : null;
}

export interface ProjectedTable {
  rows: SiteRow[];
  /** Null when the response carried no recognisable H3 column. */
  cellColumn: string | null;
  /** cum_score first, then one per criterion the table actually scored. */
  scoreColumns: ScoreColumn[];
  /** Criteria the table carried no column for — reported, never guessed at. */
  unmatchedCriteria: string[];
}

/**
 * Narrow the backend's table to the columns the user is entitled to see, and
 * name the ones the map can be coloured by.
 *
 * Projection happens here rather than in the browser so the dropped columns
 * are never sent to it: "not shown" and "not delivered" are different
 * promises, and this is the second one.
 */
export function projectTable(rows: SiteRow[], criteria: string[]): ProjectedTable {
  if (rows.length === 0) {
    return { rows: [], cellColumn: null, scoreColumns: [], unmatchedCriteria: [] };
  }

  const columns = Object.keys(rows[0]);
  const cellColumn = detectCellColumn(rows);
  const scoreKey = columns.find((c) => normaliseColumn(c) === SCORE_COLUMN) ?? null;
  const hierarchy = HIERARCHY_COLUMNS.map((h) =>
    columns.find((c) => normaliseColumn(c) === h),
  ).filter((c): c is string => !!c);

  const scoreColumns: ScoreColumn[] = scoreKey
    ? [{ key: scoreKey, label: "Combined score" }]
    : [];
  const unmatchedCriteria: string[] = [];
  for (const criterion of criteria) {
    const key = criterionColumn(criterion, columns);
    if (!key || key === scoreKey || key === cellColumn) {
      unmatchedCriteria.push(criterion);
      continue;
    }
    // A criterion typed twice must not produce the column twice.
    if (scoreColumns.some((c) => c.key === key)) continue;
    scoreColumns.push({ key, label: criterion });
  }

  const keep = [
    ...(cellColumn ? [cellColumn] : []),
    ...scoreColumns.map((c) => c.key),
    ...hierarchy,
  ];
  const kept = new Set(keep);

  return {
    rows: rows.map((row) => {
      const out: SiteRow = {};
      for (const column of kept) out[column] = row[column];
      return out;
    }),
    cellColumn,
    scoreColumns,
    unmatchedCriteria,
  };
}

/** Finite numbers only — a table can carry a null where a cell was not scored. */
export function numericValues(rows: SiteRow[], column: string): number[] {
  return rows.map((r) => Number(r[column])).filter(Number.isFinite);
}

// ---------------------------------------------------------------------------
// Criteria as the user edits them
// ---------------------------------------------------------------------------

/**
 * One criterion and, optionally, how much it counts.
 *
 * `weight` is null until the user sets one, and null means "do not send a
 * weighting" rather than "send the default": the backend applies its own
 * weighting when the field is absent, so an unweighted run leaves the field
 * out entirely instead of sending a list this layer invented.
 *
 * The weights travel as parallel lists (`desired_criteria_weighting` /
 * `undesired_criteria_weighting`), one per criterion, which is why they are
 * carried together here — a weight that can drift out of step with its
 * criterion is a silently wrong assessment rather than an error.
 */
export interface Criterion {
  text: string;
  weight: number | null;
}

/** Weights are shares, so a list cannot claim more than the whole. */
export const MAX_WEIGHT_TOTAL = 1;

export function newCriterion(text = ""): Criterion {
  return { text, weight: null };
}

/** Criteria with something typed in them; the blank rows are not criteria. */
function filled(criteria: Criterion[]): Criterion[] {
  return criteria
    .map((c) => ({ text: c.text.trim(), weight: c.weight }))
    .filter((c) => c.text.length > 0);
}

export function weightTotal(criteria: Criterion[]): number {
  return filled(criteria).reduce((sum, c) => sum + (c.weight ?? 0), 0);
}

/** True once any criterion in the list carries a weight. */
export function hasWeighting(criteria: Criterion[]): boolean {
  return filled(criteria).some((c) => c.weight !== null);
}

/**
 * Why this list's weighting cannot be sent, or null if it can.
 *
 * Partial weighting is the case worth catching: weighting three of four
 * criteria and leaving the fourth blank is not a sent weighting with a gap,
 * it is a list that does not line up with its criteria, and the run it
 * produces would be weighted in a way the user never asked for.
 */
export function weightingProblem(criteria: Criterion[]): string | null {
  const rows = filled(criteria);
  if (rows.length === 0 || rows.every((c) => c.weight === null)) return null;

  if (rows.some((c) => c.weight === null)) {
    return "Give every criterion a weight, or leave them all blank.";
  }
  if (rows.some((c) => !Number.isFinite(c.weight) || c.weight! <= 0 || c.weight! > MAX_WEIGHT_TOTAL)) {
    return `Each weight must be greater than 0 and no more than ${MAX_WEIGHT_TOTAL}.`;
  }
  const total = rows.reduce((sum, c) => sum + c.weight!, 0);
  // Floating point: 0.1 + 0.2 + 0.7 does not land on 1 exactly.
  if (total > MAX_WEIGHT_TOTAL + 1e-9) {
    return `Weights add up to ${total.toFixed(2)} — they cannot total more than ${MAX_WEIGHT_TOTAL}.`;
  }
  return null;
}

export interface CriteriaPayload {
  criteria: string[];
  /** Absent when the user set no weights — the backend then uses its own. */
  weighting?: number[];
}

/**
 * The blank rows dropped, and the two parallel lists the payload wants.
 *
 * The weighting is omitted unless every criterion carries one, so a partially
 * weighted list can never reach the backend as a misaligned pair.
 */
export function toPayloadLists(criteria: Criterion[]): CriteriaPayload {
  const rows = filled(criteria);
  const weighted = rows.length > 0 && rows.every((c) => c.weight !== null);
  return {
    criteria: rows.map((c) => c.text),
    ...(weighted ? { weighting: rows.map((c) => c.weight!) } : {}),
  };
}
