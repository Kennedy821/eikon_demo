"use client";

import type { SearchResult } from "@/lib/types";

/**
 * Search Process Summary — ports the AI-evaluation portion of
 * _render_search_summary: total found, recommended vs not-recommended counts,
 * and a sample rationale from each bucket.
 *
 * The Stage-1 query-processing breakdown and "final status" are intentionally
 * omitted — they read server-local files in Streamlit and need a new backend
 * HTTP endpoint (tracked as the backend-blocked task).
 */
export function SearchSummary({
  results,
  stage1Info,
}: {
  results: SearchResult[];
  stage1Info?: { original: string | null; cleaned: string | null } | null;
}) {
  if (results.length === 0) return null;

  const withEval = results.filter(
    (r) => r.aiModelEvaluation !== null && r.aiModelEvaluation !== undefined,
  );
  const hasEval = withEval.length > 0;

  const recommended = withEval.filter((r) => (r.aiModelEvaluation as number) >= 0.5);
  const notRecommended = withEval.filter((r) => (r.aiModelEvaluation as number) < 0.5);

  const sampleRec = recommended.find((r) => r.aiModelRationale || r.aiRationale);
  const sampleNot = notRecommended.find((r) => r.aiModelRationale || r.aiRationale);

  return (
    <div className="space-y-3 rounded-lg border bg-green-50 p-4">
      <p className="font-semibold text-green-800">Found {results.length} locations!</p>

      {stage1Info && (stage1Info.original || stage1Info.cleaned) && (
        <div className="space-y-1 border-b border-green-200 pb-2 text-sm">
          <h3 className="font-semibold text-eikon-navy">Stage 1 — Query Processing</h3>
          {stage1Info.original && (
            <p className="text-xs text-eikon-muted">
              <em>Original:</em> {stage1Info.original}
            </p>
          )}
          {stage1Info.cleaned && (
            <p className="text-xs text-eikon-muted">
              <em>Cleaned:</em> {stage1Info.cleaned}
            </p>
          )}
        </div>
      )}

      {hasEval && (
        <div className="space-y-2 text-sm">
          <h3 className="font-semibold text-eikon-navy">AI Model Evaluation Details</h3>
          <p>
            <strong>Recommended:</strong> {recommended.length} locations (green on map)
          </p>
          <p>
            <strong>Not Recommended:</strong> {notRecommended.length} locations (red on map)
          </p>

          {(sampleRec || sampleNot) && (
            <div className="space-y-2 border-t border-green-200 pt-2">
              <p className="font-medium text-eikon-navy">Sample AI reasoning</p>
              {sampleRec && (
                <p className="text-xs text-eikon-muted">
                  <em>Recommended:</em>{" "}
                  {truncate(sampleRec.aiModelRationale ?? sampleRec.aiRationale ?? "")}
                </p>
              )}
              {sampleNot && (
                <p className="text-xs text-eikon-muted">
                  <em>Not recommended:</em>{" "}
                  {truncate(sampleNot.aiModelRationale ?? sampleNot.aiRationale ?? "")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function truncate(s: string): string {
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
}
