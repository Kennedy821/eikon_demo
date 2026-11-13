/**
 * A snapshot of what a tab is currently showing, for the Eikon AI chat.
 *
 * The chat panel opens over a tab that already holds the answer to "what am I
 * looking at", so the question does not need to be retyped. What is sent is
 * the payload the tab received, not a picture of it: the rows carry scores,
 * rationales, coverage figures and H3 ids that never reach the screen, and a
 * description of a screenshot would throw those away.
 *
 * Every tab maps its own state into this one shape so there is a single
 * renderer and a single size budget, rather than six ad-hoc prompt fragments.
 * Values must already be primitives — flattening is the tab's job, since only
 * the tab knows which of its fields are worth the space.
 */
export interface PageSnapshot {
  /** The tab's label as it appears in the nav. */
  tab: string;
  /** What was asked for: the form inputs that produced these results. */
  params?: Record<string, string | number | boolean | null | undefined>;
  /** Headline figures the tab computed — totals, means, ranges. */
  stats?: Record<string, string | number | null | undefined>;
  /** The results themselves. */
  table?: {
    columns: string[];
    rows: (string | number | null | undefined)[][];
    /** Total before truncation, when `rows` is already a subset. */
    totalRows?: number;
  };
  /** Anything that does not fit a column, e.g. a location description. */
  notes?: string[];
}

/**
 * Size limits.
 *
 * The context rides in the chat's conversation history, which shares a window
 * with the conversation itself, so it is capped rather than sent whole. The
 * caps are generous enough that a normal result set arrives intact and only an
 * unusually large one is trimmed, and a trim always says so in the text: a
 * model told it is seeing 30 of 212 rows can say so too, where one handed a
 * silently truncated table would report the subset as the whole.
 */
export const MAX_ROWS = 30;
export const MAX_CELL_CHARS = 240;
export const MAX_CONTEXT_CHARS = 8_000;

function fmt(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    // Keep ids and counts exact; round only genuine decimals.
    return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, "");
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS - 1)}…` : s;
}

function section(title: string, body: string[]): string[] {
  return body.length ? [`${title}:`, ...body, ""] : [];
}

/**
 * Final guard on the whole block.
 *
 * Row-wise truncation keeps the table inside the budget, but a snapshot can
 * overrun without a table at all — Context sends a location description whole,
 * and nothing else bounds its length. Cutting is always announced rather than
 * left silent.
 */
function clamp(text: string): string {
  return text.length > MAX_CONTEXT_CHARS
    ? `${text.slice(0, MAX_CONTEXT_CHARS)}\n…(context truncated)`
    : text;
}

/**
 * Render a snapshot as the plain text that goes to the model.
 *
 * Pipe-delimited rather than JSON: the same table costs far fewer tokens
 * without the repeated keys, and it is what the backend's own result dumps
 * look like.
 *
 * Rows are added one at a time until the budget is spent, so a table is cut
 * between rows and never mid-value. A tab can therefore offer its richest
 * columns — the rationales and descriptions that justify a score — and let
 * the budget decide how many rows fit, instead of each tab guessing at a row
 * count that will not overrun.
 */
export function renderPageSnapshot(snap: PageSnapshot): string {
  const head: string[] = [
    `The user is looking at the EIKON "${snap.tab}" tab. Its current contents are below, attached automatically so the user does not have to describe or paste them. Treat it as what they can see, and answer about it when the question refers to "this", "these results", "the map", or the tab by name.`,
    "",
  ];

  head.push(
    ...section(
      "Parameters",
      Object.entries(snap.params ?? {})
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `- ${k}: ${fmt(v)}`),
    ),
  );

  head.push(
    ...section(
      "Summary",
      Object.entries(snap.stats ?? {})
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `- ${k}: ${fmt(v)}`),
    ),
  );

  const tail = section("Notes", (snap.notes ?? []).map((n) => `- ${n}`));

  if (!snap.table || snap.table.rows.length === 0) {
    return clamp([...head, ...tail].join("\n").trimEnd());
  }

  const { columns, rows, totalRows } = snap.table;
  const total = totalRows ?? rows.length;
  const header = columns.join(" | ");

  // Everything that is not table rows has first claim on the budget; whatever
  // is left is filled with as many whole rows as it holds. The reserve covers
  // the section heading and the "(n further rows not shown)" line, which are
  // only known once the fill has finished — without it the fill spends the
  // last of the budget and the note announcing the truncation is itself
  // truncated, which is the one line that must survive intact.
  const RESERVE = 200;
  const fixed = [...head, "", header, ...tail].join("\n").length;
  let spent = fixed;
  const body: string[] = [];
  for (const row of rows.slice(0, MAX_ROWS)) {
    const line = row.map(fmt).join(" | ");
    if (spent + line.length + 1 > MAX_CONTEXT_CHARS - RESERVE) break;
    body.push(line);
    spent += line.length + 1;
  }

  const omitted = total - body.length;
  const heading =
    omitted > 0 ? `Results (${total} rows, showing the first ${body.length})` : `Results (${total} rows)`;

  const rendered = [
    ...head,
    ...section(heading, [
      header,
      ...body,
      ...(omitted > 0 ? [`(${omitted} further rows not shown)`] : []),
    ]),
    ...tail,
  ]
    .join("\n")
    .trimEnd();

  return clamp(rendered);
}

/** One line naming what is attached, for the panel to show the user. */
export function describeSnapshot(snap: PageSnapshot): string {
  const rows = snap.table?.totalRows ?? snap.table?.rows.length ?? 0;
  if (rows > 0) return `${snap.tab} · ${rows} ${rows === 1 ? "row" : "rows"}`;
  const stats = Object.keys(snap.stats ?? {}).length;
  const notes = (snap.notes ?? []).length;
  return stats || notes ? `${snap.tab} · results` : `${snap.tab} · parameters only`;
}
