"use client";

import { useMemo, useState } from "react";
import { DeckGL } from "@deck.gl/react";
import { WebMercatorViewport } from "@deck.gl/core";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Position } from "geojson";
import type { RemoteAssessmentCell } from "@/lib/types";
import { ckmeans } from "simple-statistics";
import { featureBounds, type AoiFeature } from "@/lib/geojsonAoi";
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

/**
 * Sequential teal. The lightest stop is still clearly a colour rather than
 * near-white: coverage values are heavily skewed — most detections are a few
 * percent while a handful are large — so a ramp that starts at white renders
 * the majority of real detections invisible.
 */
const RAMP: [number, number, number][] = [
  [165, 233, 244],
  [86, 195, 214],
  [24, 145, 170],
  [10, 74, 92],
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

/**
 * Classify the detections into natural breaks rather than scaling linearly to
 * the maximum. Coverage is skewed, so a linear scale crushes most tiles into
 * the first colour and the map reads as empty. Breaks adapt to the data, so
 * every class is populated and visibly distinct however the values are spread.
 * Same approach the drone tab uses for risk scores.
 */
interface CoverageScale {
  /** Upper bound of each class, ascending. */
  edges: number[];
  colorFor: (coverage: number) => RGBA;
}

function buildCoverageScale(values: number[], k = 5): CoverageScale {
  const positive = values.filter((v) => v > 0);
  const unique = Array.from(new Set(positive));
  if (unique.length === 0) {
    return { edges: [], colorFor: () => EMPTY };
  }
  if (unique.length === 1) {
    const only = unique[0];
    return { edges: [only], colorFor: (v) => (v > 0 ? rampColor(1) : EMPTY) };
  }
  const kUse = Math.min(k, unique.length);
  const edges = ckmeans(positive, kUse).map((c) => c[c.length - 1]);
  return {
    edges,
    colorFor: (v) => {
      if (v <= 0) return EMPTY;
      let idx = edges.findIndex((e) => v <= e);
      if (idx < 0) idx = edges.length - 1;
      return rampColor(edges.length > 1 ? idx / (edges.length - 1) : 1);
    },
  };
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

/**
 * An uploaded point drawn as a circle — the shape the point route uses instead
 * of H3 cell outlines. It summarises its own location, so the tiles behind it
 * are not drawn as hexagons: one location, one shape.
 */
interface PointDatum {
  centre: Position;
  uniqueId: string;
  objectName: string;
  /**
   * Share of the location's whole assessed area covered by the object —
   * total object area over total assessed area. This is what the circle's
   * colour means. A peak-tile figure would answer a different and much less
   * useful question for a buffer spanning many tiles.
   */
  coverage: number;
  tiles: number;
  detected: number;
  objectAreaKm2: number;
  assessedAreaKm2: number;
  meanModelConfidence: number | null;
}



interface Props {
  cells: RemoteAssessmentCell[];
  /** AOI outlines (drawn or uploaded) — drawn on top for orientation. */
  aoi?: AoiFeature[] | null;
  /** Radius of point-sourced AOIs, in metres. */
  pointRadiusM?: number;
  height?: number;
}

export default function AssessmentHeatMap({
  cells,
  aoi,
  pointRadiusM = 0,
  height = 520,
}: Props) {
  const [basemap, setBasemap] = useState<Basemap>("Light");
  // Lets the user see the underlying imagery (e.g. to eyeball a detection)
  // without leaving the assessment view.
  const [showHeatmap, setShowHeatmap] = useState(true);

  // Ids of every point-sourced location: their tiles are represented by the
  // circle, not by hexagons.
  const pointLocationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of aoi ?? []) {
      if (f.properties.point_centres?.length) ids.add(f.properties.unique_id);
    }
    return ids;
  }, [aoi]);

  // One circle per uploaded point, carrying that location's summary.
  const pointData = useMemo<PointDatum[]>(() => {
    interface Agg {
      tiles: number;
      detected: number;
      objectAreaKm2: number;
      assessedAreaKm2: number;
      confSum: number;
      confCount: number;
      objectName: string;
    }
    const byLocation: Record<string, Agg> = {};
    for (const c of cells) {
      if (!c.uniqueId || !pointLocationIds.has(c.uniqueId)) continue;
      const st =
        byLocation[c.uniqueId] ??
        {
          tiles: 0,
          detected: 0,
          objectAreaKm2: 0,
          assessedAreaKm2: 0,
          confSum: 0,
          confCount: 0,
          objectName: c.objectName,
        };
      st.tiles += 1;
      if (c.coverage > 0) st.detected += 1;
      st.objectAreaKm2 += c.objectAreaKm2;
      st.assessedAreaKm2 += c.cellAreaKm2;
      if (c.meanModelConfidence !== null && c.coverage > 0) {
        st.confSum += c.meanModelConfidence;
        st.confCount += 1;
      }
      byLocation[c.uniqueId] = st;
    }
    const out: PointDatum[] = [];
    for (const f of aoi ?? []) {
      const id = f.properties.unique_id;
      const st = byLocation[id];
      for (const centre of f.properties.point_centres ?? []) {
        out.push({
          centre,
          uniqueId: id,
          objectName: st?.objectName ?? "",
          // Cumulative: what share of everything assessed here is the object.
          coverage: st && st.assessedAreaKm2 > 0 ? st.objectAreaKm2 / st.assessedAreaKm2 : 0,
          tiles: st?.tiles ?? 0,
          detected: st?.detected ?? 0,
          objectAreaKm2: st?.objectAreaKm2 ?? 0,
          assessedAreaKm2: st?.assessedAreaKm2 ?? 0,
          meanModelConfidence: st && st.confCount > 0 ? st.confSum / st.confCount : null,
        });
      }
    }
    // Strongest last so it wins where circles overlap.
    return out.sort((a, b) => a.coverage - b.coverage);
  }, [aoi, cells, pointLocationIds]);

  // Tiles drawn as hexagons: everything that is not represented by a circle.
  const hexCells = useMemo(
    () => cells.filter((c) => !c.uniqueId || !pointLocationIds.has(c.uniqueId)),
    [cells, pointLocationIds],
  );

  // Classify over every value actually drawn — tile coverages and the point
  // circles' cumulative shares — so the legend matches what is on the map.
  const scale = useMemo(
    () =>
      buildCoverageScale([
        ...hexCells.map((c) => c.coverage),
        ...pointData.map((p) => p.coverage),
      ]),
    [hexCells, pointData],
  );

  // Outlines for everything that is not a point.
  const outlineFeatures = useMemo(
    () => (aoi ?? []).filter((f) => !f.properties.point_centres?.length),
    [aoi],
  );

  const initialViewState = useMemo(() => {
    const pts = cells.filter((c) => c.lat !== 0 && c.lon !== 0);
    if (pts.length === 0 && aoi?.length) {
      const b = featureBounds(aoi);
      if (b) return fit(b.minLon, b.minLat, b.maxLon, b.maxLat, height);
    }
    if (pts.length === 0) return { longitude: -1.5, latitude: 53, zoom: 5.2 };
    const lats = pts.map((p) => p.lat);
    const lons = pts.map((p) => p.lon);
    return fit(Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats), height);
  }, [cells, aoi, height]);

  // A resolution-9 tile is ~350 m across, which is sub-pixel much below street
  // zoom — at country zoom the hexagons vanish and the map looks empty. Each
  // tile therefore also gets a dot at its own colour with a pixel floor, drawn
  // beneath the hexagons: it is exactly inscribed in its tile, so once zoomed
  // in the hexagon covers it completely and only the hexagons are seen.
  const dotData = useMemo(
    () =>
      hexCells
        .filter((c) => c.lat !== 0 && c.lon !== 0)
        // Strongest last so it wins where dots overlap at low zoom.
        .slice()
        .sort((a, b) => a.coverage - b.coverage),
    [hexCells],
  );

  const layers = [
    ...(dotData.length
      ? [
          new ScatterplotLayer<RemoteAssessmentCell>({
            id: "coverage-dots",
            data: dotData,
            getPosition: (d) => [d.lon, d.lat],
            radiusUnits: "meters",
            getRadius: 175,
            radiusMinPixels: 4,
            getFillColor: (d) => scale.colorFor(d.coverage),
            pickable: false,
            visible: showHeatmap,
            updateTriggers: { getFillColor: [scale] },
          }),
        ]
      : []),
    // Uploaded points: one filled circle each, the shape the point route uses
    // in place of H3 cell outlines. Their tiles are excluded from the hexagon
    // layer, so a location is drawn once and never as overlapping shapes.
    ...(pointData.length
      ? [
          new ScatterplotLayer<PointDatum>({
            id: "aoi-points",
            data: pointData,
            getPosition: (d) => d.centre as [number, number],
            // True radius in metres, floored at a few pixels so the circle is
            // still legible at country-wide zoom.
            radiusUnits: "meters",
            getRadius: pointRadiusM,
            radiusMinPixels: 5,
            radiusMaxPixels: 400,
            getFillColor: (d) => scale.colorFor(d.coverage),
            stroked: true,
            getLineColor: [30, 45, 107, 230],
            lineWidthUnits: "pixels",
            getLineWidth: 1.5,
            lineWidthMinPixels: 1,
            pickable: true,
            visible: showHeatmap,
            updateTriggers: { getRadius: [pointRadiusM], getFillColor: [scale] },
          }),
        ]
      : []),
    new H3HexagonLayer<RemoteAssessmentCell>({
      id: "coverage-hexes",
      data: hexCells,
      getHexagon: (d) => d.locationId,
      getFillColor: (d) => scale.colorFor(d.coverage),
      extruded: false,
      stroked: false,
      filled: true,
      pickable: true,
      visible: showHeatmap,
      updateTriggers: { getFillColor: [scale] },
    }),
    ...(outlineFeatures.length
      ? [
          new GeoJsonLayer({
            id: "aoi-outline",
            data: outlineFeatures,
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

  return (
    <div style={{ position: "relative", height, width: "100%" }} className="overflow-hidden rounded-lg border">
      <DeckGL
        initialViewState={initialViewState}
        controller
        layers={layers}
        getTooltip={({ object }) => {
          if (!object) return null;
          const style = {
            background: "rgba(0,0,0,0.82)",
            color: "#fff",
            borderRadius: "6px",
            padding: "8px 12px",
            pointerEvents: "none" as const,
          };

          // An uploaded point summarises its whole location.
          const p = object as PointDatum;
          if (p.uniqueId !== undefined && p.centre !== undefined) {
            return {
              html: `<div style="font-family:sans-serif;font-size:12px;line-height:1.7">
                <strong>${p.uniqueId}</strong><br/>
                ${p.objectName ? `${labelFor(p.objectName)}: ` : ""}<strong>${pct(p.coverage, 2)}</strong> of area<br/>
                Model confidence: <strong>${formatConfidence(p.meanModelConfidence)}</strong><br/>
                Object area: ${p.objectAreaKm2.toFixed(4)} km² of ${p.assessedAreaKm2.toFixed(3)} km²<br/>
                ${p.detected} of ${p.tiles} tile${p.tiles === 1 ? "" : "s"} with detections
              </div>`,
              style,
            };
          }

          const c = object as RemoteAssessmentCell;
          if (!c.locationId) return null;
          return {
            html: `<div style="font-family:sans-serif;font-size:12px;line-height:1.7">
              <strong>${c.locationId}</strong><br/>
              ${labelFor(c.objectName)}: <strong>${pct(c.coverage, 2)}</strong> of tile<br/>
              Model confidence: <strong>${formatConfidence(c.meanModelConfidence)}</strong><br/>
              Object area: ${c.objectAreaKm2.toFixed(4)} km²
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
            showHeatmap ? "bg-eikon-accent text-white" : "text-eikon-midnight hover:bg-eikon-panel"
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
        <div className="mb-2 text-xs font-bold text-eikon-midnight">Share of area covered</div>
        {scale.edges.length > 0 ? (
          // One row per class, labelled with the range it covers, because the
          // classes are natural breaks rather than even slices of a gradient.
          <div className="space-y-1">
            {scale.edges.map((edge, i) => (
              <div key={edge} className="flex items-center gap-2">
                <span
                  className="inline-block h-3.5 w-4 rounded"
                  style={{
                    background: `rgb(${scale
                      .colorFor(edge)
                      .slice(0, 3)
                      .join(",")})`,
                  }}
                />
                <span className="text-[10px] text-eikon-muted">
                  {i === 0 ? "" : `${pct(scale.edges[i - 1], 1)} – `}
                  {pct(edge, 1)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-eikon-muted">No detections in the assessed tiles.</p>
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
