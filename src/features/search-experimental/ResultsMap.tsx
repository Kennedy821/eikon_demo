"use client";

import { DeckGL } from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo } from "react";
import type { SearchResult } from "@/lib/types";

/**
 * Experimental copy of the search results map. Adds a third point class:
 * "More like this" similarity matches (raw.source === "more_like_this")
 * render teal with a similarity tooltip, alongside the usual green
 * (recommended) / red (not recommended) search hits.
 */

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const GREEN: [number, number, number, number] = [40, 167, 69, 200];
const RED: [number, number, number, number] = [220, 53, 69, 200];
const NAVY: [number, number, number, number] = [30, 58, 95, 200];
const TEAL: [number, number, number, number] = [13, 148, 136, 220];

type PointDatum = SearchResult & { _resultIndex: number };

interface Props {
  results: SearchResult[];
  height?: number;
  onClickResult?: (index: number) => void;
}

function isSimilarMatch(r: SearchResult): boolean {
  return r.raw?.source === "more_like_this";
}

function colorFor(r: SearchResult): [number, number, number, number] {
  if (isSimilarMatch(r)) return TEAL;
  if (r.aiModelEvaluation === null || r.aiModelEvaluation === undefined) return NAVY;
  return r.aiModelEvaluation >= 0.5 ? GREEN : RED;
}

export default function ResultsMap({ results, height = 480, onClickResult }: Props) {
  const points = useMemo<PointDatum[]>(
    () =>
      results
        .map((r, i) => ({ ...r, _resultIndex: i }))
        .filter((r) => r.lat !== 0 && r.lon !== 0),
    [results],
  );

  const { radius, zoom, centerLat, centerLon } = useMemo(() => {
    if (points.length === 0) {
      return { radius: 500, zoom: 9, centerLat: 51.5074, centerLon: -0.1278 };
    }
    const lats = points.map((p) => p.lat);
    const lons = points.map((p) => p.lon);
    const spread =
      Math.max(...lats) - Math.min(...lats) + (Math.max(...lons) - Math.min(...lons));
    const radius = spread > 0.2 ? 2000 : spread > 0.1 ? 1000 : 500;
    const zoom = radius === 2000 ? 8 : radius === 1000 ? 9 : 10;
    return {
      radius,
      zoom,
      centerLat: lats.reduce((s, v) => s + v, 0) / lats.length,
      centerLon: lons.reduce((s, v) => s + v, 0) / lons.length,
    };
  }, [points]);

  const layers = [
    new ScatterplotLayer<PointDatum>({
      id: "results",
      data: points,
      getPosition: (d) => [d.lon, d.lat],
      getFillColor: colorFor,
      getRadius: radius,
      radiusMinPixels: 4,
      radiusMaxPixels: 24,
      pickable: true,
      autoHighlight: true,
      onClick: ({ object }) => {
        if (object && onClickResult) onClickResult(object._resultIndex);
      },
    }),
  ];

  const hasUnevaluated = points.some(
    (p) => !isSimilarMatch(p) && (p.aiModelEvaluation === null || p.aiModelEvaluation === undefined),
  );
  const hasSimilar = points.some(isSimilarMatch);

  return (
    <div style={{ position: "relative", height, width: "100%" }}>
      <DeckGL
        initialViewState={{ longitude: centerLon, latitude: centerLat, zoom }}
        controller
        layers={layers}
        getCursor={({ isHovering }) => (onClickResult && isHovering ? "pointer" : "grab")}
        getTooltip={({ object }) => {
          const r = object as PointDatum | null;
          if (!r) return null;

          let detail: string;
          if (isSimilarMatch(r)) {
            const sim = r.raw?.combined_similarity;
            const pct = typeof sim === "number" ? `${(sim * 100).toFixed(0)}%` : "—";
            detail = `Similar location · ${pct} match`;
          } else {
            const aiStatus =
              r.aiModelEvaluation === null || r.aiModelEvaluation === undefined
                ? "N/A"
                : r.aiModelEvaluation >= 0.5
                  ? "Recommended"
                  : "Not Recommended";
            const rel = r.relevance !== undefined ? `${(r.relevance * 100).toFixed(1)}%` : "—";
            detail = `AI: ${aiStatus} &nbsp;·&nbsp; Relevance: ${rel}`;
          }

          return {
            html: `<div style="font-family:sans-serif;font-size:12px;line-height:1.7">
              <strong>${r.locationId}</strong><br/>
              ${detail}
              ${onClickResult ? '<br/><span style="color:#5eead4;font-size:11px">Click to view location profile →</span>' : ""}
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
        <Map mapStyle={MAP_STYLE} />
      </DeckGL>

      {/* Legend — same swatch pattern as the drone risk-assessment map. */}
      <div className="absolute bottom-6 left-2 rounded-lg border bg-white/95 p-3 shadow-sm">
        <div className="mb-2 text-xs font-bold text-eikon-midnight">Locations</div>
        <LegendRow color={GREEN} label="Recommended" />
        <LegendRow color={RED} label="Not recommended" />
        {hasUnevaluated && <LegendRow color={NAVY} label="Not yet evaluated" />}
        {hasSimilar && <LegendRow color={TEAL} label="Similar match (More like this)" />}
      </div>
    </div>
  );
}

function LegendRow({ color, label }: { color: [number, number, number, number]; label: string }) {
  return (
    <div className="mb-1 flex items-center gap-2 last:mb-0">
      <span
        className="inline-block h-3.5 w-4 rounded"
        style={{ background: `rgb(${color[0]}, ${color[1]}, ${color[2]})`, opacity: 0.85 }}
      />
      <span className="text-xs text-eikon-muted">{label}</span>
    </div>
  );
}
