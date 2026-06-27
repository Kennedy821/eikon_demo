"use client";

import { DeckGL } from "@deck.gl/react";
import { ScatterplotLayer, LineLayer } from "@deck.gl/layers";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo } from "react";

/**
 * Generic deck.gl map for plotting labelled points and optional connector
 * lines over a free MapLibre basemap. Used by the Similarity (two points),
 * Portfolio (origin/destination points + similarity-coloured lines) and Object
 * Detection (single location) tabs — the JS equivalent of the pydeck maps in
 * those Streamlit tabs.
 */

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export type RGBA = [number, number, number, number];

export interface MapPoint {
  lat: number;
  lon: number;
  color: RGBA;
  name?: string;
  type?: string;
  radius?: number;
}

export interface MapLine {
  start: [number, number]; // [lon, lat]
  end: [number, number]; // [lon, lat]
  color: RGBA;
  name?: string;
  type?: string;
}

interface Props {
  points: MapPoint[];
  lines?: MapLine[];
  zoom?: number;
  height?: number;
  defaultRadius?: number;
}

export default function PointsMap({
  points,
  lines = [],
  zoom = 11,
  height = 420,
  defaultRadius = 300,
}: Props) {
  const center = useMemo(() => {
    if (points.length === 0) return { longitude: -0.1278, latitude: 51.5074 };
    return {
      longitude: points.reduce((s, p) => s + p.lon, 0) / points.length,
      latitude: points.reduce((s, p) => s + p.lat, 0) / points.length,
    };
  }, [points]);

  const layers = [
    new LineLayer<MapLine>({
      id: "lines",
      data: lines,
      getSourcePosition: (d) => d.start,
      getTargetPosition: (d) => d.end,
      getColor: (d) => d.color,
      getWidth: 3,
      pickable: true,
    }),
    new ScatterplotLayer<MapPoint>({
      id: "points",
      data: points,
      getPosition: (d) => [d.lon, d.lat],
      getFillColor: (d) => d.color,
      getRadius: (d) => d.radius ?? defaultRadius,
      radiusMinPixels: 5,
      radiusMaxPixels: 20,
      pickable: true,
      autoHighlight: true,
    }),
  ];

  return (
    <div style={{ position: "relative", height, width: "100%" }}>
      <DeckGL
        initialViewState={{ ...center, zoom }}
        controller
        layers={layers}
        getTooltip={({ object }) => {
          const o = object as (MapPoint | MapLine) | null;
          if (!o) return null;
          const parts = [o.name, o.type].filter(Boolean);
          return parts.length ? { text: parts.join("\n") } : null;
        }}
      >
        <Map mapStyle={MAP_STYLE} />
      </DeckGL>
    </div>
  );
}
