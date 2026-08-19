"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { Feature, Polygon } from "geojson";
import { useSearchExperimentalJob } from "@/hooks/useSearchExperimentalJob";
import { LocationCards } from "./LocationCards";
import { SearchSummary } from "./SearchSummary";
import type { SearchResult } from "@/lib/types";
import UK_AREAS from "@/content/uk_areas.json";

// deck.gl / maplibre touch `window` — load client-only. Experimental fork of
// the results map: renders "More like this" matches teal with match tooltips.
const ResultsMap = dynamic(() => import("./ResultsMap"), {
  ssr: false,
  loading: () => <div className="h-[480px] w-full animate-pulse bg-eikon-panel" />,
});

// AOI drawing map (maplibre + terra-draw) — client-only.
const PolygonDrawMap = dynamic(() => import("@/components/map/PolygonDrawMap"), {
  ssr: false,
  loading: () => <div className="h-[380px] w-full animate-pulse rounded-lg bg-eikon-panel" />,
});

const EFFORT_LEVELS = ["test", "quick", "moderate", "exhaustive"];
const MAP_SELECTION = "Map selection";
const SPATIAL_RESOLUTIONS = ["UK - all", "UK - area", MAP_SELECTION];

/** Build the geodataframe payload — a GeoJSON FeatureCollection with a
 *  unique_id column, mirroring geopandas gdf[["unique_id","geometry"]].to_json()
 *  at CRS 4326. */
function toGeodataframe(feature: Feature<Polygon>) {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { unique_id: "aoi_1" },
        geometry: feature.geometry,
      },
    ],
  };
}
const RESULT_VIEWS = ["Map View", "Location Profile", "Data Table"] as const;
type ResultView = (typeof RESULT_VIEWS)[number];

export function SearchExperimentalTab() {
  const [prompt, setPrompt] = useState("");
  const [effort, setEffort] = useState("test");
  const [spatialResolution, setSpatialResolution] = useState("UK - all");
  const [borough, setBorough] = useState((UK_AREAS as string[])[0] ?? "");
  const [view, setView] = useState<ResultView>("Map View");
  const [selectedProfileIndex, setSelectedProfileIndex] = useState(0);
  const [aoi, setAoi] = useState<Feature<Polygon> | null>(null);
  const {
    submit,
    reset,
    addResults,
    isRunning,
    isComplete,
    results,
    stage,
    error,
  } = useSearchExperimentalJob();

  const isMapSelection = spatialResolution === MAP_SELECTION;
  // When drawing a custom AOI, an area must be drawn before searching.
  const canSubmit = prompt.trim().length > 0 && !isRunning && (!isMapSelection || !!aoi);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    submit({
      prompt,
      effort,
      spatialResolution,
      borough: spatialResolution === "UK - area" ? borough : null,
      geodataframe: isMapSelection && aoi ? toGeodataframe(aoi) : undefined,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-eikon-midnight">Location Search</h1>
        <p className="text-sm text-eikon-muted">
          Search for locations across the UK using natural language queries.
        </p>
      </div>

      {/* Two-column layout mirrors st.columns([1, 2]): params left, results right. */}
      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        {/* ---- Left: search parameters + progress + summary ---- */}
        <div className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-eikon-midnight">Search parameters</h2>

            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Spatial resolution</span>
              <select
                value={spatialResolution}
                onChange={(e) => setSpatialResolution(e.target.value)}
                className="w-full rounded border px-2 py-1.5"
              >
                {SPATIAL_RESOLUTIONS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>

            {spatialResolution === "UK - area" && (
              <label className="block text-sm">
                <span className="mb-1 block text-eikon-muted">Area</span>
                <select
                  value={borough}
                  onChange={(e) => setBorough(e.target.value)}
                  className="w-full rounded border px-2 py-1.5"
                >
                  {(UK_AREAS as string[]).map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
            )}

            {isMapSelection && (
              <div className="space-y-1.5">
                <span className="block text-sm text-eikon-muted">
                  Draw area of interest
                </span>
                <PolygonDrawMap onChange={setAoi} />
                <p className={`text-xs ${aoi ? "text-green-700" : "text-eikon-muted"}`}>
                  {aoi
                    ? "✓ Area captured — this polygon will scope the search."
                    : "Navigate the map, pick a tool (Polygon, Rectangle, or Circle), and draw an area to search within."}
                </p>
              </div>
            )}

            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Search query</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., I'm looking for an airport"
                rows={4}
                className="w-full rounded border px-3 py-2"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Search effort</span>
              <select
                value={effort}
                onChange={(e) => setEffort(e.target.value)}
                className="w-full rounded border px-2 py-1.5"
              >
                {EFFORT_LEVELS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex-1 rounded bg-eikon-orange px-4 py-2 text-white disabled:opacity-50"
              >
                {isRunning ? "Searching…" : "Search"}
              </button>
              {(isComplete || error) && (
                <button
                  type="button"
                  onClick={reset}
                  className="rounded border px-4 py-2 text-eikon-midnight"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Escape hatch for a stranded search — mirrors the drone tab's
                "Reset assessment lock". Without it, a job that never completes
                leaves the form locked (jobId persists across reloads). */}
            {isRunning && (
              <>
                <button
                  type="button"
                  onClick={reset}
                  className="w-full rounded border px-4 py-2 text-sm text-eikon-midnight"
                >
                  Reset search lock
                </button>
                <p className="text-xs text-eikon-muted">
                  A search is already running. If you believe it has stalled or crashed, reset it
                  to start a new one.
                </p>
              </>
            )}
          </form>

          {isRunning && (
            <div className="space-y-2 rounded-lg border p-4">
              <div className="flex justify-between text-sm">
                <span className={stage.level === "success" ? "text-green-700" : "text-eikon-midnight"}>
                  {stage.status}
                </span>
                <span className="text-eikon-muted">{stage.progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-eikon-panel">
                <div
                  className="h-full bg-eikon-orange transition-all duration-500"
                  style={{ width: `${stage.progress}%` }}
                />
              </div>
              <p className="text-xs text-eikon-muted">{stage.detail}</p>
            </div>
          )}

          {isComplete && <SearchSummary results={results} />}
        </div>

        {/* ---- Right: results ---- */}
        <div className="min-w-0">
          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {error instanceof Error ? error.message : "Search failed"}
            </p>
          )}

          {isComplete ? (
            <div className="space-y-4">
              <div className="flex gap-2 border-b">
                {RESULT_VIEWS.map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`border-b-2 px-3 py-2 text-sm font-medium ${
                      view === v
                        ? "border-eikon-navy text-eikon-navy font-bold"
                        : "border-transparent text-eikon-muted hover:text-eikon-navy"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>

              {view === "Map View" && (
                <ResultsMap
                  results={results}
                  onClickResult={(i) => {
                    setSelectedProfileIndex(i);
                    setView("Location Profile");
                  }}
                />
              )}
              {view === "Location Profile" && (
                <LocationCards
                  results={results}
                  initialIndex={selectedProfileIndex}
                  onAddResults={addResults}
                />
              )}
              {view === "Data Table" && <DataTable results={results} />}
            </div>
          ) : (
            !error && (
              <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-eikon-muted">
                {isRunning
                  ? "Searching — results will appear here."
                  : "Enter a search query and click Search to find locations."}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

const HIDDEN_COLUMNS = new Set(["objects_detected", "ai_rationale", "description"]);

function DataTable({ results }: { results: SearchResult[] }) {
  if (results.length === 0) return <p className="text-sm text-eikon-muted">No locations returned.</p>;

  // Union of raw columns minus the heavy text columns (matches Streamlit).
  const columns = Array.from(
    results.reduce((set, r) => {
      Object.keys(r.raw).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  ).filter((c) => !HIDDEN_COLUMNS.has(c));

  function fmt(col: string, row: SearchResult): string {
    const v = row.raw[col];
    if (col === "search_results" && typeof v === "number") return `${(v * 100).toFixed(1)}%`;
    return v === null || v === undefined ? "" : String(v);
  }

  function downloadCsv() {
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = columns.join(",");
    const lines = results.map((r) => columns.map((c) => esc(r.raw[c])).join(","));
    const csv = [header, ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "eikon_search_results.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <button onClick={downloadCsv} className="rounded border px-4 py-2 text-sm text-eikon-midnight">
        Download Full Results (CSV)
      </button>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-eikon-panel text-left text-eikon-midnight">
            <tr>
              {columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-2">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-t">
                {columns.map((c) => (
                  <td key={c} className="whitespace-nowrap px-3 py-2">
                    {fmt(c, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
