"use client";

import { DeckGL } from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo } from "react";
import type { SearchResult } from "@/lib/types";

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const GREEN: [number, number, number, number] = [40, 167, 69, 200];
const RED: [number, number, number, number] = [220, 53, 69, 200];
const NAVY: [number, number, number, number] = [30, 58, 95, 200];

type PointDatum = SearchResult & { _resultIndex: number };

interface Props {
  results: SearchResult[];
  height?: number;
  onClickResult?: (index: number) => void;
}

function colorFor(r: SearchResult): [number, number, number, number] {
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
          const aiStatus =
            r.aiModelEvaluation === null || r.aiModelEvaluation === undefined
              ? "N/A"
              : r.aiModelEvaluation >= 0.5
                ? "Recommended"
                : "Not Recommended";
          const rel = r.relevance !== undefined ? `${(r.relevance * 100).toFixed(1)}%` : "—";
          return {
            html: `<div style="font-family:sans-serif;font-size:12px;line-height:1.7">
              <strong>${r.locationId}</strong><br/>
              AI: ${aiStatus} &nbsp;·&nbsp; Relevance: ${rel}
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
    </div>
  );
}
