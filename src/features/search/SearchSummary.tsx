"use client";

import type { SearchResult } from "@/lib/types";

export function SearchSummary({ results }: { results: SearchResult[] }) {
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

      {hasEval && (
        <div className="space-y-2 text-sm">
          <h3 className="font-semibold text-eikon-midnight">AI Model Evaluation Details</h3>
          <p>
            <strong>Recommended:</strong> {recommended.length} locations (green on map)
          </p>
          <p>
            <strong>Not Recommended:</strong> {notRecommended.length} locations (red on map)
          </p>

          {(sampleRec || sampleNot) && (
            <div className="space-y-2 border-t border-green-200 pt-2">
              <p className="font-medium text-eikon-midnight">Sample AI reasoning</p>
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
