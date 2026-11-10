/**
 * Tooltip markup for an assessed H3 cell. Shared by the drone corridor and
 * risk assessment tabs, which colour the same assessment rows on the same
 * H3HexagonLayer.
 */

export function hexTooltip(hexId: string, score: number, objects: unknown): string {
  return `<div>Hex: ${hexId}</div><div>Risk: ${score.toFixed(3)}</div>${formatObjects(objects)}`;
}

/**
 * The assessment's objects_detected column arrives either as a JSON string or
 * already parsed, and either as a name -> coverage map or as a list of
 * { name, proportion_of_area_that_is_label } records. Both shapes render as
 * one indented line per object.
 */
export function formatObjects(payload: unknown): string {
  let parsed = payload;
  if (typeof payload === "string") {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return "<div style='margin-top:6px'>Objects: None</div>";
    }
  }
  const lines: string[] = [];
  const fmtPct = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const raw = String(v).replace("%", "").trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) ? `${n.toFixed(2)}%` : null;
  };
  const title = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const p = fmtPct(v);
      if (p) lines.push(`<div style='margin-left:10px;font-size:0.85em'>${title(k)}: ${p}</div>`);
    }
  } else if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const name = (o.name ?? o.Object) as string | undefined;
      const p = fmtPct(o.proportion_of_area_that_is_label ?? o.coverage);
      if (name && p) lines.push(`<div style='margin-left:10px;font-size:0.85em'>${title(name)}: ${p}</div>`);
    }
  }
  return `<div style='margin-top:6px'>Objects:</div>${lines.length ? lines.join("") : "<div style='margin-left:10px;font-size:0.85em'>None</div>"}`;
}
