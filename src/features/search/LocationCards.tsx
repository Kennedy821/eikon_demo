"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getResolution } from "h3-js";
import { getContext } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { SearchResult } from "@/lib/types";

/**
 * Location Profile carousel — ports render_location_cards. Prev/next through
 * results; each card shows relevance + AI recommendation, coordinates, the
 * satellite image, detected objects, description, and the AI rationale.
 */
export function LocationCards({ results }: { results: SearchResult[] }) {
  const [index, setIndex] = useState(0);
  if (results.length === 0) return <p className="text-sm text-eikon-muted">No results to display.</p>;

  const i = Math.max(0, Math.min(index, results.length - 1));
  const loc = results[i];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIndex(i - 1)}
          disabled={i === 0}
          className="rounded border px-3 py-1 text-sm disabled:opacity-40"
        >
          ← Previous
        </button>
        <span className="text-sm font-semibold text-eikon-midnight">
          Location {i + 1} of {results.length}
        </span>
        <button
          onClick={() => setIndex(i + 1)}
          disabled={i >= results.length - 1}
          className="rounded border px-3 py-1 text-sm disabled:opacity-40"
        >
          Next →
        </button>
      </div>

      <LocationCard loc={loc} />

      <label className="block text-sm">
        <span className="mr-2 text-eikon-muted">Jump to location:</span>
        <select
          value={i}
          onChange={(e) => setIndex(Number(e.target.value))}
          className="rounded border px-2 py-1"
        >
          {results.map((r, j) => (
            <option key={j} value={j}>
              {j + 1}. {r.name ?? r.locationId ?? `Location ${j + 1}`}
              {r.relevance !== undefined ? ` (${(r.relevance * 100).toFixed(0)}%)` : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function resolutionLabel(locationId: string): string {
  try {
    const r = getResolution(locationId);
    if (r >= 9) return "high";
    if (r === 8) return "medium";
    return "low";
  } catch {
    return "medium";
  }
}

function LocationCard({ loc }: { loc: SearchResult }) {
  const { apiKey } = useAuth();

  const relevance = loc.relevance ?? 0;
  const relevanceLabel =
    relevance >= 0.8 ? "High Match" : relevance >= 0.6 ? "Good Match" : "Partial Match";

  const evalScore = loc.aiModelEvaluation;
  const isRecommended =
    evalScore !== null && evalScore !== undefined
      ? evalScore >= 0.5
      : loc.aiEvaluation === 1
        ? true
        : loc.aiEvaluation === 0
          ? false
          : null;

  // Satellite image via the existing context endpoint, at the H3-derived res.
  const image = useQuery({
    queryKey: ["loc-image", loc.locationId, loc.lat, loc.lon],
    queryFn: () =>
      getContext({
        lat: loc.lat,
        lon: loc.lon,
        resolution: resolutionLabel(loc.locationId),
        apiKey: apiKey as string,
      }),
    enabled: !!apiKey && loc.lat !== 0 && loc.lon !== 0,
    retry: 2,
    staleTime: 5 * 60_000,
  });

  const rationale = loc.aiModelRationale ?? loc.aiRationale ?? null;

  return (
    <div className="space-y-4 rounded-lg border p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Badge label="Location ID" value={loc.locationId || "N/A"} mono />
        <Badge label="Relevance" value={`${(relevance * 100).toFixed(1)}% — ${relevanceLabel}`} />
        <Badge
          label="AI Recommendation"
          value={
            isRecommended === null
              ? "N/A"
              : isRecommended
                ? `Recommended${evalScore != null ? ` (${(evalScore * 100).toFixed(0)}%)` : ""}`
                : "Not Recommended"
          }
          tone={isRecommended === null ? "neutral" : isRecommended ? "good" : "bad"}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-eikon-midnight">Coordinates</h3>
          <pre className="rounded bg-eikon-panel p-2 text-xs">
            Lat: {loc.lat.toFixed(6)}
            {"\n"}Lon: {loc.lon.toFixed(6)}
          </pre>
          {image.isLoading && <div className="h-48 w-full animate-pulse rounded bg-eikon-panel" />}
          {image.data?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:image/png;base64,${image.data.image}`}
              alt="Satellite view"
              className="w-full rounded border"
            />
          ) : (
            !image.isLoading && (
              <button
                onClick={() => image.refetch()}
                className="rounded border px-3 py-1 text-sm text-eikon-midnight"
              >
                Retry image fetch
              </button>
            )
          )}
        </div>

        <div className="space-y-2">
          {loc.objectsDetected && loc.objectsDetected.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-eikon-midnight">Objects Detected</h3>
              <ul className="text-sm">
                {loc.objectsDetected.slice(0, 6).map((o, k) => (
                  <li key={k}>
                    • <strong>{o.name.replace(/_/g, " ")}</strong>
                    {o.coverage !== undefined ? `: ${o.coverage}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-eikon-midnight">Location Description</h3>
        <p className="rounded bg-eikon-panel p-3 text-sm">
          {loc.description ?? "No description available."}
        </p>
      </div>

      {rationale && (
        <div>
          <h3 className="text-sm font-semibold text-eikon-midnight">AI Model Evaluation</h3>
          <p
            className={`rounded p-3 text-sm ${
              isRecommended === true
                ? "bg-green-50 text-green-800"
                : isRecommended === false
                  ? "bg-orange-50 text-orange-800"
                  : "bg-eikon-panel"
            }`}
          >
            {rationale}
          </p>
        </div>
      )}
    </div>
  );
}

function Badge({
  label,
  value,
  mono,
  tone = "neutral",
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "neutral" | "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "bg-green-100 text-green-800 border-green-200"
      : tone === "bad"
        ? "bg-red-100 text-red-800 border-red-200"
        : "bg-white text-eikon-midnight border-gray-200";
  return (
    <div className="text-center">
      <div className="mb-1 text-xs text-eikon-muted">{label}</div>
      <span className={`block rounded border px-3 py-2 text-sm font-semibold ${toneClass} ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}
