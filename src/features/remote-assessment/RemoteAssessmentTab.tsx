"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { area as turfArea } from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import { useRemoteAssessment } from "@/hooks/useRemoteAssessment";
import type { RemoteAssessmentCell } from "@/lib/types";
import UK_AREAS from "@/content/uk_areas.json";

// deck.gl / maplibre touch `window` — client-only.
const AssessmentHeatMap = dynamic(() => import("./AssessmentHeatMap"), {
  ssr: false,
  loading: () => <div className="h-[520px] w-full animate-pulse rounded-lg bg-eikon-panel" />,
});
const PolygonDrawMap = dynamic(() => import("@/components/map/PolygonDrawMap"), {
  ssr: false,
  loading: () => <div className="h-[380px] w-full animate-pulse rounded-lg bg-eikon-panel" />,
});

const AREA_MODE = "UK - area";
const MAP_MODE = "Map selection";
const AOI_MODES = [AREA_MODE, MAP_MODE];
const ALL_OBJECTS = "all";
// Object classes the remote verification backend currently supports. Kept
// deliberately short — the full DETECTABLE_OBJECTS list belongs to the
// per-tile object-detection endpoint, not this one.
const OBJECT_OPTIONS = ["solar_panels", "industrial_buildings"];
const RESULT_VIEWS = ["Heat Map", "Data Table"] as const;
type ResultView = (typeof RESULT_VIEWS)[number];

// Above this, fast mode only samples the most likely cells rather than
// covering every cell in the AOI.
const FAST_MODE_FULL_COVERAGE_KM2 = 300;

function labelFor(objectName: string) {
  return objectName === ALL_OBJECTS ? "All objects" : objectName.replace(/_/g, " ");
}

function pct(v: number, digits = 1) {
  return `${(v * 100).toFixed(digits)}%`;
}

function formatConfidence(v: number | null) {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}

export function RemoteAssessmentTab() {
  const [aoiMode, setAoiMode] = useState(AREA_MODE);
  const [areaName, setAreaName] = useState((UK_AREAS as string[])[0] ?? "");
  const [aoi, setAoi] = useState<Feature<Polygon> | null>(null);
  const [inspection, setInspection] = useState("solar_panels");
  const [executionMode, setExecutionMode] = useState<"fast" | "standard">("fast");
  const [view, setView] = useState<ResultView>("Heat Map");
  const [selectedObject, setSelectedObject] = useState<string | null>(null);

  const {
    submit,
    reset,
    request,
    isRunning,
    isComplete,
    progress,
    detail,
    note,
    cells,
    error,
  } = useRemoteAssessment();

  const isMapMode = aoiMode === MAP_MODE;
  const aoiKm2 = useMemo(() => (aoi ? turfArea(aoi) / 1e6 : 0), [aoi]);
  const canSubmit = !isRunning && (!isMapMode || !!aoi);

  // Object classes present in the response, with detection counts. This is
  // the source of the heat-map dropdown — we only know what came back once
  // the backend answers (especially for "all").
  const objectStats = useMemo(() => {
    const byName = new Map<string, { assessed: number; detected: number }>();
    for (const c of cells) {
      const s = byName.get(c.objectName) ?? { assessed: 0, detected: 0 };
      s.assessed += 1;
      if (c.coverage > 0) s.detected += 1;
      byName.set(c.objectName, s);
    }
    return Array.from(byName.entries())
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.detected - a.detected || a.name.localeCompare(b.name));
  }, [cells]);

  // Keep the selection valid as results arrive/change.
  useEffect(() => {
    if (objectStats.length === 0) {
      setSelectedObject(null);
    } else if (!selectedObject || !objectStats.some((o) => o.name === selectedObject)) {
      setSelectedObject(objectStats[0].name);
    }
  }, [objectStats, selectedObject]);

  const visibleCells = useMemo(
    () => (selectedObject ? cells.filter((c) => c.objectName === selectedObject) : []),
    [cells, selectedObject],
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setView("Heat Map");
    submit({
      inspection,
      executionMode,
      area: isMapMode ? null : areaName,
      aoi: isMapMode ? aoi : null,
    });
  }

  const requestLabel = request
    ? `${labelFor(request.inspection)} · ${request.aoi ? "drawn area" : request.area} · ${request.executionMode}`
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-eikon-midnight">Remote Location Assessment</h1>
        <p className="text-sm text-eikon-muted">
          Run object detection across every satellite tile in an area and see where, and how densely,
          each object appears.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        {/* ---- Left: parameters + progress + summary ---- */}
        <div className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-eikon-midnight">Assessment parameters</h2>

            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Area of interest</span>
              <select
                value={aoiMode}
                onChange={(e) => setAoiMode(e.target.value)}
                className="w-full rounded border px-2 py-1.5"
              >
                {AOI_MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>

            {!isMapMode && (
              <label className="block text-sm">
                <span className="mb-1 block text-eikon-muted">Area</span>
                <select
                  value={areaName}
                  onChange={(e) => setAreaName(e.target.value)}
                  className="w-full rounded border px-2 py-1.5"
                >
                  {(UK_AREAS as string[]).map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
            )}

            {isMapMode && (
              <div className="space-y-1.5">
                <span className="block text-sm text-eikon-muted">Draw area of interest</span>
                <PolygonDrawMap onChange={setAoi} />
                <p className={`text-xs ${aoi ? "text-green-700" : "text-eikon-muted"}`}>
                  {aoi
                    ? `✓ Area captured — ${aoiKm2.toFixed(1)} km² will be assessed.`
                    : "Navigate the map, pick a tool (Polygon, Rectangle, or Circle), and draw the area to assess."}
                </p>
                {aoi && executionMode === "fast" && aoiKm2 > FAST_MODE_FULL_COVERAGE_KM2 && (
                  <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    Large area: fast mode will only assess a portion of it. Switch to standard for full
                    coverage.
                  </p>
                )}
              </div>
            )}

            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Object to look for</span>
              <select
                value={inspection}
                onChange={(e) => setInspection(e.target.value)}
                className="w-full rounded border px-2 py-1.5"
              >
                <option value={ALL_OBJECTS}>All objects</option>
                {OBJECT_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {labelFor(o)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Execution mode</span>
              <select
                value={executionMode}
                onChange={(e) => setExecutionMode(e.target.value as "fast" | "standard")}
                className="w-full rounded border px-2 py-1.5"
              >
                <option value="fast">Fast (recommended)</option>
                <option value="standard">Standard (full coverage)</option>
              </select>
              <span className="mt-1 block text-xs text-eikon-muted">
                {executionMode === "fast"
                  ? "Covers the whole area when it is small; for very large areas only the most likely cells are assessed."
                  : "Assesses every cell in the area. Slower, but complete."}
              </span>
            </label>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex-1 rounded bg-eikon-orange px-4 py-2 text-white disabled:opacity-50"
              >
                {isRunning ? "Assessing…" : "Run assessment"}
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

            {isRunning && (
              <>
                <button
                  type="button"
                  onClick={reset}
                  className="w-full rounded border px-4 py-2 text-sm text-eikon-midnight"
                >
                  Reset assessment lock
                </button>
                <p className="text-xs text-eikon-muted">
                  An assessment is already running. If you believe it has stalled or crashed, reset it
                  to start a new one.
                </p>
              </>
            )}
          </form>

          {isRunning && (
            <div className="space-y-2 rounded-lg border p-4">
              <div className="flex justify-between text-sm">
                <span className="text-eikon-midnight">
                  {detail || progress > 0 ? "Assessing locations…" : "Starting assessment…"}
                </span>
                <span className="font-semibold text-eikon-midnight">{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-eikon-panel">
                <div
                  className="h-full bg-eikon-orange transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {detail && (
                <p className="text-xs text-eikon-muted">
                  {detail.locationsDone.toLocaleString()} of {detail.locationsTotal.toLocaleString()}{" "}
                  locations
                  {detail.etaSeconds !== null && detail.etaSeconds > 0
                    ? ` · about ${formatDuration(detail.etaSeconds)} remaining`
                    : ""}
                </p>
              )}
              {requestLabel && <p className="text-xs text-eikon-muted">{requestLabel}</p>}
              {note && (
                <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{note}</p>
              )}
            </div>
          )}

          {isComplete && (
            <AssessmentSummary
              cells={visibleCells}
              objectName={selectedObject}
              requestLabel={requestLabel}
            />
          )}
        </div>

        {/* ---- Right: results ---- */}
        <div className="min-w-0">
          {error && (
            <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {error instanceof Error ? error.message : "Assessment failed"}
            </p>
          )}

          {isComplete ? (
            cells.length === 0 ? (
              <NoCellsState />
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b">
                  <div className="flex gap-2">
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

                  {/* Object selector — built from what the backend returned.
                      Hidden when only one class came back. */}
                  {objectStats.length > 1 && selectedObject && (
                    <label className="mb-2 flex items-center gap-2 text-sm">
                      <span className="text-eikon-muted">Show object</span>
                      <select
                        value={selectedObject}
                        onChange={(e) => setSelectedObject(e.target.value)}
                        className="rounded border px-2 py-1"
                      >
                        {objectStats.map((o) => (
                          <option key={o.name} value={o.name}>
                            {labelFor(o.name)} ({o.detected} of {o.assessed} cells)
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                {selectedObject && visibleCells.every((c) => c.coverage === 0) && (
                  <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    No {labelFor(selectedObject)} detected in any of the{" "}
                    {visibleCells.length.toLocaleString()} cells assessed. The map shows the extent that
                    was inspected.
                  </p>
                )}

                {view === "Heat Map" && (
                  <AssessmentHeatMap cells={visibleCells} aoi={request?.aoi ?? null} />
                )}
                {view === "Data Table" && (
                  <DataTable cells={visibleCells} objectName={selectedObject ?? "objects"} />
                )}
              </div>
            )
          ) : (
            !error && (
              <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-eikon-muted">
                {isRunning
                  ? "Assessing — the coverage heat map will appear here."
                  : "Choose an area and an object, then run the assessment."}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function NoCellsState() {
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-6 text-sm text-eikon-muted">
      <p className="font-semibold text-eikon-midnight">The assessment finished but returned no cells.</p>
      <p>
        Nothing was detected and no cells were reported for this area. If you drew a polygon, check it
        covers land inside the UK; otherwise try a different area, object, or the standard execution
        mode.
      </p>
    </div>
  );
}

function AssessmentSummary({
  cells,
  objectName,
  requestLabel,
}: {
  cells: RemoteAssessmentCell[];
  objectName: string | null;
  requestLabel: string | null;
}) {
  const stats = useMemo(() => {
    const assessed = new Set(cells.map((c) => c.locationId)).size;
    const detected = cells.filter((c) => c.coverage > 0);
    const objectArea = detected.reduce((s, c) => s + c.objectAreaKm2, 0);
    const assessedArea = cells.reduce((s, c) => s + c.cellAreaKm2, 0);
    const peak = detected.reduce((m, c) => (c.coverage > m ? c.coverage : m), 0);
    const mean = detected.length ? detected.reduce((s, c) => s + c.coverage, 0) / detected.length : 0;
    return { assessed, detected: detected.length, objectArea, assessedArea, peak, mean };
  }, [cells]);

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <h2 className="text-sm font-semibold text-eikon-midnight">
        Summary{objectName ? ` — ${labelFor(objectName)}` : ""}
      </h2>
      {requestLabel && <p className="text-xs text-eikon-muted">{requestLabel}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Stat label="Cells assessed" value={stats.assessed.toLocaleString()} />
        <Stat label="Cells with detections" value={stats.detected.toLocaleString()} />
        <Stat label="Area assessed" value={`${stats.assessedArea.toFixed(1)} km²`} />
        <Stat label="Object area found" value={`${stats.objectArea.toFixed(3)} km²`} />
        <Stat label="Peak cell coverage" value={pct(stats.peak)} />
        <Stat label="Mean coverage (detected)" value={pct(stats.mean)} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-eikon-muted">{label}</dt>
      <dd className="font-semibold text-eikon-midnight">{value}</dd>
    </div>
  );
}

function DataTable({ cells, objectName }: { cells: RemoteAssessmentCell[]; objectName: string }) {
  const [detectedOnly, setDetectedOnly] = useState(true);
  const rows = useMemo(() => {
    const filtered = detectedOnly ? cells.filter((c) => c.coverage > 0) : cells;
    return [...filtered].sort((a, b) => b.coverage - a.coverage);
  }, [cells, detectedOnly]);

  function downloadCsv() {
    const columns = Array.from(
      cells.reduce((set, c) => {
        Object.keys(c.raw).forEach((k) => set.add(k));
        return set;
      }, new Set<string>()),
    );
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((c) => columns.map((k) => esc(c.raw[k])).join(","));
    const csv = [columns.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `eikon_remote_assessment_${objectName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={downloadCsv} className="rounded border px-4 py-2 text-sm text-eikon-midnight">
          Download results (CSV)
        </button>
        <label className="flex items-center gap-2 text-sm text-eikon-muted">
          <input
            type="checkbox"
            checked={detectedOnly}
            onChange={(e) => setDetectedOnly(e.target.checked)}
          />
          Detections only
        </label>
        <span className="text-xs text-eikon-muted">{rows.length.toLocaleString()} rows</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-eikon-muted">No rows to show.</p>
      ) : (
        <div className="max-h-[520px] overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-eikon-panel text-left text-eikon-midnight">
              <tr>
                <th className="whitespace-nowrap px-3 py-2">Cell (H3)</th>
                <th className="whitespace-nowrap px-3 py-2">Object</th>
                <th className="whitespace-nowrap px-3 py-2">Coverage</th>
                <th className="whitespace-nowrap px-3 py-2">Model confidence</th>
                <th className="whitespace-nowrap px-3 py-2">Object area (km²)</th>
                <th className="whitespace-nowrap px-3 py-2">Cell area (km²)</th>
                <th className="whitespace-nowrap px-3 py-2">Lat</th>
                <th className="whitespace-nowrap px-3 py-2">Lon</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={`${c.locationId}-${c.objectName}`} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{c.locationId}</td>
                  <td className="whitespace-nowrap px-3 py-2">{labelFor(c.objectName)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{pct(c.coverage, 2)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatConfidence(c.meanModelConfidence)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{c.objectAreaKm2.toFixed(4)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{c.cellAreaKm2.toFixed(3)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{c.lat.toFixed(5)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{c.lon.toFixed(5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
