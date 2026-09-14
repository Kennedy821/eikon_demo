"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { area as turfArea } from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import { useRemoteAssessment } from "@/hooks/useRemoteAssessment";
import type { RemoteAssessmentCell } from "@/lib/types";
import {
  parseGeoJsonFile,
  combineAoiFeatures,
  bufferAoiFeatures,
  bufferLabel,
  pointCount,
  BUFFER_OPTIONS_M,
  POINT_RADIUS_M,
  GeoJsonAoiError,
  type AoiFeature,
} from "@/lib/geojsonAoi";
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
const UPLOAD_MODE = "GeoJSON upload";
const AOI_MODES = [AREA_MODE, MAP_MODE, UPLOAD_MODE];
const ALL_OBJECTS = "all";
// Object classes the remote verification backend currently supports. Kept
// deliberately short — the full DETECTABLE_OBJECTS list belongs to the
// per-tile object-detection endpoint, not this one.
const OBJECT_OPTIONS = [
  "solar_panels",
  "industrial_buildings",
  "motorway",
  "railway_line",
  "lake",
  "parking_lot",
  "tennis_court",
  "wind_turbine",
  "electricity_pylon",
];
const RESULT_VIEWS = ["Heat Map", "By Location", "Data Table"] as const;
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
  // The uploaded files are kept so the id column can be changed without
  // re-uploading; features are re-derived whenever that choice changes.
  const [uploadFiles, setUploadFiles] = useState<{ name: string; text: string }[]>([]);
  const [idKey, setIdKey] = useState("");
  const [bufferM, setBufferM] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const isUploadMode = aoiMode === UPLOAD_MODE;
  const aoiKm2 = useMemo(() => (aoi ? turfArea(aoi) / 1e6 : 0), [aoi]);
  // Each uploaded file is parsed and concatenated, the equivalent of
  // gp.read_file(...) per file followed by pd.concat.
  async function onFilesChosen(files: FileList | null) {
    if (!files || files.length === 0) return;
    setIdKey("");
    setUploadFiles(
      await Promise.all(
        Array.from(files).map(async (f) => ({ name: f.name, text: await f.text() })),
      ),
    );
  }

  function clearUpload() {
    setUploadFiles([]);
    setIdKey("");
    setBufferM(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const parsedUpload = useMemo(() => {
    if (uploadFiles.length === 0) return null;
    try {
      const combined = combineAoiFeatures(
        uploadFiles.map((f) => parseGeoJsonFile(f.text, f.name, idKey || null)),
      );
      return { ...combined, error: null as string | null };
    } catch (err) {
      return {
        features: [] as AoiFeature[],
        warnings: [] as string[],
        convertedCounts: {} as Record<string, number>,
        propertyKeys: [] as string[],
        error:
          err instanceof GeoJsonAoiError || err instanceof Error
            ? err.message
            : "Could not read that file.",
      };
    }
  }, [uploadFiles, idKey]);

  const uploaded = parsedUpload?.features ?? [];
  const uploadWarnings = parsedUpload?.warnings ?? [];
  const uploadError = parsedUpload?.error ?? null;
  const uploadedPoints = pointCount(parsedUpload?.convertedCounts ?? {});
  const idKeyOptions = parsedUpload?.propertyKeys ?? [];

  // What actually gets sent: the parsed features grown by the chosen buffer.
  const uploadedBuffered = useMemo(
    () => bufferAoiFeatures(uploaded, bufferM),
    [uploaded, bufferM],
  );
  const uploadedKm2 = useMemo(
    () => uploadedBuffered.reduce((sum, f) => sum + turfArea(f) / 1e6, 0),
    [uploadedBuffered],
  );
  const canSubmit =
    !isRunning && (!isMapMode || !!aoi) && (!isUploadMode || uploaded.length > 0);


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
      area: isMapMode || isUploadMode ? null : areaName,
      aoi: isMapMode ? aoi : null,
      uploaded: isUploadMode ? uploadedBuffered : null,
      bufferM: isUploadMode ? bufferM : 0,
    });
  }

  // Outlines for whichever custom AOI produced these results.
  const aoiOutlines = useMemo<AoiFeature[] | null>(() => {
    if (request?.uploaded?.length) return request.uploaded;
    if (request?.aoi) {
      return [
        {
          type: "Feature",
          properties: { unique_id: "aoi_1" },
          geometry: request.aoi.geometry,
        },
      ];
    }
    return null;
  }, [request]);

  // Per-location rollup for uploaded AOIs, keyed by the backend's unique_id.
  // Every uploaded location is seeded first, so one with no rows for the
  // selected object still appears with zeros rather than vanishing from the
  // results — the count always matches what the user uploaded.
  const uploadedIds = useMemo(
    () => (request?.uploaded ?? []).map((f) => f.properties.unique_id),
    [request],
  );

  const locationStats = useMemo(
    () => rollUpByLocation(visibleCells, uploadedIds),
    [visibleCells, uploadedIds],
  );

  const requestScope = request
    ? request.uploaded?.length
      ? `${request.uploaded.length} uploaded location${request.uploaded.length === 1 ? "" : "s"}${
          request.bufferM ? ` · ${bufferLabel(request.bufferM)} buffer` : ""
        }`
      : request.aoi
        ? "drawn area"
        : (request.area ?? "")
    : "";
  const requestLabel = request
    ? `${labelFor(request.inspection)} · ${requestScope} · ${request.executionMode}`
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-eikon-midnight">Remote Visual Inspection</h1>
        <p className="text-sm text-eikon-muted">Object coverage across an area of interest.</p>
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

            {!isMapMode && !isUploadMode && (
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
                <span className="block text-sm text-eikon-muted">Area</span>
                <PolygonDrawMap onChange={setAoi} />
                {aoi && (
                  <p className="text-xs text-green-700">{aoiKm2.toFixed(1)} km²</p>
                )}
                {aoi && executionMode === "fast" && aoiKm2 > FAST_MODE_FULL_COVERAGE_KM2 && (
                  <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    Fast mode will only assess part of an area this size.
                  </p>
                )}
              </div>
            )}

            {isUploadMode && (
              <div className="space-y-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-eikon-muted">GeoJSON file(s)</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".geojson,.json,application/geo+json,application/json"
                    multiple
                    onChange={(e) => onFilesChosen(e.target.files)}
                    className="w-full rounded border px-2 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-eikon-panel file:px-3 file:py-1 file:text-sm file:text-eikon-midnight"
                  />
                </label>

                {uploadError && (
                  <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{uploadError}</p>
                )}

                {uploaded.length > 0 && (
                  <div className="rounded border p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-eikon-midnight">
                        {uploaded.length.toLocaleString()} location
                        {uploaded.length === 1 ? "" : "s"} · {uploadedKm2.toFixed(1)} km²
                      </span>
                      <button
                        type="button"
                        onClick={clearUpload}
                        className="text-xs text-eikon-muted underline"
                      >
                        Clear
                      </button>
                    </div>
                    <ul className="mt-1 max-h-28 overflow-auto text-xs text-eikon-muted">
                      {uploaded.map((f) => (
                        <li key={f.properties.unique_id} className="truncate font-mono">
                          {f.properties.unique_id}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {uploaded.length > 0 && idKeyOptions.length > 0 && (
                  <label className="block text-sm">
                    <span className="mb-1 block text-eikon-muted">Location ID column</span>
                    <select
                      value={idKey}
                      onChange={(e) => setIdKey(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    >
                      <option value="">Automatic</option>
                      {idKeyOptions.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {uploaded.length > 0 && (
                  <label className="block text-sm">
                    <span className="mb-1 block text-eikon-muted">Buffer</span>
                    <select
                      value={bufferM}
                      onChange={(e) => setBufferM(Number(e.target.value))}
                      className="w-full rounded border px-2 py-1.5"
                    >
                      {BUFFER_OPTIONS_M.map((mtr) => (
                        <option key={mtr} value={mtr}>
                          {bufferLabel(mtr)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {uploadedPoints > 0 && (
                  <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    {uploadedPoints} point{uploadedPoints === 1 ? "" : "s"} assessed
                    {bufferM > 0 ? ` · ${bufferLabel(bufferM)} buffer` : ""}
                  </p>
                )}

                {uploadWarnings.map((w) => (
                  <p key={w} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    {w}
                  </p>
                ))}
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
                <option value="fast">Fast</option>
                <option value="standard">Standard</option>
              </select>
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
              </>
            )}
          </form>

          {isRunning && (
            <div className="space-y-2 rounded-lg border p-4">
              <div className="flex justify-between text-sm">
                <span className="text-eikon-midnight">
                  {detail || progress > 0 ? "Assessing tiles…" : "Starting assessment…"}
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
                  tiles
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
                    {RESULT_VIEWS.filter(
                      (v) => v !== "By Location" || locationStats.length > 0,
                    ).map((v) => (
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
                            {labelFor(o.name)} ({o.detected} of {o.assessed} tiles)
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                {selectedObject && visibleCells.length > 0 && visibleCells.every((c) => c.coverage === 0) && (
                  <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    No {labelFor(selectedObject)} detected in the {visibleCells.length.toLocaleString()}{" "}
                    tiles assessed.
                  </p>
                )}

                {view === "Heat Map" && (
                  <AssessmentHeatMap
                    cells={visibleCells}
                    aoi={aoiOutlines}
                    pointRadiusM={request?.bufferM || POINT_RADIUS_M}
                  />
                )}
                {view === "By Location" && locationStats.length > 0 && (
                  <LocationBreakdown
                    stats={locationStats}
                    objectName={selectedObject}
                    allCells={cells}
                    uploadedIds={uploadedIds}
                  />
                )}
                {view === "Data Table" && (
                  <DataTable
                    cells={visibleCells}
                    allCells={cells}
                    objectName={selectedObject ?? "objects"}
                    objectCount={objectStats.length}
                    showUniqueId={locationStats.length > 0}
                    uploadedIds={uploadedIds}
                  />
                )}
              </div>
            )
          ) : (
            !error && (
              <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-eikon-muted">
                {isRunning ? "Assessing…" : ""}
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
      <p className="font-semibold text-eikon-midnight">No tiles were returned for this area.</p>
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
        <Stat label="Tiles assessed" value={stats.assessed.toLocaleString()} />
        <Stat label="Tiles with detections" value={stats.detected.toLocaleString()} />
        <Stat label="Area assessed" value={`${stats.assessedArea.toFixed(1)} km²`} />
        <Stat label="Object area found" value={`${stats.objectArea.toFixed(3)} km²`} />
        <Stat label="Peak tile coverage" value={pct(stats.peak)} />
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

/** Serialise cells to CSV using the union of their raw backend columns. */
function cellsToCsv(cells: RemoteAssessmentCell[]): string {
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
  const lines = cells.map((c) => columns.map((k) => esc(c.raw[k])).join(","));
  return [columns.join(","), ...lines].join("\n");
}

function downloadCsvFile(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Per-uploaded-location rollup — one row per unique_id from the GeoJSON. */
interface LocationStat {
  uniqueId: string;
  cells: number;
  detected: number;
  objectAreaKm2: number;
  peak: number;
}

/** Roll cells up per location, seeding every uploaded id so none is missing. */
function rollUpByLocation(cells: RemoteAssessmentCell[], seedIds: string[]): LocationStat[] {
  const byId: Record<string, LocationStat> = {};
  for (const id of seedIds) {
    byId[id] = { uniqueId: id, cells: 0, detected: 0, objectAreaKm2: 0, peak: 0 };
  }
  for (const c of cells) {
    if (!c.uniqueId) continue;
    const st =
      byId[c.uniqueId] ??
      ({ uniqueId: c.uniqueId, cells: 0, detected: 0, objectAreaKm2: 0, peak: 0 } as LocationStat);
    st.cells += 1;
    if (c.coverage > 0) st.detected += 1;
    st.objectAreaKm2 += c.objectAreaKm2;
    if (c.coverage > st.peak) st.peak = c.coverage;
    byId[c.uniqueId] = st;
  }
  return Object.values(byId).sort(
    (a, b) => b.objectAreaKm2 - a.objectAreaKm2 || a.uniqueId.localeCompare(b.uniqueId),
  );
}

function LocationBreakdown({
  stats,
  objectName,
  allCells,
  uploadedIds,
}: {
  stats: LocationStat[];
  objectName: string | null;
  /** Every cell returned, across all object classes. */
  allCells: RemoteAssessmentCell[];
  /** Ids of every uploaded location, so none is missing from the export. */
  uploadedIds: string[];
}) {
  const totals = stats.reduce(
    (acc, s) => ({
      cells: acc.cells + s.cells,
      detected: acc.detected + s.detected,
      objectAreaKm2: acc.objectAreaKm2 + s.objectAreaKm2,
    }),
    { cells: 0, detected: 0, objectAreaKm2: 0 },
  );

  const areaHeader = objectName ? `${labelFor(objectName)} area (km2)` : "object area (km2)";

  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };

  const statRow = (s: LocationStat) => [
    s.uniqueId,
    s.cells,
    s.detected,
    s.objectAreaKm2.toFixed(6),
    s.peak.toFixed(6),
  ];

  // The table as shown: the selected object only.
  function downloadCsv() {
    const header = ["location", "tiles", "tiles_with_detections", areaHeader, "peak_tile_coverage"];
    const lines = stats.map((s) => statRow(s).map(esc).join(","));
    downloadCsvFile(
      [header.map(esc).join(","), ...lines].join("\n"),
      `eikon_remote_assessment_by_location_${objectName ?? "objects"}.csv`,
    );
  }

  // Every object class the assessment returned, one row per location per
  // class, with every uploaded location present even where nothing was found.
  function downloadAllCsv() {
    const objectNames = Array.from(new Set(allCells.map((c) => c.objectName))).sort();
    const header = [
      "location",
      "object",
      "tiles",
      "tiles_with_detections",
      "object_area_km2",
      "peak_tile_coverage",
    ];
    const lines: string[] = [];
    for (const name of objectNames) {
      const rolled = rollUpByLocation(
        allCells.filter((c) => c.objectName === name),
        uploadedIds,
      );
      for (const s of rolled) {
        const [loc, ...rest] = statRow(s);
        lines.push([loc, name, ...rest].map(esc).join(","));
      }
    }
    downloadCsvFile(
      [header.map(esc).join(","), ...lines].join("\n"),
      "eikon_remote_assessment_by_location_all.csv",
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={downloadCsv}
          className="rounded border px-4 py-2 text-sm text-eikon-midnight"
        >
          Download by location (CSV)
        </button>
        <button
          onClick={downloadAllCsv}
          className="rounded border px-4 py-2 text-sm text-eikon-midnight"
        >
          Download all data by location (CSV)
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-eikon-panel text-left text-eikon-midnight">
          <tr>
            <th className="whitespace-nowrap px-3 py-2">Location</th>
            <th className="whitespace-nowrap px-3 py-2">Tiles</th>
            <th className="whitespace-nowrap px-3 py-2">With detections</th>
            <th className="whitespace-nowrap px-3 py-2">
              {objectName ? `${labelFor(objectName)} area (km²)` : "Object area (km²)"}
            </th>
            <th className="whitespace-nowrap px-3 py-2">Peak tile coverage</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.uniqueId} className="border-t">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{s.uniqueId}</td>
              <td className="whitespace-nowrap px-3 py-2">{s.cells.toLocaleString()}</td>
              <td className="whitespace-nowrap px-3 py-2">{s.detected.toLocaleString()}</td>
              <td className="whitespace-nowrap px-3 py-2">{s.objectAreaKm2.toFixed(4)}</td>
              <td className="whitespace-nowrap px-3 py-2">{pct(s.peak, 2)}</td>
            </tr>
          ))}
        </tbody>
        {stats.length > 1 && (
          <tfoot>
            <tr className="border-t bg-eikon-panel font-semibold text-eikon-midnight">
              <td className="whitespace-nowrap px-3 py-2">Total</td>
              <td className="whitespace-nowrap px-3 py-2">{totals.cells.toLocaleString()}</td>
              <td className="whitespace-nowrap px-3 py-2">{totals.detected.toLocaleString()}</td>
              <td className="whitespace-nowrap px-3 py-2">{totals.objectAreaKm2.toFixed(4)}</td>
              <td className="whitespace-nowrap px-3 py-2" />
            </tr>
          </tfoot>
        )}
        </table>
      </div>
    </div>
  );
}

/**
 * A stand-in row for an uploaded location the backend returned nothing for.
 * Without it such a location would vanish from the table entirely, so the row
 * count would not match what was uploaded.
 */
function placeholderCell(uniqueId: string, objectName: string): RemoteAssessmentCell {
  return {
    locationId: "",
    objectName,
    coverage: 0,
    lat: 0,
    lon: 0,
    cellAreaKm2: 0,
    objectAreaKm2: 0,
    meanModelConfidence: null,
    uniqueId,
    raw: {
      unique_id: uniqueId,
      name: objectName,
      clean_pct_float: 0,
      area_of_objects_found_km_2: 0,
    },
  };
}

/** Append a zero row for every uploaded location missing from `cells`. */
function withMissingLocations(
  cells: RemoteAssessmentCell[],
  uploadedIds: string[],
  objectName: string,
): RemoteAssessmentCell[] {
  if (uploadedIds.length === 0) return cells;
  const present = new Set(cells.map((c) => c.uniqueId).filter(Boolean));
  const missing = uploadedIds.filter((id) => !present.has(id));
  if (missing.length === 0) return cells;
  return [...cells, ...missing.map((id) => placeholderCell(id, objectName))];
}

function DataTable({
  cells,
  allCells,
  objectName,
  objectCount,
  showUniqueId,
  uploadedIds,
}: {
  cells: RemoteAssessmentCell[];
  /** Every cell returned by the assessment, across all object classes. */
  allCells: RemoteAssessmentCell[];
  objectName: string;
  objectCount: number;
  /** Uploaded-AOI jobs carry a unique_id per row; show it as the first column. */
  showUniqueId: boolean;
  /** Ids of every uploaded location, so none is missing from the table. */
  uploadedIds: string[];
}) {
  const [detectedOnly, setDetectedOnly] = useState(true);

  // Uploaded locations the backend returned no rows for still belong in the
  // table at 0%, so turning off "Detections only" always shows every location.
  const cellsWithMissing = useMemo(
    () => withMissingLocations(cells, uploadedIds, objectName),
    [cells, uploadedIds, objectName],
  );

  const rows = useMemo(() => {
    const filtered = detectedOnly
      ? cellsWithMissing.filter((c) => c.coverage > 0)
      : cellsWithMissing;
    return [...filtered].sort((a, b) => b.coverage - a.coverage);
  }, [cellsWithMissing, detectedOnly]);

  // The table's current view: selected object, honouring the detections filter.
  function downloadCsv() {
    downloadCsvFile(cellsToCsv(rows), `eikon_remote_assessment_${objectName}.csv`);
  }

  const missingCount = cellsWithMissing.length - cells.length;

  // Everything the assessment returned: every cell, every object class,
  // regardless of the selected object or the detections filter.
  function downloadAllCsv() {
    const names = Array.from(new Set(allCells.map((c) => c.objectName))).sort();
    const completed = names.flatMap((name) =>
      withMissingLocations(
        allCells.filter((c) => c.objectName === name),
        uploadedIds,
        name,
      ),
    );
    const sorted = completed.sort(
      (a, b) => a.objectName.localeCompare(b.objectName) || b.coverage - a.coverage,
    );
    downloadCsvFile(cellsToCsv(sorted), "eikon_remote_assessment_all.csv");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={downloadCsv} className="rounded border px-4 py-2 text-sm text-eikon-midnight">
          Download results (CSV)
        </button>
        <button
          onClick={downloadAllCsv}
          className="rounded border px-4 py-2 text-sm text-eikon-midnight"
        >
          Download all data (CSV)
          {objectCount > 1 ? ` — ${allCells.length.toLocaleString()} rows` : ""}
        </button>
        <label className="flex items-center gap-2 text-sm text-eikon-muted">
          <input
            type="checkbox"
            checked={detectedOnly}
            onChange={(e) => setDetectedOnly(e.target.checked)}
          />
          Detections only
        </label>
        <span className="text-xs text-eikon-muted">
          {rows.length.toLocaleString()} rows
          {!detectedOnly && missingCount > 0
            ? ` · ${missingCount.toLocaleString()} with no result`
            : ""}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-eikon-muted">No rows to show.</p>
      ) : (
        <div className="max-h-[520px] overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-eikon-panel text-left text-eikon-midnight">
              <tr>
                {showUniqueId && <th className="whitespace-nowrap px-3 py-2">Location</th>}
                <th className="whitespace-nowrap px-3 py-2">Tile</th>
                <th className="whitespace-nowrap px-3 py-2">Object</th>
                <th className="whitespace-nowrap px-3 py-2">Coverage</th>
                <th className="whitespace-nowrap px-3 py-2">Model confidence</th>
                <th className="whitespace-nowrap px-3 py-2">Object area (km²)</th>
                <th className="whitespace-nowrap px-3 py-2">Tile area (km²)</th>
                <th className="whitespace-nowrap px-3 py-2">Lat</th>
                <th className="whitespace-nowrap px-3 py-2">Lon</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={`${c.uniqueId ?? ""}-${c.locationId || "none"}-${c.objectName}`}
                  className="border-t"
                >
                  {showUniqueId && (
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                      {c.uniqueId ?? ""}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    {c.locationId || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{labelFor(c.objectName)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{pct(c.coverage, 2)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatConfidence(c.meanModelConfidence)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{c.objectAreaKm2.toFixed(4)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {c.locationId ? c.cellAreaKm2.toFixed(3) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {c.locationId ? c.lat.toFixed(5) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {c.locationId ? c.lon.toFixed(5) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
