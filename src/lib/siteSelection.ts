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
 * A catchment run answers with a second set of columns — a catchment score
 * per criterion, one per list, and `site_selection_catchment_score` over the
 * lot — and when they are there they are the whole answer. The in-cell
 * columns are then dropped alongside the internals: the mode was run to score
 * a cell on its surroundings, and showing both sets side by side offers two
 * numbers per criterion where the user asked a single question.
 *
 * Which run it was is read off the response rather than passed in. The
 * catchment columns exist only when catchment mode was asked for, so their
 * presence is the fact itself, and a table can never be labelled as one kind
 * of run while holding the other's columns.
 *
 * The naming of a criterion's column is the backend's choice, not ours, and a
 * criterion is free text, so the match is made on a normalised form rather
 * than on an exact string. That keeps a renamed or re-slugified column from
 * silently disappearing out of the map's selector.
 */
import { isValidCell } from "h3-js";
import { kringLabel } from "@/lib/geo/kring";

/** Criteria per list. Both lists are required and neither may be empty. */
export const MAX_CRITERIA = 5;

/** The combined score: desired against undesired, per cell. */
export const SCORE_COLUMN = "cum_score";

/**
 * The catchment run's headline: desired against undesired, each measured over
 * its own catchment rather than within the cell. Present only in catchment
 * mode, and listed first when it is, so it is what the map opens on.
 */
export const CATCHMENT_SCORE_COLUMN = "site_selection_catchment_score";

/** The per-list catchment subtotals behind that score. */
const CATCHMENT_AGGREGATES = [
  { column: "desired_catchment_score", label: "Desired catchment" },
  { column: "undesired_catchment_score", label: "Undesired catchment" },
];

/**
 * How the backend names one criterion's catchment column: the criterion's own
 * column with this appended. Matched through criterionColumn like any other,
 * so a renamed column still resolves.
 */
const CATCHMENT_SUFFIX = "catchment";

/**
 * Hierarchical scores, kept because they are the per-resolution breakdown of
 * the same answer rather than model internals.
 *
 * They break down `cum_score`, the in-cell answer, and the backend returns no
 * catchment equivalent — so they go with it on a catchment run rather than
 * sitting beside a score they are not a breakdown of.
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
  const byName = (normalised: string) =>
    columns.find((c) => normaliseColumn(c) === normalised) ?? null;
  const scoreKey = byName(SCORE_COLUMN);
  const catchmentKey = byName(CATCHMENT_SCORE_COLUMN);
  const hierarchy = HIERARCHY_COLUMNS.map((h) => byName(h)).filter(
    (c): c is string => !!c,
  );

  const scoreColumns: ScoreColumn[] = [];
  const add = (key: string | null, label: string) => {
    if (!key || key === cellColumn) return;
    // A criterion typed twice must not produce the column twice.
    if (scoreColumns.some((c) => c.key === key)) return;
    scoreColumns.push({ key, label });
  };

  const unmatchedCriteria: string[] = [];
  const isCatchmentRun = !!catchmentKey;

  if (isCatchmentRun) {
    // The headline leads, so it is what the map opens on, then the two list
    // subtotals behind it, then one column per criterion. A criterion needs
    // no "(catchment)" in its label here: every column on the table is one.
    add(catchmentKey, "Site selection score");
    for (const aggregate of CATCHMENT_AGGREGATES) {
      add(byName(aggregate.column), aggregate.label);
    }
    for (const criterion of criteria) {
      const key = criterionColumn(`${criterion} ${CATCHMENT_SUFFIX}`, columns);
      if (!key || key === catchmentKey || key === cellColumn) {
        unmatchedCriteria.push(criterion);
      } else {
        add(key, criterion);
      }
    }
  } else {
    add(scoreKey, "Combined score");
    for (const criterion of criteria) {
      const key = criterionColumn(criterion, columns);
      if (!key || key === scoreKey || key === cellColumn) {
        unmatchedCriteria.push(criterion);
      } else {
        add(key, criterion);
      }
    }
  }

  const keep = [
    ...(cellColumn ? [cellColumn] : []),
    ...scoreColumns.map((c) => c.key),
    // The hierarchy breaks down cum_score, which a catchment run does not show.
    ...(isCatchmentRun ? [] : hierarchy),
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
  /**
   * How far around a cell this criterion is looked for, as a count of H3
   * rings. Only sent in catchment mode, and never null: a kring list has to
   * line up one-for-one with its criteria, so there is no "unset" to send and
   * every criterion carries the default until it is changed.
   */
  kring: number;
}

/** Weights are shares, so a list cannot claim more than the whole. */
export const MAX_WEIGHT_TOTAL = 1;

export function newCriterion(text = ""): Criterion {
  return { text, weight: null, kring: DEFAULT_CATCHMENT_KRING };
}

/** Criteria with something typed in them; the blank rows are not criteria. */
function filled(criteria: Criterion[]): Criterion[] {
  return criteria
    .map((c) => ({ text: c.text.trim(), weight: c.weight, kring: c.kring }))
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
  /** One per criterion, always populated; only sent in catchment mode. */
  krings: number[];
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
    krings: rows.map((c) => c.kring),
  };
}

// ---------------------------------------------------------------------------
// Catchment mode
// ---------------------------------------------------------------------------

/**
 * Whether a criterion has to be in the cell itself or merely near it.
 *
 * Without a catchment area a cell scores on what it contains, which is the
 * original behaviour and what the backend does when `catchment_mode` is left
 * out of the payload. With one, each criterion carries a distance and a cell
 * scores on what lies within that distance of it — so "good road access"
 * within 348m counts towards a cell that has no road in it at all.
 *
 * The distance travels as a k-ring, converted from metres by the shared grid
 * arithmetic in geo/kring. Ring counts rather than metres are offered in the
 * UI because only multiples of the edge length are expressible: a free metres
 * field would accept 500m and quietly send the 348m that is actually searched.
 */
export const CATCHMENT_MODES = ["off", "on"] as const;
export type CatchmentMode = (typeof CATCHMENT_MODES)[number];

export const CATCHMENT_LABELS: Record<CatchmentMode, string> = {
  off: "No catchment area",
  on: "With catchment area",
};

/**
 * The widest catchment offered, in rings.
 *
 * 10 rings is 1,740m, which is a walkable distance and a plausible catchment
 * for a site. It is a UI choice rather than a backend limit — nothing upstream
 * was found to cap it — so it can be raised if someone wants a wider one.
 */
export const MAX_CATCHMENT_KRING = 10;

/**
 * The narrowest catchment offered: no ring at all, the cell on its own.
 *
 * A k-ring of 0 is the centre cell by itself, which is the natural floor for
 * a distance expressed in rings and lets one criterion be scored in-cell
 * while its neighbours are scored over a catchment. The endpoint rejected it
 * at first — "one positive integer k-ring per criterion" — and is being
 * changed to take it, so a 0 here depends on that change being deployed.
 */
export const MIN_CATCHMENT_KRING = 0;

/**
 * Two rings, 348m: the corridor tab's default landing distance, and about the
 * span of a res-9 cell's own neighbourhood.
 */
export const DEFAULT_CATCHMENT_KRING = 2;

/** Every ring count the selector offers. */
export const CATCHMENT_KRING_OPTIONS = Array.from(
  { length: MAX_CATCHMENT_KRING - MIN_CATCHMENT_KRING + 1 },
  (_, i) => MIN_CATCHMENT_KRING + i,
);

/** What the selector shows for a ring count. */
export function catchmentLabel(kring: number): string {
  return kring === 0 ? "Cell only" : kringLabel(kring);
}

/** Why this list's catchment areas cannot be sent, or null if they can. */
export function catchmentProblem(criteria: Criterion[]): string | null {
  const rows = filled(criteria);
  const bad = rows.some(
    (c) =>
      !Number.isInteger(c.kring) ||
      c.kring < MIN_CATCHMENT_KRING ||
      c.kring > MAX_CATCHMENT_KRING,
  );
  return bad
    ? `Each catchment area must be between ${MIN_CATCHMENT_KRING} and ${MAX_CATCHMENT_KRING} rings.`
    : null;
}
