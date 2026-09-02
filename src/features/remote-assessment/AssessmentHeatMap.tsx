"use client";

import { useMemo, useState } from "react";
import { DeckGL } from "@deck.gl/react";
import { WebMercatorViewport } from "@deck.gl/core";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { GeoJsonLayer } from "@deck.gl/layers";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, Polygon } from "geojson";
import type { RemoteAssessmentCell } from "@/lib/types";
import { BASEMAP_STYLE, type Basemap } from "@/components/map/basemaps";

/**
 * Coverage heat map for the remote location assessment. Each H3 res-9 cell is
 * coloured by the fraction of its area covered by the selected object class
 * (0 → faint, max → dark). Cells assessed with nothing found stay visible so
 * the user can see the extent that was actually inspected.
 */

// Same basemaps as the Search tab's AOI drawing map — the satellite option is
// imagery plus place-name labels only, without a road overlay.
const BASEMAP_ORDER: Basemap[] = ["Light", "Dark", "Satellite"];

type RGBA = [number, number, number, number];

// Sequential yellow → orange → deep brown ramp (ColorBrewer YlOrBr-like).
const RAMP: [number, number, number][] = [
  [255, 247, 188],
  [254, 196, 79],
  [236, 112, 20],
  [153, 52, 4],
];
const EMPTY: RGBA = [148, 163, 184, 60];

function rampColor(t: number): RGBA {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(Math.floor(x), RAMP.length - 2);
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
    220,
  ];
}

function pct(v: number, digits = 1) {
  return `${(v * 100).toFixed(digits)}%`;
}

function labelFor(objectName: string) {
  return objectName.replace(/_/g, " ");
}

/** Backend reports confidence as a 0..1 fraction; shown as a percentage. */
function formatConfidence(v: number | null) {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

interface Props {
  cells: RemoteAssessmentCell[];
  /** Drawn AOI outline (custom mode) — drawn on top for orientation. */
  aoi?: Feature<Polygon> | null;
  height?: number;
}

export default function AssessmentHeatMap({ cells, aoi, height = 520 }: Props) {
  const [basemap, setBasemap] = useState<Basemap>("Light");
  // Lets the user see the underlying imagery (e.g. to eyeball a detection)
  // without leaving the assessment view.
  const [showHeatmap, setShowHeatmap] = useState(true);

  const maxCoverage = useMemo(
    () => cells.reduce((m, c) => (c.coverage > m ? c.coverage : m), 0),
    [cells],
  );

  const initialViewState = useMemo(() => {
    const pts = cells.filter((c) => c.lat !== 0 && c.lon !== 0);
    if (pts.length === 0 && aoi) {
      const ring = aoi.geometry.coordinates[0] ?? [];
      const lons = ring.map((p) => p[0]);
      const lats = ring.map((p) => p[1]);
      return fit(Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats), height);
    }
    if (pts.length === 0) return { longitude: -1.5, latitude: 53, zoom: 5.2 };
    const lats = pts.map((p) => p.lat);
    const lons = pts.map((p) => p.lon);
    return fit(Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats), height);
  }, [cells, aoi, height]);

  const layers = [
    new H3HexagonLayer<RemoteAssessmentCell>({
      id: "coverage-hexes",
      data: cells,
      getHexagon: (d) => d.locationId,
      getFillColor: (d) =>
        d.coverage > 0 && maxCoverage > 0 ? rampColor(d.coverage / maxCoverage) : EMPTY,
      extruded: false,
      stroked: false,
      filled: true,
      pickable: true,
      visible: showHeatmap,
      updateTriggers: { getFillColor: [maxCoverage] },
    }),
    ...(aoi
      ? [
          new GeoJsonLayer({
            id: "aoi-outline",
            data: aoi,
            filled: false,
            stroked: true,
            getLineColor: [30, 45, 107, 220],
            getLineWidth: 2,
            lineWidthMinPixels: 2,
            lineWidthUnits: "pixels",
          }),
        ]
      : []),
  ];

  const legendStops = [0.25, 0.5, 0.75, 1].map((t) => ({
    t,
    label: pct(maxCoverage * t),
  }));

  return (
    <div style={{ position: "relative", height, width: "100%" }} className="overflow-hidden rounded-lg border">
      <DeckGL
        initialViewState={initialViewState}
        controller
        layers={layers}
        getTooltip={({ object }) => {
          const c = object as RemoteAssessmentCell | null;
          if (!c || !c.locationId) return null;
          return {
            html: `<div style="font-family:sans-serif;font-size:12px;line-height:1.7">
              <strong>${c.locationId}</strong><br/>
              ${labelFor(c.objectName)}: <strong>${pct(c.coverage, 2)}</strong> of cell<br/>
              Model confidence: <strong>${formatConfidence(c.meanModelConfidence)}</strong><br/>
              Object area: ${c.objectAreaKm2.toFixed(4)} km² &nbsp;·&nbsp; Cell: ${c.cellAreaKm2.toFixed(3)} km²
            </div>`,
            style: {
              background: "rgba(0,0,0,0.82)",
              color: "#fff",
              borderRadius: "6px",
              padding: "8px 12px",
              pointerEvents: "none",
            },
          };
        }}
      >
        <Map mapStyle={BASEMAP_STYLE[basemap]} />
      </DeckGL>

      {/* Layer + basemap controls */}
      <div className="absolute right-2 top-2 flex items-center gap-1 rounded-lg border bg-white/95 p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setShowHeatmap((v) => !v)}
          aria-pressed={showHeatmap}
          title={showHeatmap ? "Hide heat map layer" : "Show heat map layer"}
          className={`rounded px-2 py-0.5 text-xs ${
            showHeatmap ? "bg-eikon-orange text-white" : "text-eikon-midnight hover:bg-eikon-panel"
          }`}
        >
          Heat map {showHeatmap ? "on" : "off"}
        </button>
        <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
        {BASEMAP_ORDER.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBasemap(b)}
            className={`rounded px-2 py-0.5 text-xs ${
              basemap === b ? "bg-eikon-midnight text-white" : "text-eikon-midnight hover:bg-eikon-panel"
            }`}
          >
            {b}
          </button>
        ))}
      </div>

      {/* Legend */}
      {showHeatmap && (
      <div className="absolute bottom-6 left-2 rounded-lg border bg-white/95 p-3 shadow-sm">
        <div className="mb-2 text-xs font-bold text-eikon-midnight">Share of cell covered</div>
        {maxCoverage > 0 ? (
          <>
            <div
              className="h-3 w-40 rounded"
              style={{
                background: `linear-gradient(to right, ${RAMP.map(
                  (c) => `rgb(${c[0]},${c[1]},${c[2]})`,
                ).join(", ")})`,
              }}
            />
            <div className="mt-1 flex w-40 justify-between text-[10px] text-eikon-muted">
              <span>0%</span>
              {legendStops.map((s) => (
                <span key={s.t}>{s.label}</span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-eikon-muted">No detections in the assessed cells.</p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <span
            className="inline-block h-3.5 w-4 rounded"
            style={{ background: `rgba(${EMPTY[0]},${EMPTY[1]},${EMPTY[2]},${EMPTY[3] / 255})` }}
          />
          <span className="text-xs text-eikon-muted">Assessed, none found</span>
        </div>
      </div>
      )}
    </div>
  );
}

/** Fit a lon/lat bounding box into the map with padding. Width is an estimate
 *  (the panel is fluid); deck.gl re-centres correctly once the user interacts. */
function fit(minLon: number, minLat: number, maxLon: number, maxLat: number, height: number) {
  const pad = 0.002;
  const vp = new WebMercatorViewport({ width: 800, height });
  const { longitude, latitude, zoom } = vp.fitBounds(
    [
      [minLon - pad, minLat - pad],
      [maxLon + pad, maxLat + pad],
    ],
    { padding: 40 },
  );
  return { longitude, latitude, zoom: Math.min(zoom, 15) };
}
