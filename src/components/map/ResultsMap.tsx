"use client";

import { DeckGL } from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo } from "react";
import type { SearchResult } from "@/lib/types";

/**
 * deck.gl map of search results — ports the pydeck ScatterplotLayer in the
 * Streamlit Map View. Points are coloured by ai_model_evaluation (green =
 * recommended >=0.5, red = not), radius/zoom adapt to how spread out the
 * results are, and a tooltip shows id / AI status / relevance.
 */

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const GREEN: [number, number, number, number] = [40, 167, 69, 200];
const RED: [number, number, number, number] = [220, 53, 69, 200];
const NAVY: [number, number, number, number] = [30, 58, 95, 200];

interface Props {
  results: SearchResult[];
  height?: number;
}

function colorFor(r: SearchResult): [number, number, number, number] {
  if (r.aiModelEvaluation === null || r.aiModelEvaluation === undefined) return NAVY;
  return r.aiModelEvaluation >= 0.5 ? GREEN : RED;
}

export default function ResultsMap({ results, height = 480 }: Props) {
  const points = useMemo(() => results.filter((r) => r.lat !== 0 && r.lon !== 0), [results]);

  // Adaptive radius + zoom from the spread of points (mirrors the Python logic).
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
    new ScatterplotLayer<SearchResult>({
      id: "results",
      data: points,
      getPosition: (d) => [d.lon, d.lat],
      getFillColor: colorFor,
      getRadius: radius,
      radiusMinPixels: 4,
      radiusMaxPixels: 24,
      pickable: true,
      autoHighlight: true,
    }),
  ];

  return (
    <div style={{ position: "relative", height, width: "100%" }}>
      <DeckGL
        initialViewState={{ longitude: centerLon, latitude: centerLat, zoom }}
        controller
        layers={layers}
        getTooltip={({ object }) => {
          const r = object as SearchResult | null;
          if (!r) return null;
          const aiStatus =
            r.aiModelEvaluation === null || r.aiModelEvaluation === undefined
              ? "N/A"
              : r.aiModelEvaluation >= 0.5
                ? "Recommended"
                : "Not Recommended";
          const rel = r.relevance !== undefined ? `${(r.relevance * 100).toFixed(1)}%` : "—";
          return {
            text: `${r.locationId}\nAI Evaluation: ${aiStatus}\nRelevance: ${rel}`,
          };
        }}
      >
        <Map mapStyle={MAP_STYLE} />
      </DeckGL>
    </div>
  );
}
