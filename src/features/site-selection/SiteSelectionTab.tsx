"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { area as turfArea } from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import {
  COUNTRIES,
  countriesByRegion,
  countryByValue,
  type CountryValue,
} from "@/lib/countries";
import {
  useSiteSelection,
  type SiteSelectionResult,
} from "@/hooks/useSiteSelection";
import { usePublishPageContext } from "@/hooks/usePageContext";
import {
  CATCHMENT_KRING_OPTIONS,
  CATCHMENT_LABELS,
  CATCHMENT_MODES,
  MAP_SCOPE,
  MAX_CRITERIA,
  RANK_COLUMN,
  MAX_WEIGHT_TOTAL,
  UPLOAD_SCOPE,
  catchmentLabel,
  catchmentProblem,
  hasWeighting,
  newCriterion,
  numericValues,
  weightTotal,
  weightingProblem,
  type CatchmentMode,
  type Criterion,
} from "@/lib/siteSelection";
import { classifyRiskScores, riskScoreToColor } from "@/lib/geo/risk";
import { fitView } from "@/lib/geo/mapFit";
import {
  aoiCellOwners,
  bufferAoiFeatures,
  bufferLabel,
  combineAoiFeatures,
  featureBounds,
  parseGeoJsonFile,
  pointCount,
  BUFFER_OPTIONS_M,
  GeoJsonAoiError,
  type AoiFeature,
} from "@/lib/geojsonAoi";
import type { Basemap, HexDatum } from "@/components/map/DroneMap";
import UK_AREAS from "@/content/uk_areas.json";
import { Envelope, type EnvelopeTone } from "@/components/layout/Envelope";
import { useCollapseOnResult } from "@/hooks/useCollapseOnResult";

// deck.gl / maplibre touch `window` — client-only.
const DroneMap = dynamic(() => import("@/components/map/DroneMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[540px] w-full animate-pulse rounded-lg bg-eikon-panel" />
  ),
});
const PolygonDrawMap = dynamic(
  () => import("@/components/map/PolygonDrawMap"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[380px] w-full animate-pulse rounded-lg bg-eikon-panel" />
    ),
  },
);
const RiskLegend = dynamic(() => import("@/components/map/RiskLegend"), {
  ssr: false,
});

/**
 * How the area of interest is given. Held as a mode rather than a literal,
 * because the value the backend wants is country-specific ("UK - all",
 * "spain - all") — the same rule the search tab settled on, reused so both
 * tabs send the vocabulary the backend already handles.
 */
const SCOPE_MODES = ["all", "area", "map", "upload"] as const;
type ScopeMode = (typeof SCOPE_MODES)[number];

/**
 * What varies by country, matching the search tab's SEARCH_OVERRIDES: the UK
 * is "UK" in both the submitted value and the label, every other country uses
 * its own value and label.
 *
 * Selecting by area is UK-only because the backend's supported-area list is
 * the UK districts in uk_areas.json and nothing else — the same reason search
 * gates it.
 */
const SCOPE_OVERRIDES: Partial<
  Record<
    CountryValue,
    { shortLabel?: string; scopePrefix?: string; supportsArea?: true }
  >
> = {
  uk: { shortLabel: "UK", scopePrefix: "UK", supportsArea: true },
};

function scopeDef(value: CountryValue) {
  const country = countryByValue(value);
  const override = SCOPE_OVERRIDES[value] ?? {};
  return {
    shortLabel: override.shortLabel ?? country.label,
    scopePrefix: override.scopePrefix ?? country.value,
    supportsArea: override.supportsArea ?? false,
  };
}

/** What goes to the backend. */
function scopeValue(mode: ScopeMode, country: CountryValue): string {
  if (mode === "map") return MAP_SCOPE;
  if (mode === "upload") return UPLOAD_SCOPE;
  return `${scopeDef(country).scopePrefix} - ${mode}`;
}

/** What the dropdown shows. */
function scopeLabel(mode: ScopeMode, country: CountryValue): string {
  if (mode === "map") return MAP_SCOPE;
  if (mode === "upload") return UPLOAD_SCOPE;
  return `${scopeDef(country).shortLabel} - ${mode}`;
}

function scopesFor(country: CountryValue): ScopeMode[] {
  return scopeDef(country).supportsArea
    ? [...SCOPE_MODES]
    : SCOPE_MODES.filter((m) => m !== "area");
}

const DEFAULT_DESIRED = ["large open land", "good road access"];
const DEFAULT_UNDESIRED = ["residential housing"];

/**
 * The country only moves the drawing map to the right part of the world. The
 * site selection endpoint takes H3 cells, which carry their own location, so
 * it resolves the reference data itself and no country is sent — exactly as on
 * the risk assessment tab, and for the same reason: listing a country here is
 * not a claim the backend covers it.
 */
const COUNTRY_GROUPS = countriesByRegion(COUNTRIES);

/** Each cell is scored individually, so a big AOI is a long job. */
const CELL_WARN = 15_000;
const CELL_LIMIT = 200_000;

const DRAWN_AOI_ID = "Drawn area";

const RESULT_VIEWS = ["Site Map", "Data Table"] as const;
type ResultView = (typeof RESULT_VIEWS)[number];

export function SiteSelectionTab() {
  const { run, reset, isRunning, error, result } = useSiteSelection();

  const [country, setCountry] = useState<CountryValue>("uk");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [areaName, setAreaName] = useState((UK_AREAS as string[])[0] ?? "");
  const [aoi, setAoi] = useState<Feature<Polygon> | null>(null);
  // The uploaded files are kept so the id column can be changed without
  // re-uploading; features are re-derived whenever that choice changes.
  const [uploadFiles, setUploadFiles] = useState<
    { name: string; text: string }[]
  >([]);
  const [idKey, setIdKey] = useState("");
  const [bufferM, setBufferM] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [desired, setDesired] = useState<Criterion[]>(
    DEFAULT_DESIRED.map((c) => newCriterion(c)),
  );
  const [undesired, setUndesired] = useState<Criterion[]>(
    DEFAULT_UNDESIRED.map((c) => newCriterion(c)),
  );
  const [catchment, setCatchment] = useState<CatchmentMode>("off");
  const [view, setView] = useState<ResultView>("Site Map");
  const [basemap, setBasemap] = useState<Basemap>("Dark");
  // The drawing map folds away once the result map has something on it.
  const [mapOpen, setMapOpen] = useCollapseOnResult(!!result);
  // Which column the map is coloured by. Held by key rather than index so a
  // new run with different criteria cannot land on the wrong column.
  const [column, setColumn] = useState<string | null>(null);

  const isMapMode = scopeMode === "map";
  const isUploadMode = scopeMode === "upload";
  // Whole-country and by-area scopes carry no client-side geometry: the
  // backend resolves them from the country or the area name.
  const isNamedScope = scopeMode === "all" || scopeMode === "area";

  function onCountryChange(next: CountryValue) {
    setCountry(next);
    // Only the UK offers by-area, so leaving it must not strand the form on a
    // scope the new country cannot run.
    if (!scopesFor(next).includes(scopeMode)) setScopeMode("all");
  }

  async function onFilesChosen(files: FileList | null) {
    if (!files || files.length === 0) return;
    setIdKey("");
    setUploadFiles(
      await Promise.all(
        Array.from(files).map(async (f) => ({
          name: f.name,
          text: await f.text(),
        })),
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

  // What actually gets scored: the drawn polygon, or the uploaded features
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
  const owners = useMemo(() => aoiCellOwners(features), [features]);
  const cells = useMemo(() => Array.from(owners.keys()), [owners]);

  // The column the map and table are actually keyed on: the user's choice
  // while it still exists in this result, otherwise the combined score.
  const activeColumn = useMemo(() => {
    if (!result) return null;
    const chosen = result.scoreColumns.find((c) => c.key === column);
    return chosen ?? result.scoreColumns[0] ?? null;
  }, [result, column]);

  // Offer the finished table to the Eikon AI panel. The net score per cell is
  // the point of the tab, so the cells go up as rows, best first.
  usePublishPageContext(
    useMemo(() => {
      if (!result || result.rows.length === 0 || !activeColumn) return null;
      const scores = numericValues(result.rows, activeColumn.key);
      const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
      return {
        tab: "Site Selection",
        params: {
          Country: countryLabel(country),
          "Desired criteria": describeCriteria(
            result.desired,
            result.catchment?.desired,
          ),
          "Undesired criteria": describeCriteria(
            result.undesired,
            result.catchment?.undesired,
          ),
          Catchment: result.catchment
            ? "each criterion scored over its own catchment area"
            : undefined,
          "Area of interest":
            scopeMode === "area"
              ? areaName
              : isUploadMode
                ? "uploaded file"
                : isMapMode
                  ? "a polygon drawn on the map"
                  : scopeLabel(scopeMode, country),
          "Area (km2)": areaKm2 ? Number(areaKm2.toFixed(3)) : undefined,
        },
        stats: {
          "Cells scored": scores.length,
          [`Mean ${activeColumn.label}`]: Number(mean.toFixed(4)),
          [`Max ${activeColumn.label}`]: scores.length
            ? Number(Math.max(...scores).toFixed(4))
            : undefined,
          [`Min ${activeColumn.label}`]: scores.length
            ? Number(Math.min(...scores).toFixed(4))
            : undefined,
        },
        table: {
          columns: [
            result.cellColumn,
            ...result.scoreColumns.map((c) => c.key),
          ],
          // Best first: a question about a shortlist is about its top end,
          // and that is also what survives if the budget trims the tail.
          rows: [...result.rows]
            .sort(
              (a, b) =>
                Number(b[activeColumn.key]) - Number(a[activeColumn.key]),
            )
            .map((r) => [
              String(r[result.cellColumn] ?? ""),
              ...result.scoreColumns.map((c) => Number(r[c.key])),
            ]),
        },
      };
    }, [
      result,
      activeColumn,
      country,
      scopeMode,
      areaName,
      isUploadMode,
      isMapMode,
      areaKm2,
    ]),
  );

  const withCatchment = catchment === "on";
  const desiredProblem =
    weightingProblem(desired) ?? (withCatchment ? catchmentProblem(desired) : null);
  const undesiredProblem =
    weightingProblem(undesired) ?? (withCatchment ? catchmentProblem(undesired) : null);
  const hasDesired = desired.some((c) => c.text.trim());
  const hasUndesired = undesired.some((c) => c.text.trim());
  const overLimit = cells.length > CELL_LIMIT;
  const canSubmit =
    !isRunning &&
    (isNamedScope || features.length > 0) &&
    hasDesired &&
    hasUndesired &&
    !desiredProblem &&
    !undesiredProblem &&
    !overLimit;

  function onRun() {
    const bounds = featureBounds(features);
    run({
      h3Cells: cells,
      spatialResolution: scopeValue(scopeMode, country),
      selectedArea: scopeMode === "area" ? areaName : null,
      country,
      desired,
      undesired,
      catchment: withCatchment,
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
        <h1 className="text-2xl font-bold text-eikon-midnight">
          Site Selection
        </h1>
        <p className="text-sm text-eikon-muted">
          Look for locations based on what you want and what you don&apos;t want.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        {/* ---- Left: inputs ---- */}
        <div className="space-y-4">
          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-eikon-midnight">
              Area of interest
            </h2>

            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Country</span>
              <select
                value={country}
                onChange={(e) =>
                  onCountryChange(e.target.value as CountryValue)
                }
                className="w-full rounded border px-2 py-1.5"
              >
                {COUNTRY_GROUPS.map((group) => (
                  <optgroup key={group.region} label={group.region}>
                    {group.countries.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Source</span>
              <select
                value={scopeMode}
                onChange={(e) => setScopeMode(e.target.value as ScopeMode)}
                className="w-full rounded border px-2 py-1.5"
              >
                {scopesFor(country).map((m) => (
                  <option key={m} value={m}>
                    {scopeLabel(m, country)}
                  </option>
                ))}
              </select>
            </label>

            {scopeMode === "area" && (
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
              <Envelope title="Area" open={mapOpen} onOpenChange={setMapOpen}>
                <PolygonDrawMap
                  key={country}
                  onChange={setAoi}
                  initialView={countryByValue(country).mapView}
                />
              </Envelope>
            )}

            {isUploadMode && (
              <div className="space-y-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-eikon-muted">
                    GeoJSON file(s)
                  </span>
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
                  <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                    {uploadError}
                  </p>
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
                        <li
                          key={f.properties.unique_id}
                          className="truncate font-mono"
                        >
                          {f.properties.unique_id}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {uploaded.length > 0 && idKeyOptions.length > 0 && (
                  <label className="block text-sm">
                    <span className="mb-1 block text-eikon-muted">
                      Location ID column
                    </span>
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
                    {uploadedPoints} point{uploadedPoints === 1 ? "" : "s"}{" "}
                    assessed
                    {bufferM > 0 ? ` · ${bufferLabel(bufferM)} buffer` : ""}
                  </p>
                )}

                {uploadWarnings.map((w) => (
                  <p
                    key={w}
                    className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800"
                  >
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

          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-eikon-midnight">Mode</h2>
            <div className="flex gap-2">
              {CATCHMENT_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setCatchment(m)}
                  className={`flex-1 rounded border px-3 py-1.5 text-sm ${
                    catchment === m
                      ? "border-eikon-accent bg-eikon-accent text-white"
                      : "text-eikon-midnight"
                  }`}
                >
                  {CATCHMENT_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {/* Two panels rather than one long column of inputs: the second list
              is collapsed until it is wanted, which keeps the whole form on
              screen next to the map. */}
          <CriteriaPanel
            title="Desired"
            tone="desired"
            criteria={desired}
            onChange={setDesired}
            problem={desiredProblem}
            withCatchment={withCatchment}
            defaultOpen
          />
          <CriteriaPanel
            title="Undesired"
            tone="undesired"
            criteria={undesired}
            onChange={setUndesired}
            problem={undesiredProblem}
            withCatchment={withCatchment}
          />

          <button
            onClick={onRun}
            disabled={!canSubmit}
            className="w-full rounded bg-eikon-accent px-4 py-2 text-white disabled:opacity-50"
          >
            {isRunning ? "Selecting…" : "Run site selection"}
          </button>
          {!isRunning && (result || error) && (
            <button
              type="button"
              onClick={reset}
              className="w-full rounded border px-4 py-2 text-sm text-eikon-midnight"
            >
              Reset
            </button>
          )}
          {overLimit && (
            <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">
              {cells.length.toLocaleString()} cells is over the{" "}
              {CELL_LIMIT.toLocaleString()}-cell limit. Reduce the area or the
              buffer.
            </p>
          )}
          {!overLimit && cells.length > CELL_WARN && (
            <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {cells.length.toLocaleString()} cells — this will take several
              minutes.
            </p>
          )}
          {!hasDesired && (
            <p className="text-xs text-amber-600">
              Please provide at least one desired criterion.
            </p>
          )}
          {hasDesired && !hasUndesired && (
            <p className="text-xs text-amber-600">
              Please provide at least one undesired criterion.
            </p>
          )}
        </div>

        {/* ---- Right: results ---- */}
        <div className="min-w-0 space-y-4">
          {isRunning && (
            <div className="flex items-center gap-3 rounded-lg border bg-amber-50 p-3 text-sm text-amber-800">
              <span className="h-3 w-3 animate-ping rounded-full bg-amber-500" />
              Running site selection — this may take several minutes…
            </div>
          )}
          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {result && activeColumn && (
            <Results
              result={result}
              fallbackCenter={countryByValue(country).mapView}
              column={activeColumn.key}
              onColumn={setColumn}
              view={view}
              onView={setView}
              basemap={basemap}
              onBasemap={setBasemap}
            />
          )}
          {result && !activeColumn && (
            <div className="rounded-lg border border-dashed p-6 text-sm text-eikon-muted">
              <p className="font-semibold text-eikon-midnight">
                The table came back with no scores for these criteria.
              </p>
            </div>
          )}
          {!result && !isRunning && !error && (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-eikon-muted" />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Results({
  result,
  fallbackCenter,
  column,
  onColumn,
  view,
  onView,
  basemap,
  onBasemap,
}: {
  result: SiteSelectionResult;
  /** Framing for a backend-resolved scope, which has no drawn outline. */
  fallbackCenter: { latitude: number; longitude: number; zoom: number };
  column: string;
  onColumn: (key: string) => void;
  view: ResultView;
  onView: (v: ResultView) => void;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
}) {
  const { rows, cellColumn, scoreColumns, owners } = result;
  const [showChoropleth, setShowChoropleth] = useState(true);

  const label = scoreColumns.find((c) => c.key === column)?.label ?? column;
  const combined = scoreColumns[0];

  // Classified on the selected column, so switching column re-grades the map
  // rather than recolouring one fixed set of breaks.
  // Rank runs the other way to a score: 1 is the best cell, not the lowest.
  // The classifier always ramps cold-to-hot with the value, so the colours
  // are reversed for rank and the legend is handed the same reversed list,
  // keeping each band's colour and its range together.
  const isRank = column === RANK_COLUMN;
  const fmt = (n: number) => (isRank ? Math.round(n).toLocaleString() : n.toFixed(3));

  const { hexes, classColors, binEdges, stats } = useMemo(() => {
    // One value per row, so the classifier's labels line up with the cells
    // they colour. A cell the backend left unscored classifies as 0 rather
    // than shortening the array and shifting every colour after it.
    const values = rows.map((r) => {
      const n = Number(r[column]);
      return Number.isFinite(n) ? n : 0;
    });
    const finite = rows.map((r) => Number(r[column])).filter(Number.isFinite);
    const maxScore = Math.max(...finite, 0.01);
    const cls = classifyRiskScores(values);
    const hexes: HexDatum[] = rows.map((r, i) => ({
      h3_index: String(r[cellColumn] ?? ""),
      color:
        cls.kActual > 0
          ? cls.classColors[cls.classLabels[i]]
          : riskScoreToColor(values[i], maxScore),
      tooltip: cellTooltip(r, cellColumn, column, label, combined),
    }));
    const mean = finite.length
      ? finite.reduce((a, b) => a + b, 0) / finite.length
      : 0;
    const classColors = isRank ? [...cls.classColors].reverse() : cls.classColors;
    return {
      hexes: isRank
        ? hexes.map((h, i) => ({
            ...h,
            color:
              cls.kActual > 0
                ? classColors[cls.classLabels[i]]
                : h.color,
          }))
        : hexes,
      classColors,
      binEdges: cls.binEdges,
      stats: {
        maxScore: finite.length ? Math.max(...finite) : 0,
        minScore: finite.length ? Math.min(...finite) : 0,
        meanScore: mean,
        cells: finite.length,
      },
    };
  }, [rows, cellColumn, column, label, combined, isRank]);

  const center = useMemo(
    () => (result.bounds.length > 0 ? fitView(result.bounds) : fallbackCenter),
    [result.bounds, fallbackCenter],
  );
  const withLocation = useMemo(
    () => new Set(owners.values()).size > 1,
    [owners],
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-eikon-muted">
        <p className="font-semibold text-eikon-midnight">
          No cells were returned for this area.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Cells Scored" value={stats.cells.toLocaleString()} />
        <Metric label={`Mean ${label}`} value={fmt(stats.meanScore)} />
        <Metric label={`Max ${label}`} value={fmt(stats.maxScore)} />
        <Metric label={`Min ${label}`} value={fmt(stats.minScore)} />
      </div>

      {result.unmatchedCriteria.length > 0 && (
        <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No column was returned for: {result.unmatchedCriteria.join(", ")}.
        </p>
      )}

      <div className="flex gap-2 border-b">
        {RESULT_VIEWS.map((v) => (
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

      <label className="block max-w-xs text-sm">
        <span className="mb-1 block text-eikon-muted">Layer</span>
        <select
          value={column}
          onChange={(e) => onColumn(e.target.value)}
          className="w-full rounded border px-2 py-1.5"
        >
          {scoreColumns.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      {view === "Site Map" && (
        <div className="grid gap-3 lg:grid-cols-[4fr_1fr]">
          <DroneMap
            hexes={showChoropleth ? hexes : []}
            markers={[]}
            center={center}
            basemap={basemap}
          />
          <RiskLegend
            title={label}
            min={stats.minScore}
            decimals={isRank ? 0 : 3}
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

      {view === "Data Table" && (
        <DataTable
          result={result}
          column={column}
          withLocation={withLocation}
        />
      )}
    </div>
  );
}

/** Rows shown on screen; the CSV carries every cell. */
const TABLE_ROW_LIMIT = 200;

function DataTable({
  result,
  column,
  withLocation,
}: {
  result: SiteSelectionResult;
  column: string;
  /** The location column is dropped when every cell belongs to the same AOI. */
  withLocation: boolean;
}) {
  const { rows, cellColumn, scoreColumns, owners } = result;

  // Every column the route delivered, cell first, then the scored columns in
  // the order the map offers them so the headline score leads here too. These
  // are already only the user's own columns — projection is server-side.
  const columns = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) Object.keys(row).forEach((k) => seen.add(k));
    seen.delete(cellColumn);
    const scored = scoreColumns.map((c) => c.key).filter((k) => seen.has(k));
    for (const k of scored) seen.delete(k);
    return [cellColumn, ...scored, ...Array.from(seen)];
  }, [rows, cellColumn, scoreColumns]);

  // Best first either way: a high score leads, and so does a low rank.
  const ranked = useMemo(() => {
    const direction = column === RANK_COLUMN ? -1 : 1;
    return [...rows].sort(
      (a, b) => direction * (Number(b[column]) - Number(a[column])),
    );
  }, [rows, column]);

  function downloadCsv() {
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [...(withLocation ? ["unique_id"] : []), ...columns];
    const lines = ranked.map((r) =>
      [
        ...(withLocation ? [esc(owners.get(String(r[cellColumn])) ?? "")] : []),
        ...columns.map((k) => esc(r[k])),
      ].join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "site_selection_net_desired.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const headerLabel = (key: string) =>
    key === cellColumn
      ? "Cell"
      : (scoreColumns.find((c) => c.key === key)?.label ?? key);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-eikon-panel text-left text-eikon-midnight">
            <tr>
              {columns.map((k) => (
                <th key={k} className="px-3 py-2 whitespace-nowrap">
                  {headerLabel(k)}
                </th>
              ))}
              {withLocation && <th className="px-3 py-2">Location</th>}
            </tr>
          </thead>
          <tbody>
            {ranked.slice(0, TABLE_ROW_LIMIT).map((r) => {
              const cell = String(r[cellColumn] ?? "");
              return (
                <tr key={cell} className="border-t">
                  {columns.map((k) => (
                    <td
                      key={k}
                      className={
                        k === cellColumn
                          ? "px-3 py-2 font-mono text-xs"
                          : "px-3 py-2"
                      }
                    >
                      {k === RANK_COLUMN ? String(r[k] ?? "—") : formatValue(r[k])}
                    </td>
                  ))}
                  {withLocation && (
                    <td className="px-3 py-2">{owners.get(cell) ?? "—"}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > TABLE_ROW_LIMIT && (
        <p className="text-xs text-eikon-muted">
          Highest {TABLE_ROW_LIMIT} of {rows.length.toLocaleString()} cells.
        </p>
      )}
      <button
        onClick={downloadCsv}
        className="rounded border px-4 py-2 text-sm text-eikon-midnight"
      >
        Download all data (CSV) — {rows.length.toLocaleString()} cells
      </button>
    </div>
  );
}

/**
 * One criteria list, collapsed into its own panel.
 *
 * The weight beside each criterion is optional: left blank, no weighting is
 * sent and the backend applies its own. Filled in, every criterion in the
 * list needs one, each a share between 0 and 1, totalling no more than 1 —
 * which is what `problem` reports on.
 */
function CriteriaPanel({
  title,
  tone,
  criteria,
  onChange,
  problem,
  withCatchment,
  defaultOpen = false,
}: {
  title: string;
  tone: EnvelopeTone;
  criteria: Criterion[];
  onChange: (c: Criterion[]) => void;
  problem: string | null;
  /** Show each criterion's catchment radius — only in catchment mode. */
  withCatchment: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const filledCount = criteria.filter((c) => c.text.trim()).length;
  const weighted = hasWeighting(criteria);
  const total = weightTotal(criteria);

  function setAt(i: number, patch: Partial<Criterion>) {
    onChange(criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  return (
    <Envelope
      title={title}
      tone={tone}
      open={open}
      onOpenChange={setOpen}
      meta={
        <>
          {filledCount} of {MAX_CRITERIA}
          {weighted
            ? ` · ${total.toFixed(2)} of ${MAX_WEIGHT_TOTAL.toFixed(2)}`
            : ""}
        </>
      }
    >
      {criteria.map((c, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={c.text}
            onChange={(e) => setAt(i, { text: e.target.value })}
            placeholder={`Criterion ${i + 1}`}
            className="min-w-0 flex-1 rounded border px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={MAX_WEIGHT_TOTAL}
            step={0.05}
            value={c.weight ?? ""}
            onChange={(e) =>
              setAt(i, {
                weight: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            placeholder="Weight"
            className="w-24 shrink-0 rounded border px-2 py-1.5 text-sm"
          />
          {/* A fixed set of distances rather than a metres field: the grid can
              only express multiples of a cell's edge, so an open field would
              take 500m and search the 348m it rounds down to. */}
          {withCatchment && (
            <select
              value={c.kring}
              onChange={(e) => setAt(i, { kring: Number(e.target.value) })}
              className="w-28 shrink-0 rounded border px-2 py-1.5 text-sm"
            >
              {CATCHMENT_KRING_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {catchmentLabel(k)}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        {criteria.length < MAX_CRITERIA && (
          <button
            onClick={() => onChange([...criteria, newCriterion()])}
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
      {problem && <p className="text-xs text-amber-600">{problem}</p>}
    </Envelope>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-eikon-panel p-3 text-center">
      <div className="text-xs uppercase tracking-wide text-eikon-muted">
        {label}
      </div>
      <div className="mt-1 text-xl font-bold text-eikon-midnight">{value}</div>
    </div>
  );
}

/** The selected layer, plus the combined score when that is not it. */
function cellTooltip(
  row: Record<string, unknown>,
  cellColumn: string,
  column: string,
  label: string,
  combined: { key: string; label: string } | undefined,
): string {
  const lines = [
    `<div>Hex: ${row[cellColumn] ?? ""}</div>`,
    `<div>${label}: ${column === RANK_COLUMN ? (row[column] ?? "—") : formatValue(row[column])}</div>`,
  ];
  if (combined && combined.key !== column) {
    lines.push(
      `<div>${combined.label}: ${formatValue(row[combined.key])}</div>`,
    );
  }
  return lines.join("");
}

/**
 * The criteria as submitted, each with its catchment where there was one, so
 * the AI panel reports the distance a score was actually measured over rather
 * than implying the criterion was found in the cell itself.
 */
function describeCriteria(criteria: string[], krings?: number[]): string {
  if (!krings) return criteria.join(", ");
  return criteria
    .map((c, i) => {
      const k = krings[i] ?? 0;
      return k === 0 ? `${c} (cell only)` : `${c} (within ${catchmentLabel(k)})`;
    })
    .join(", ");
}

function formatValue(value: unknown): string {
  const n = Number(value);
  if (
    typeof value === "number" ||
    (value !== "" && value !== null && Number.isFinite(n))
  ) {
    return n.toFixed(3);
  }
  return value === null || value === undefined ? "—" : String(value);
}

/** The selected country as the UI names it. */
function countryLabel(country: string): string {
  return COUNTRIES.find((c) => c.value === country)?.label ?? country;
}
