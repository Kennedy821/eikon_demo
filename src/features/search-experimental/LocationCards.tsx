"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getResolution, gridDisk, cellToLatLng, isValidCell } from "h3-js";
import { getContext, runPortfolio } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { SearchResult } from "@/lib/types";

/**
 * Location Profile carousel — ports render_location_cards. Prev/next through
 * results; each card shows relevance + AI recommendation, coordinates, the
 * satellite image, detected objects, description, and the AI rationale.
 */
export function LocationCards({
  results,
  initialIndex = 0,
  onAddResults,
}: {
  results: SearchResult[];
  initialIndex?: number;
  /** Called with "More like this" matches so they join the results set. */
  onAddResults?: (r: SearchResult[]) => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  // "More like this" matches, keyed by the location they were requested for.
  // Matches are only ever shown on that location's card.
  const [similarByLocation, setSimilarByLocation] = useState<Record<string, SimilarItem[]>>({});

  useEffect(() => {
    setIndex(initialIndex);
  }, [initialIndex]);

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

      {/* Keyed by location so the card (and its "More like this" request
          state) remounts per location instead of carrying over. */}
      <LocationCard
        key={loc.locationId || i}
        loc={loc}
        onAddResults={onAddResults}
        similarItems={similarByLocation[loc.locationId] ?? null}
        onSimilarItems={(items) =>
          setSimilarByLocation((prev) => ({ ...prev, [loc.locationId]: items }))
        }
      />

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

function LocationCard({
  loc,
  onAddResults,
  similarItems,
  onSimilarItems,
}: {
  loc: SearchResult;
  onAddResults?: (r: SearchResult[]) => void;
  similarItems: SimilarItem[] | null;
  onSimilarItems: (items: SimilarItem[]) => void;
}) {
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

      <MoreLikeThis
        loc={loc}
        onAddResults={onAddResults}
        items={similarItems}
        onItems={onSimilarItems}
      />
    </div>
  );
}

/**
 * "More like this" — for a result the user likes, score the surrounding
 * neighbourhood (5 H3 rings, 90 cells) against it via the portfolio comparison
 * API (combined similarity at high resolution) and rank the most similar
 * nearby locations. Mirrors the k_ring + eikon_portfolio_comparison_uk
 * expansion pattern from the reference notebook.
 */
export type SimilarItem = { dest: string; similarity: number | null };

function MoreLikeThis({
  loc,
  onAddResults,
  items,
  onItems,
}: {
  loc: SearchResult;
  onAddResults?: (r: SearchResult[]) => void;
  /** Matches previously requested for this location; null if never requested. */
  items: SimilarItem[] | null;
  onItems: (items: SimilarItem[]) => void;
}) {
  const { apiKey } = useAuth();

  const similar = useMutation({
    mutationFn: async () => {
      const origin = loc.locationId;
      const [oLat, oLon] = cellToLatLng(origin);
      // 5 rings around the origin, excluding the origin itself (orig != dest).
      const candidates = gridDisk(origin, 5).filter((c) => c !== origin);
      const pairs = candidates.map((dest) => {
        const [dLat, dLon] = cellToLatLng(dest);
        return { orig: origin, dest, origLat: oLat, origLon: oLon, destLat: dLat, destLon: dLon };
      });
      return runPortfolio({
        pairs,
        resolution: "high",
        similarityType: "combined",
        apiKey: apiKey as string,
      });
    },
    onSuccess: (data) => {
      // Rank by similarity descending and keep the closest matches.
      const top = (data.results ?? [])
        .filter((r) => r.similarity !== null && isValidCell(r.dest) && r.dest !== loc.locationId)
        .sort((a, b) => (b.similarity as number) - (a.similarity as number))
        .slice(0, 10)
        .map((r) => ({ dest: r.dest, similarity: r.similarity }));
      onItems(top);
      if (!onAddResults) return;
      // Append the top matches to the results set so they show up in the
      // Data Table, on the map, and in the CSV export.
      onAddResults(
        top.map((r) => {
          const [lat, lon] = cellToLatLng(r.dest);
          return {
            locationId: r.dest,
            lat,
            lon,
            raw: {
              location_id: r.dest,
              latitude: lat,
              longitude: lon,
              source: "more_like_this",
              similar_to: loc.locationId,
              combined_similarity: r.similarity,
            },
          } satisfies SearchResult;
        }),
      );
    },
  });

  const ranked = items ?? [];

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => similar.mutate()}
          disabled={similar.isPending || !isValidCell(loc.locationId)}
          className="rounded bg-eikon-orange px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {similar.isPending ? "Finding similar locations…" : "✨ More like this"}
        </button>
        <span className="text-xs text-eikon-muted">
          Finds nearby places that look similar to this one.
        </span>
      </div>

      {similar.error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {similar.error instanceof Error ? similar.error.message : "Similarity search failed"}
        </p>
      )}

      {items !== null && ranked.length === 0 && (
        <p className="text-sm text-eikon-muted">No similar locations found near this one.</p>
      )}

      {ranked.length > 0 && <SimilarCarousel items={ranked} />}
    </div>
  );
}

/** Carousel of the most similar nearby locations — image + id, prev/next. */
function SimilarCarousel({ items }: { items: { dest: string; similarity: number | null }[] }) {
  const [index, setIndex] = useState(0);

  // New results — start back at the best match.
  useEffect(() => {
    setIndex(0);
  }, [items]);

  const i = Math.max(0, Math.min(index, items.length - 1));
  const item = items[i];

  return (
    <div className="space-y-2 rounded-lg border bg-eikon-panel/40 p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIndex(i - 1)}
          disabled={i === 0}
          className="rounded border bg-white px-3 py-1 text-sm disabled:opacity-40"
        >
          ← Previous
        </button>
        <span className="text-sm font-semibold text-eikon-midnight">
          Similar location {i + 1} of {items.length}
        </span>
        <button
          type="button"
          onClick={() => setIndex(i + 1)}
          disabled={i >= items.length - 1}
          className="rounded border bg-white px-3 py-1 text-sm disabled:opacity-40"
        >
          Next →
        </button>
      </div>

      <SimilarLocationImage cell={item.dest} />

      <div className="flex items-center justify-between text-sm">
        <span className="font-mono text-xs text-eikon-midnight">{item.dest}</span>
        <span className="font-semibold text-green-700">
          {((item.similarity as number) * 100).toFixed(0)}% match
        </span>
      </div>
    </div>
  );
}

/** Satellite image for a similar-location cell, fetched like the main card's. */
function SimilarLocationImage({ cell }: { cell: string }) {
  const { apiKey } = useAuth();
  const [lat, lon] = cellToLatLng(cell);

  const image = useQuery({
    queryKey: ["loc-image", cell, lat, lon],
    queryFn: () =>
      getContext({ lat, lon, resolution: resolutionLabel(cell), apiKey: apiKey as string }),
    enabled: !!apiKey,
    retry: 2,
    staleTime: 5 * 60_000,
  });

  if (image.isLoading) {
    return <div className="h-56 w-full animate-pulse rounded bg-eikon-panel" />;
  }
  if (image.data?.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`data:image/png;base64,${image.data.image}`}
        alt="Similar location"
        className="w-full rounded border"
      />
    );
  }
  return (
    <button
      onClick={() => image.refetch()}
      className="rounded border bg-white px-3 py-1 text-sm text-eikon-midnight"
    >
      Retry image fetch
    </button>
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
