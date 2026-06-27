"use client";

import { DeckGL } from "@deck.gl/react";
import { ScatterplotLayer, PathLayer } from "@deck.gl/layers";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { RGBA } from "@/lib/geo/risk";

/**
 * Drone-corridor map — ports the pydeck H3HexagonLayer + ScatterplotLayer +
 * PathLayer composition. Hexes are coloured by risk class; origin/dest markers
 * and (optionally) route paths overlay. Basemap is switchable.
 */

export type Basemap = "Dark" | "Light" | "Satellite";

const BASEMAP_STYLE: Record<Basemap, string> = {
  Dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  Light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  Satellite: "https://raw.githubusercontent.com/go2garret/maps/main/src/assets/json/arcgis_hybrid.json",
};

export interface HexDatum {
  h3_index: string;
  color: RGBA;
  tooltip: string;
}
export interface MarkerDatum {
  lat: number;
  lon: number;
  color: RGBA;
  tooltip: string;
}
export interface RouteDatum {
  path: [number, number][]; // [lon, lat]
  color: RGBA;
  width: number;
  tooltip: string;
}

interface Props {
  hexes: HexDatum[];
  markers: MarkerDatum[];
  routes?: RouteDatum[];
  center: { latitude: number; longitude: number; zoom: number };
  basemap: Basemap;
  height?: number;
}

export default function DroneMap({
  hexes,
  markers,
  routes = [],
  center,
  basemap,
  height = 540,
}: Props) {
  const layers = [
    new H3HexagonLayer<HexDatum>({
      id: "risk-hexes",
      data: hexes,
      getHexagon: (d) => d.h3_index,
      getFillColor: (d) => d.color,
      getLineColor: [255, 255, 255, 40],
      lineWidthMinPixels: 1,
      extruded: false,
      stroked: false,
      opacity: 0.85,
      pickable: true,
    }),
    new ScatterplotLayer<MarkerDatum>({
      id: "markers",
      data: markers,
      getPosition: (d) => [d.lon, d.lat],
      getFillColor: (d) => d.color,
      getRadius: 300,
      radiusMinPixels: 6,
      pickable: true,
    }),
    // Routes last so they render on top (recommended is appended last upstream).
    ...routes.map(
      (r, i) =>
        new PathLayer<RouteDatum>({
          id: `route-${i}`,
          data: [r],
          getPath: (d) => d.path,
          getColor: (d) => d.color,
          getWidth: (d) => d.width,
          widthMinPixels: r.width,
          pickable: true,
        }),
    ),
  ];

  return (
    <div style={{ position: "relative", height, width: "100%" }}>
      <DeckGL
        initialViewState={center}
        controller
        layers={layers}
        getTooltip={({ object }) => {
          const o = object as { tooltip?: string } | null;
          return o?.tooltip ? { html: o.tooltip } : null;
        }}
      >
        <Map mapStyle={BASEMAP_STYLE[basemap]} />
      </DeckGL>
    </div>
  );
}
