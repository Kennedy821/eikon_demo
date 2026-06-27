"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { cellToLatLng } from "h3-js";
import { useDroneCorridor, type DroneResult } from "@/hooks/useDroneCorridor";
import { classifyRiskScores, riskScoreToColor, type RGBA } from "@/lib/geo/risk";
import { routeToWktBNG } from "@/lib/geo/corridor";
import type { AssessmentCell, DroneRoute } from "@/lib/geo/types";
import type {
  Basemap,
  HexDatum,
  MarkerDatum,
  RouteDatum,
} from "@/components/map/DroneMap";

const DroneMap = dynamic(() => import("@/components/map/DroneMap"), {
  ssr: false,
  loading: () => <div className="h-[540px] w-full animate-pulse bg-eikon-panel" />,
});

const H9_EDGE_M = 174;
const DEFAULT_CRITERIA = ["major industrial areas", "residential houses", "lots of buildings"];
const RESULT_VIEWS = ["Risk Map", "Route Map", "Data Table"] as const;
type ResultView = (typeof RESULT_VIEWS)[number];

export function DroneCorridorTab() {
  const { run, rerank, reset, isRunning, phaseLabel, warning, error, result } = useDroneCorridor();

  const [method, setMethod] = useState<"Coordinates" | "H3 Hex ID">("Coordinates");
  const [origLat, setOrigLat] = useState("51.47669");
  const [origLon, setOrigLon] = useState("-0.445234");
  const [destLat, setDestLat] = useState("51.332121");
  const [destLon, setDestLon] = useState("0.031690");
  const [origHex, setOrigHex] = useState("8919768cd4fffff");
  const [destHex, setDestHex] = useState("89192b32e37ffff");
  const [bufferKm, setBufferKm] = useState(7.5);
  const [landingM, setLandingM] = useState(2 * H9_EDGE_M);
  const [criteria, setCriteria] = useState<string[]>(DEFAULT_CRITERIA);
  const [view, setView] = useState<ResultView>("Risk Map");
  const [basemap, setBasemap] = useState<Basemap>("Dark");
  const [safetyWeight, setSafetyWeight] = useState(0.5);

  function resolveCoords(): { origin: [number, number]; dest: [number, number] } | null {
    if (method === "Coordinates") {
      const o: [number, number] = [parseFloat(origLat), parseFloat(origLon)];
      const d: [number, number] = [parseFloat(destLat), parseFloat(destLon)];
      if (o.some(Number.isNaN) || d.some(Number.isNaN)) return null;
      return { origin: o, dest: d };
    }
    try {
      return { origin: cellToLatLng(origHex) as [number, number], dest: cellToLatLng(destHex) as [number, number] };
    } catch {
      return null;
    }
  }

  function onAssess() {
    const coords = resolveCoords();
    if (!coords) {
      alert("Invalid coordinates or H3 hex ID.");
      return;
    }
    const trimmed = criteria.map((c) => c.trim()).filter(Boolean);
    run({
      origin: coords.origin,
      dest: coords.dest,
      bufferMetres: Math.round(bufferKm * 1000),
      kring: Math.floor(landingM / H9_EDGE_M),
      criteria: trimmed,
    });
  }

  function onRerank(w: number) {
    setSafetyWeight(w);
    rerank(w);
  }

  const validCriteria = criteria.some((c) => c.trim());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-eikon-midnight">Travel Corridor Assessment</h1>
        <p className="text-sm text-eikon-muted">
          Assess risk along a BVLOS travel corridor and compute an optimised low-risk route.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        {/* ---- Left: inputs ---- */}
        <div className="space-y-4">
          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-eikon-midnight">Origin &amp; Destination</h2>
            <div className="flex gap-4 text-sm">
              {(["Coordinates", "H3 Hex ID"] as const).map((m) => (
                <label key={m} className="flex items-center gap-1">
                  <input type="radio" checked={method === m} onChange={() => setMethod(m)} />
                  {m}
                </label>
              ))}
            </div>

            {method === "Coordinates" ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Origin Lat" value={origLat} onChange={setOrigLat} />
                <Field label="Origin Lon" value={origLon} onChange={setOrigLon} />
                <Field label="Dest Lat" value={destLat} onChange={setDestLat} />
                <Field label="Dest Lon" value={destLon} onChange={setDestLon} />
              </div>
            ) : (
              <div className="space-y-2">
                <Field label="Origin H3 Hex ID" value={origHex} onChange={setOrigHex} />
                <Field label="Destination H3 Hex ID" value={destHex} onChange={setDestHex} />
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-eikon-midnight">Corridor Parameters</h2>
            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Buffer Width: {bufferKm} km</span>
              <input
                type="range"
                min={1}
                max={12}
                step={0.5}
                value={bufferKm}
                onChange={(e) => setBufferKm(parseFloat(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">
                Acceptable Landing Distance: {landingM} m
              </span>
              <input
                type="range"
                min={0}
                max={5 * H9_EDGE_M}
                step={H9_EDGE_M}
                value={landingM}
                onChange={(e) => setLandingM(parseInt(e.target.value, 10))}
                className="w-full"
              />
            </label>
            <p className="text-xs text-eikon-muted">
              Routes are computed at the 99/90/80/70/60th percentile thresholds and ranked
              automatically.
            </p>
          </div>

          <CriteriaEditor criteria={criteria} onChange={setCriteria} />

          <button
            onClick={onAssess}
            disabled={isRunning || !validCriteria}
            className="w-full rounded bg-eikon-orange px-4 py-2 text-white disabled:opacity-50"
          >
            {isRunning ? "Assessing…" : "Assess Corridor"}
          </button>
          {isRunning && (
            <button onClick={reset} className="w-full rounded border px-4 py-2 text-sm text-eikon-midnight">
              Reset assessment lock
            </button>
          )}
          {!validCriteria && (
            <p className="text-xs text-amber-600">Please provide at least one assessment criterion.</p>
          )}
        </div>

        {/* ---- Right: results ---- */}
        <div className="min-w-0 space-y-4">
          {isRunning && (
            <div className="flex items-center gap-3 rounded-lg border bg-amber-50 p-3 text-sm text-amber-800">
              <span className="h-3 w-3 animate-ping rounded-full bg-amber-500" />
              {phaseLabel}
            </div>
          )}
          {warning && (
            <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</p>
          )}
          {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {result ? (
            <Results
              result={result}
              view={view}
              onView={setView}
              basemap={basemap}
              onBasemap={setBasemap}
              safetyWeight={safetyWeight}
              onRerank={onRerank}
            />
          ) : (
            !isRunning &&
            !error && (
              <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-eikon-muted">
                Configure parameters on the left and click Assess Corridor to begin.
              </div>
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
  safetyWeight,
  onRerank,
}: {
  result: DroneResult;
  view: ResultView;
  onView: (v: ResultView) => void;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  safetyWeight: number;
  onRerank: (w: number) => void;
}) {
  const { assessment, routes, summary, corridorRing, origin, dest } = result;

  // Risk classification (Jenks) → per-hex colour.
  const { hexes, classColors, binEdges, maxScore } = useMemo(() => {
    const scores = assessment.map((c) => Number(c.cum_score));
    const maxScore = Math.max(...scores, 0.01);
    const cls = classifyRiskScores(scores, 5);
    const hexes: HexDatum[] = assessment.map((c, i) => ({
      h3_index: c.h3_index_9,
      color: cls.kActual > 0 ? cls.classColors[cls.classLabels[i]] : riskScoreToColor(scores[i], maxScore),
      tooltip: hexTooltip(c.h3_index_9, scores[i], c.objects_detected),
    }));
    return { hexes, classColors: cls.classColors, binEdges: cls.binEdges, maxScore };
  }, [assessment]);

  const markers: MarkerDatum[] = [
    { lat: origin[0], lon: origin[1], color: [0, 200, 0, 220], tooltip: `<div>Origin</div><div>${origin[0].toFixed(5)}, ${origin[1].toFixed(5)}</div>` },
    { lat: dest[0], lon: dest[1], color: [255, 215, 0, 240], tooltip: `<div>Destination</div><div>${dest[0].toFixed(5)}, ${dest[1].toFixed(5)}</div>` },
  ];

  const center = useMemo(() => viewFromCorridor(corridorRing, origin, dest), [corridorRing, origin, dest]);
  const recommended = routes.find((r) => r.recommended) ?? null;
  const [showChoropleth, setShowChoropleth] = useState(true);

  // Route path layers — alternatives first, recommended last (renders on top).
  const routeLayers: RouteDatum[] = useMemo(() => {
    const alts = routes.filter((r) => !r.recommended).map(routeToDatum);
    const rec = routes.filter((r) => r.recommended).map(routeToDatum);
    return [...alts, ...rec];
  }, [routes]);

  return (
    <div className="space-y-4">
      {routes.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium text-eikon-midnight">Shortest</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={safetyWeight}
            onChange={(e) => onRerank(parseFloat(e.target.value))}
            className="flex-1"
          />
          <span className="font-medium text-eikon-midnight">Safest</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Corridor Area" value={`${summary.areaKm2} km²`} />
        <Metric label="Routes Found" value={String(summary.routesFound)} />
        <Metric label="Best Route" value={recommended ? `${recommended.routeLengthKm} km` : "N/A"} />
        <Metric label="Best Threshold" value={recommended ? `${recommended.percentile}th pct` : "N/A"} />
      </div>

      <div className="flex gap-2 border-b">
        {RESULT_VIEWS.map((v) => (
          <button
            key={v}
            onClick={() => onView(v)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              view === v ? "border-eikon-navy text-eikon-navy font-bold" : "border-transparent text-eikon-muted hover:text-eikon-navy"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {(view === "Risk Map" || view === "Route Map") && (
        <div className="grid gap-3 lg:grid-cols-[4fr_1fr]">
          <DroneMap
            hexes={showChoropleth ? hexes : []}
            markers={markers}
            routes={view === "Route Map" ? routeLayers : []}
            center={center}
            basemap={basemap}
          />
          <Legend
            binEdges={binEdges}
            classColors={classColors}
            maxScore={maxScore}
            showRouteKeys={view === "Route Map"}
            basemap={basemap}
            onBasemap={onBasemap}
            showChoropleth={showChoropleth}
            onToggleChoropleth={() => setShowChoropleth((v) => !v)}
          />
        </div>
      )}

      {view === "Route Map" && routes.length === 0 && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No safe route found at any of the tested risk thresholds (99/90/80/70/60th percentile).
          Try increasing the buffer width or acceptable landing distance.
        </p>
      )}

      {view === "Route Map" && routes.length > 0 && <RouteTable routes={routes} withRanks />}
      {view === "Data Table" && <DataTable routes={routes} />}
    </div>
  );
}

function routeToDatum(r: DroneRoute): RouteDatum {
  const label = r.recommended ? "Recommended" : "Alternative";
  return {
    path: r.coords,
    color: r.recommended ? [0, 128, 128, 220] : [255, 165, 0, 178],
    width: r.recommended ? 5 : 3,
    tooltip: `<div>${label} route (${r.percentile}th percentile)</div><div>Threshold: ${r.thresholdValue.toFixed(3)} | Length: ${r.routeLengthKm} km</div>`,
  };
}

function RouteTable({ routes }: { routes: DroneRoute[]; withRanks?: boolean }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-eikon-midnight">Route Comparison</h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-eikon-panel text-left text-eikon-midnight">
            <tr>
              <th className="px-3 py-2">Percentile</th>
              <th className="px-3 py-2">Threshold</th>
              <th className="px-3 py-2">Length (km)</th>
              <th className="px-3 py-2">Safety Rank</th>
              <th className="px-3 py-2">Length Rank</th>
              <th className="px-3 py-2">Combined Rank</th>
              <th className="px-3 py-2">Recommended</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r, i) => (
              <tr key={i} className={`border-t ${r.recommended ? "bg-teal-50" : ""}`}>
                <td className="px-3 py-2">{r.percentile}th</td>
                <td className="px-3 py-2">{r.thresholdValue.toFixed(3)}</td>
                <td className="px-3 py-2">{r.routeLengthKm}</td>
                <td className="px-3 py-2">{r.riskThresholdRank}</td>
                <td className="px-3 py-2">{r.routeLengthRank}</td>
                <td className="px-3 py-2">{r.combinedRank}</td>
                <td className="px-3 py-2">{r.recommended ? "Yes" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DataTable({ routes }: { routes: DroneRoute[] }) {
  if (routes.length === 0) return <p className="text-sm text-eikon-muted">No routes to display.</p>;

  function downloadCsv() {
    const cols = [
      "Percentile",
      "Threshold",
      "Length (km)",
      "Safety Rank",
      "Length Rank",
      "Combined Rank",
      "Recommended",
      "Geometry (WKT)",
    ];
    const lines = routes.map((r) =>
      [
        `${r.percentile}th`,
        r.thresholdValue.toFixed(3),
        r.routeLengthKm,
        r.riskThresholdRank,
        r.routeLengthRank,
        r.combinedRank,
        r.recommended ? "Yes" : "No",
        `"${routeToWktBNG(r.coords)}"`,
      ].join(","),
    );
    const csv = [cols.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "drone_corridor_routes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <RouteTable routes={routes} />
      <button onClick={downloadCsv} className="rounded border px-4 py-2 text-sm text-eikon-midnight">
        Download Routes CSV
      </button>
    </div>
  );
}

function Legend({
  binEdges,
  classColors,
  maxScore,
  showRouteKeys,
  basemap,
  onBasemap,
  showChoropleth,
  onToggleChoropleth,
}: {
  binEdges: number[];
  classColors: RGBA[];
  maxScore: number;
  showRouteKeys: boolean;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  showChoropleth: boolean;
  onToggleChoropleth: () => void;
}) {
  const rgb = (c: RGBA) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-bold text-eikon-midnight">Risk Score</span>
          <button
            onClick={onToggleChoropleth}
            aria-pressed={showChoropleth}
            title="Toggle the risk colour-grade layer"
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              showChoropleth
                ? "border-eikon-navy bg-eikon-navy text-white"
                : "border-gray-300 text-eikon-muted"
            }`}
          >
            {showChoropleth ? "On" : "Off"}
          </button>
        </div>
        <div className={showChoropleth ? "" : "opacity-40"}>
        {classColors.map((c, i) => {
          const lower = i === 0 ? 0 : binEdges[i - 1];
          const upper = binEdges[i];
          return (
            <div key={i} className="mb-1 flex items-center gap-2">
              <span className="inline-block h-3.5 w-4 rounded" style={{ background: rgb(c), opacity: 0.85 }} />
              <span className="text-xs text-eikon-muted">
                {lower.toFixed(3)} – {upper.toFixed(3)}
              </span>
            </div>
          );
        })}
        {classColors.length === 0 && (
          <div className="text-xs text-eikon-muted">0.000 – {maxScore.toFixed(3)}</div>
        )}
        </div>
        {showRouteKeys && (
          <div className="mt-2 border-t pt-2">
            <div className="mb-1 text-xs font-semibold text-eikon-midnight">Routes</div>
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-block h-1 w-4 rounded-full" style={{ background: "rgb(0,128,128)" }} />
              <span className="text-xs text-eikon-muted">Recommended</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-1 w-4 rounded-full" style={{ background: "rgb(255,165,0)" }} />
              <span className="text-xs text-eikon-muted">Alternative</span>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-bold text-eikon-midnight">Basemap</div>
        <div className="flex flex-col gap-1">
          {(["Dark", "Light", "Satellite"] as Basemap[]).map((b) => (
            <button
              key={b}
              onClick={() => onBasemap(b)}
              className={`rounded px-2 py-1 text-sm ${
                basemap === b ? "bg-eikon-navy text-white" : "border text-eikon-midnight"
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>
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

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-eikon-muted">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border px-2 py-1.5" />
    </label>
  );
}

// ---- tooltip + view helpers ----

function hexTooltip(hexId: string, score: number, objects: unknown): string {
  return `<div>Hex: ${hexId}</div><div>Risk: ${score.toFixed(3)}</div>${formatObjects(objects)}`;
}

function formatObjects(payload: unknown): string {
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

function viewFromCorridor(
  ring: [number, number][],
  origin: [number, number],
  dest: [number, number],
): { latitude: number; longitude: number; zoom: number } {
  let spread: number;
  if (ring.length) {
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    spread = Math.max(...lats) - Math.min(...lats) + (Math.max(...lons) - Math.min(...lons));
  } else {
    spread = Math.abs(origin[0] - dest[0]) + Math.abs(origin[1] - dest[1]);
  }
  const zoom = spread > 0.2 ? 8 : spread > 0.1 ? 9 : 10;
  return {
    latitude: (origin[0] + dest[0]) / 2,
    longitude: (origin[1] + dest[1]) / 2,
    zoom,
  };
}
