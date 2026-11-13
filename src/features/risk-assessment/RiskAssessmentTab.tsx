"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { area as turfArea } from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import { useRiskAssessment, type RiskResult } from "@/hooks/useRiskAssessment";
import { usePublishPageContext } from "@/hooks/usePageContext";
import { classifyRiskScores, riskScoreToColor } from "@/lib/geo/risk";
import { hexTooltip } from "@/lib/geo/hexTooltip";
import { fitView } from "@/lib/geo/mapFit";
import type { AssessmentCell } from "@/lib/geo/types";
import {
  aoiCellOwners,
  bufferAoiFeatures,
  bufferLabel,
  combineAoiFeatures,
  featureBounds,
  parseGeoJsonFile,
  pointCount,
  toGeodataframe,
  BUFFER_OPTIONS_M,
  GeoJsonAoiError,
  type AoiFeature,
} from "@/lib/geojsonAoi";
import type { Basemap, HexDatum } from "@/components/map/DroneMap";

// deck.gl / maplibre touch `window` — client-only.
const DroneMap = dynamic(() => import("@/components/map/DroneMap"), {
  ssr: false,
  loading: () => <div className="h-[540px] w-full animate-pulse rounded-lg bg-eikon-panel" />,
});
const PolygonDrawMap = dynamic(() => import("@/components/map/PolygonDrawMap"), {
  ssr: false,
  loading: () => <div className="h-[380px] w-full animate-pulse rounded-lg bg-eikon-panel" />,
});
const RiskLegend = dynamic(() => import("@/components/map/RiskLegend"), { ssr: false });

const MAP_MODE = "Map selection";
const UPLOAD_MODE = "GeoJSON upload";
const AOI_MODES = [MAP_MODE, UPLOAD_MODE];

const DEFAULT_CRITERIA = ["major industrial areas", "residential houses", "lots of buildings"];

/**
 * The country only moves the drawing map to the right part of the world — the
 * assessment route resolves the country from the AOI's own geometry, so an
 * uploaded file never depends on this being set correctly.
 */
const COUNTRIES = [
  { value: "uk", label: "United Kingdom", mapView: { longitude: -2.5, latitude: 54, zoom: 4.2 } },
  {
    value: "hongkong",
    label: "Hong Kong",
    mapView: { longitude: 114.15, latitude: 22.35, zoom: 9.5 },
  },
] as const;

type CountryValue = (typeof COUNTRIES)[number]["value"];

function countryDef(value: CountryValue) {
  return COUNTRIES.find((c) => c.value === value) ?? COUNTRIES[0];
}

/** Each cell is assessed individually, so a big AOI is a long job. */
const CELL_WARN = 15_000;
const CELL_LIMIT = 50_000;

const DRAWN_AOI_ID = "Drawn area";

const RESULT_VIEWS = ["Risk Map", "By Location", "Data Table"] as const;
type ResultView = (typeof RESULT_VIEWS)[number];

export function RiskAssessmentTab() {
  const { run, reset, isRunning, error, result } = useRiskAssessment();

  const [country, setCountry] = useState<CountryValue>("uk");
  const [aoiMode, setAoiMode] = useState(MAP_MODE);
  const [aoi, setAoi] = useState<Feature<Polygon> | null>(null);
  // The uploaded files are kept so the id column can be changed without
  // re-uploading; features are re-derived whenever that choice changes.
  const [uploadFiles, setUploadFiles] = useState<{ name: string; text: string }[]>([]);
  const [idKey, setIdKey] = useState("");
  const [bufferM, setBufferM] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [criteria, setCriteria] = useState<string[]>(DEFAULT_CRITERIA);
  const [view, setView] = useState<ResultView>("Risk Map");
  const [basemap, setBasemap] = useState<Basemap>("Dark");

  const isMapMode = aoiMode === MAP_MODE;
  const isUploadMode = aoiMode === UPLOAD_MODE;

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

  // What actually gets assessed: the drawn polygon, or the uploaded features
  // grown by the chosen buffer.
  const features: AoiFeature[] = useMemo(() => {
    if (isUploadMode) return bufferAoiFeatures(uploaded, bufferM);
    if (!aoi) return [];
    return [{ ...aoi, properties: { unique_id: DRAWN_AOI_ID } }];
  }, [isUploadMode, uploaded, bufferM, aoi]);

  const areaKm2 = useMemo(
    () => features.reduce((sum, f) => sum + turfArea(f) / 1e6, 0),
    [features],
  );
  // Enumerated once here: the count is shown before submitting, and the same
  // cells (and their owners) are what gets sent.
  const owners = useMemo(() => aoiCellOwners(features), [features]);
  const cells = useMemo(() => Array.from(owners.keys()), [owners]);

  // Offer the finished assessment to the Eikon AI panel. The score per cell is
  // the whole point of the tab and is what the map is a colouring of, so the
  // cells go up as rows; where an upload supplied several areas, the per-area
  // rollup goes too, since that is the comparison a user is usually making.
  usePublishPageContext(
    useMemo(() => {
      if (!result || result.assessment.length === 0) return null;
      const scores = result.assessment.map((c) => Number(c.cum_score)).filter(Number.isFinite);
      const byLocation = rollupByLocation(result.assessment, result.owners);
      const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
      return {
        tab: "Risk Assessment",
        params: {
          Country: countryLabel(result.country),
          "Assessment criteria": result.criteria.join(", "),
          "Area of interest": isUploadMode ? "uploaded file" : "a polygon drawn on the map",
          "Area (km2)": areaKm2 ? Number(areaKm2.toFixed(3)) : undefined,
        },
        stats: {
          "Cells assessed": scores.length,
          "Mean risk score": Number(mean.toFixed(4)),
          "Min risk score": scores.length ? Number(Math.min(...scores).toFixed(4)) : undefined,
          "Max risk score": scores.length ? Number(Math.max(...scores).toFixed(4)) : undefined,
          "Areas in this run": byLocation.length > 1 ? byLocation.length : undefined,
        },
        table: {
          columns: ["h3_index_9", "cum_score", "area"],
          // Worst first: a question about an area is usually about its worst
          // part, and that is also what survives if the budget trims the tail.
          rows: [...result.assessment]
            .sort((a, b) => Number(b.cum_score) - Number(a.cum_score))
            .map((c) => [
              c.h3_index_9,
              Number(c.cum_score),
              result.owners.get(c.h3_index_9) ?? undefined,
            ]),
        },
        notes:
          byLocation.length > 1
            ? [
                "Per-area rollup (area: cells, mean, max) — " +
                  byLocation
                    .map(
                      (l) =>
                        `${l.uniqueId}: ${l.cells} cells, mean ${l.meanScore.toFixed(3)}, max ${l.maxScore.toFixed(3)}`,
                    )
                    .join("; "),
              ]
            : [],
      };
    }, [result, isUploadMode, areaKm2]),
  );

  const validCriteria = criteria.some((c) => c.trim());
  const overLimit = cells.length > CELL_LIMIT;
  const canSubmit = !isRunning && features.length > 0 && validCriteria && !overLimit;

  function onAssess() {
    const bounds = featureBounds(features);
    run({
      h3Cells: cells,
      criteria: criteria.map((c) => c.trim()).filter(Boolean),
      geodataframe: toGeodataframe(features),
      country,
      owners,
      bounds: bounds
        ? [
            [bounds.minLon, bounds.minLat],
            [bounds.maxLon, bounds.maxLat],
          ]
        : [],
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-eikon-midnight">Risk Assessment</h1>
        <p className="text-sm text-eikon-muted">
          Risk scores for every cell in an area of interest.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        {/* ---- Left: inputs ---- */}
        <div className="space-y-4">
          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-eikon-midnight">Area of interest</h2>

            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Country</span>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value as CountryValue)}
                className="w-full rounded border px-2 py-1.5"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Source</span>
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

            {isMapMode && (
              <div className="space-y-1.5">
                <span className="block text-sm text-eikon-muted">Area</span>
                <PolygonDrawMap
                  key={country}
                  onChange={setAoi}
                  initialView={countryDef(country).mapView}
                />
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
                        {uploaded.length === 1 ? "" : "s"}
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

            {features.length > 0 && (
              <p className="text-xs text-green-700">
                {areaKm2.toFixed(1)} km² · {cells.length.toLocaleString()} cells
              </p>
            )}
          </div>

          <CriteriaEditor criteria={criteria} onChange={setCriteria} />

          <button
            onClick={onAssess}
            disabled={!canSubmit}
            className="w-full rounded bg-eikon-accent px-4 py-2 text-white disabled:opacity-50"
          >
            {isRunning ? "Assessing…" : "Run assessment"}
          </button>
          {isRunning && (
            <button
              onClick={reset}
              className="w-full rounded border px-4 py-2 text-sm text-eikon-midnight"
            >
              Reset assessment lock
            </button>
          )}
          {overLimit && (
            <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">
              {cells.length.toLocaleString()} cells is over the {CELL_LIMIT.toLocaleString()}-cell
              limit. Reduce the area or the buffer.
            </p>
          )}
          {!overLimit && cells.length > CELL_WARN && (
            <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {cells.length.toLocaleString()} cells — this will take several minutes.
            </p>
          )}
          {!validCriteria && (
            <p className="text-xs text-amber-600">
              Please provide at least one assessment criterion.
            </p>
          )}
        </div>

        {/* ---- Right: results ---- */}
        <div className="min-w-0 space-y-4">
          {isRunning && (
            <div className="flex items-center gap-3 rounded-lg border bg-amber-50 p-3 text-sm text-amber-800">
              <span className="h-3 w-3 animate-ping rounded-full bg-amber-500" />
              Running risk assessment — this may take several minutes…
            </div>
          )}
          {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {result ? (
            <Results
              result={result}
              view={view}
              onView={setView}
              basemap={basemap}
              onBasemap={setBasemap}
            />
          ) : (
            !isRunning &&
            !error && (
              <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-eikon-muted" />
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Results({
  result,
  view,
  onView,
  basemap,
  onBasemap,
}: {
  result: RiskResult;
  view: ResultView;
  onView: (v: ResultView) => void;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
}) {
  const { assessment, owners, bounds, country } = result;
  const [showChoropleth, setShowChoropleth] = useState(true);

  // Risk classification (natural breaks) → per-hex colour, exactly as the
  // corridor map colours its cells.
  const { hexes, classColors, binEdges, stats } = useMemo(() => {
    const scores = assessment.map((c) => Number(c.cum_score));
    const maxScore = Math.max(...scores, 0.01);
    const cls = classifyRiskScores(scores, 5);
    const hexes: HexDatum[] = assessment.map((c, i) => ({
      h3_index: c.h3_index_9,
      color:
        cls.kActual > 0
          ? cls.classColors[cls.classLabels[i]]
          : riskScoreToColor(scores[i], maxScore),
      tooltip: hexTooltip(c.h3_index_9, scores[i], c.objects_detected),
    }));
    const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return {
      hexes,
      classColors: cls.classColors,
      binEdges: cls.binEdges,
      stats: {
        maxScore: scores.length ? Math.max(...scores) : 0,
        meanScore: mean,
        cells: scores.length,
      },
    };
  }, [assessment]);

  // Framed on the AOI's own bounds; the assessed cells can only sit inside it.
  const center = useMemo(() => fitView(bounds), [bounds]);
  const locations = useMemo(() => rollupByLocation(assessment, owners), [assessment, owners]);
  const perLocation = locations.length > 1;
  const views = RESULT_VIEWS.filter((v) => v !== "By Location" || perLocation);

  if (assessment.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-eikon-muted">
        <p className="font-semibold text-eikon-midnight">No cells were returned for this area.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Cells Assessed" value={stats.cells.toLocaleString()} />
        <Metric label="Mean Risk" value={stats.meanScore.toFixed(3)} />
        <Metric label="Max Risk" value={stats.maxScore.toFixed(3)} />
        <Metric label="Country" value={countryLabel(country)} />
      </div>

      <div className="flex gap-2 border-b">
        {views.map((v) => (
          <button
            key={v}
            onClick={() => onView(v)}
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

      {view === "Risk Map" && (
        <div className="grid gap-3 lg:grid-cols-[4fr_1fr]">
          <DroneMap
            hexes={showChoropleth ? hexes : []}
            markers={[]}
            center={center}
            basemap={basemap}
          />
          <RiskLegend
            binEdges={binEdges}
            classColors={classColors}
            maxScore={stats.maxScore}
            basemap={basemap}
            onBasemap={onBasemap}
            showChoropleth={showChoropleth}
            onToggleChoropleth={() => setShowChoropleth((v) => !v)}
          />
        </div>
      )}

      {view === "By Location" && perLocation && <LocationTable locations={locations} />}
      {view === "Data Table" && (
        <DataTable assessment={assessment} owners={owners} withLocation={perLocation} />
      )}
    </div>
  );
}

interface LocationRollup {
  uniqueId: string;
  cells: number;
  meanScore: number;
  maxScore: number;
  minScore: number;
}

/** One row per uploaded location, from the cells attributed to it. */
function rollupByLocation(
  assessment: AssessmentCell[],
  owners: Map<string, string>,
): LocationRollup[] {
  const groups = new Map<string, number[]>();
  for (const cell of assessment) {
    const id = owners.get(cell.h3_index_9);
    if (!id) continue;
    const scores = groups.get(id) ?? [];
    scores.push(Number(cell.cum_score));
    groups.set(id, scores);
  }
  return Array.from(groups.entries())
    .map(([uniqueId, scores]) => ({
      uniqueId,
      cells: scores.length,
      meanScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      maxScore: Math.max(...scores),
      minScore: Math.min(...scores),
    }))
    .sort((a, b) => b.meanScore - a.meanScore);
}

function LocationTable({ locations }: { locations: LocationRollup[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-eikon-panel text-left text-eikon-midnight">
          <tr>
            <th className="px-3 py-2">Location</th>
            <th className="px-3 py-2">Cells</th>
            <th className="px-3 py-2">Mean Risk</th>
            <th className="px-3 py-2">Max Risk</th>
            <th className="px-3 py-2">Min Risk</th>
          </tr>
        </thead>
        <tbody>
          {locations.map((l) => (
            <tr key={l.uniqueId} className="border-t">
              <td className="px-3 py-2 font-mono">{l.uniqueId}</td>
              <td className="px-3 py-2">{l.cells.toLocaleString()}</td>
              <td className="px-3 py-2">{l.meanScore.toFixed(3)}</td>
              <td className="px-3 py-2">{l.maxScore.toFixed(3)}</td>
              <td className="px-3 py-2">{l.minScore.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rows shown on screen; the CSV carries every cell. */
const TABLE_ROW_LIMIT = 200;

function DataTable({
  assessment,
  owners,
  withLocation,
}: {
  assessment: AssessmentCell[];
  owners: Map<string, string>;
  /** The location column is dropped when every cell belongs to the same AOI. */
  withLocation: boolean;
}) {
  // Every raw column the assessment endpoint returned, across all cells.
  const columns = Array.from(
    assessment.reduce((set, c) => {
      Object.keys(c).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  );

  const ranked = useMemo(
    () => [...assessment].sort((a, b) => Number(b.cum_score) - Number(a.cum_score)),
    [assessment],
  );

  function downloadCsv() {
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [...(withLocation ? ["unique_id"] : []), ...columns];
    const lines = assessment.map((c) =>
      [
        ...(withLocation ? [esc(owners.get(c.h3_index_9) ?? "")] : []),
        ...columns.map((k) => esc(c[k])),
      ].join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "risk_assessment_all.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-eikon-panel text-left text-eikon-midnight">
            <tr>
              <th className="px-3 py-2">Cell</th>
              {withLocation && <th className="px-3 py-2">Location</th>}
              <th className="px-3 py-2">Risk Score</th>
            </tr>
          </thead>
          <tbody>
            {ranked.slice(0, TABLE_ROW_LIMIT).map((c) => (
              <tr key={c.h3_index_9} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{c.h3_index_9}</td>
                {withLocation && <td className="px-3 py-2">{owners.get(c.h3_index_9) ?? "—"}</td>}
                <td className="px-3 py-2">{Number(c.cum_score).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {assessment.length > TABLE_ROW_LIMIT && (
        <p className="text-xs text-eikon-muted">
          Highest {TABLE_ROW_LIMIT} of {assessment.length.toLocaleString()} cells.
        </p>
      )}
      <button onClick={downloadCsv} className="rounded border px-4 py-2 text-sm text-eikon-midnight">
        Download all data (CSV) — {assessment.length.toLocaleString()} cells
      </button>
    </div>
  );
}

function CriteriaEditor({
  criteria,
  onChange,
}: {
  criteria: string[];
  onChange: (c: string[]) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <h2 className="text-sm font-semibold text-eikon-midnight">Assessment Criteria</h2>
      {criteria.map((c, i) => (
        <input
          key={i}
          value={c}
          onChange={(e) => onChange(criteria.map((v, j) => (j === i ? e.target.value : v)))}
          placeholder={`Criterion ${i + 1}`}
          className="w-full rounded border px-2 py-1.5 text-sm"
        />
      ))}
      <div className="flex gap-2">
        {criteria.length < 10 && (
          <button
            onClick={() => onChange([...criteria, ""])}
            className="rounded border px-3 py-1 text-sm text-eikon-midnight"
          >
            Add criterion
          </button>
        )}
        {criteria.length > 1 && (
          <button
            onClick={() => onChange(criteria.slice(0, -1))}
            className="rounded border px-3 py-1 text-sm text-eikon-midnight"
          >
            Delete criterion
          </button>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-eikon-panel p-3 text-center">
      <div className="text-xs uppercase tracking-wide text-eikon-muted">{label}</div>
      <div className="mt-1 text-xl font-bold text-eikon-midnight">{value}</div>
    </div>
  );
}

/** The resolved country as the UI names it, or the raw value if it is new. */
function countryLabel(country: string): string {
  return COUNTRIES.find((c) => c.value === country)?.label ?? country;
}
