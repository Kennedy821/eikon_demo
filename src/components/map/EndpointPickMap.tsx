"use client";

import { useEffect, useRef, useState } from "react";
import {
  Map,
  Marker,
  Source,
  Layer,
  type MapLayerMouseEvent,
  type ViewStateChangeEvent,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
// Basemaps and the opening-view shape are shared with the AOI drawing map.
import { BASEMAP_STYLE, type Basemap } from "@/components/map/basemaps";
import type { MapView } from "@/components/map/PolygonDrawMap";

/**
 * Pick a corridor's two endpoints by clicking the map.
 *
 * The sibling of PolygonDrawMap for a corridor rather than an area: the same
 * navigation, the same basemap switcher, but two points instead of a shape.
 * Terra Draw is not used — it draws geometry, and what is wanted here is one
 * click per endpoint with the pair kept in order, which a raw map click gives
 * directly.
 *
 * Controlled, so the tab owns the endpoints. The coordinate readout, the
 * assessment request and these markers are then the same two numbers rather
 * than copies that can disagree.
 */

/** [lat, lon] — the order the corridor tab and the backend both use. */
export type Endpoint = [number, number];

export interface Endpoints {
  origin: Endpoint | null;
  dest: Endpoint | null;
}

/** Which endpoint the next click lands on. */
type Armed = "origin" | "dest";

const ORIGIN_COLOR = "#0E7490";
const DEST_COLOR = "#B91C1C";

export default function EndpointPickMap({
  value,
  onChange,
  height = 380,
  initialView,
}: {
  value: Endpoints;
  onChange: (next: Endpoints) => void;
  height?: number;
  initialView: MapView;
}) {
  const [basemap, setBasemap] = useState<Basemap>("Satellite");
  // Start on whichever endpoint is still missing, so the common case — an
  // empty map — is one click for the origin and one for the destination with
  // nothing to press in between.
  const [armed, setArmed] = useState<Armed>(value.origin ? "dest" : "origin");

  // Camera position, tracked so a basemap change doesn't reset the view.
  const viewRef = useRef<MapView>(initialView);
  useEffect(() => {
    viewRef.current = initialView;
  }, [initialView]);

  function onMapClick(e: MapLayerMouseEvent) {
    const point: Endpoint = [e.lngLat.lat, e.lngLat.lng];
    const next: Endpoints =
      armed === "origin" ? { ...value, origin: point } : { ...value, dest: point };
    onChange(next);
    // Hand the arming to the other endpoint while it is still empty; once both
    // are placed, stay put so a misplaced point is corrected by clicking again
    // rather than by overwriting the one that was right.
    if (armed === "origin" && !next.dest) setArmed("dest");
    else if (armed === "dest" && !next.origin) setArmed("origin");
  }

  function clearAll() {
    onChange({ origin: null, dest: null });
    setArmed("origin");
  }

  const both = value.origin && value.dest;
  const line = both
    ? {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            properties: {},
            geometry: {
              type: "LineString" as const,
              coordinates: [
                [value.origin![1], value.origin![0]],
                [value.dest![1], value.dest![0]],
              ],
            },
          },
        ],
      }
    : null;

  const targets: { key: Armed; label: string; color: string; set: boolean }[] = [
    { key: "origin", label: "Origin", color: ORIGIN_COLOR, set: !!value.origin },
    { key: "dest", label: "Destination", color: DEST_COLOR, set: !!value.dest },
  ];

  return (
    <div className="relative overflow-hidden rounded-lg border" style={{ height }}>
      <Map
        key={basemap}
        initialViewState={viewRef.current}
        mapStyle={BASEMAP_STYLE[basemap] as never}
        cursor="crosshair"
        onClick={onMapClick}
        onMoveEnd={(e: ViewStateChangeEvent) => {
          viewRef.current = {
            longitude: e.viewState.longitude,
            latitude: e.viewState.latitude,
            zoom: e.viewState.zoom,
          };
        }}
        style={{ width: "100%", height: "100%" }}
      >
        {/* The straight line is the corridor's centreline as requested, not the
            route: the pathfinder's answer is what the Route Map shows once the
            assessment has run. */}
        {line && (
          <Source id="corridor-line" type="geojson" data={line}>
            <Layer
              id="corridor-line-dash"
              type="line"
              paint={{
                "line-color": "#FFFFFF",
                "line-width": 2,
                "line-dasharray": [2, 2],
                "line-opacity": 0.9,
              }}
            />
          </Source>
        )}

        {value.origin && (
          <Marker longitude={value.origin[1]} latitude={value.origin[0]} anchor="center">
            <Dot color={ORIGIN_COLOR} label="O" />
          </Marker>
        )}
        {value.dest && (
          <Marker longitude={value.dest[1]} latitude={value.dest[0]} anchor="center">
            <Dot color={DEST_COLOR} label="D" />
          </Marker>
        )}
      </Map>

      {/* Which endpoint the next click lands on. Same floating-toolbar
          placement as the AOI map's draw tools. */}
      <div className="absolute left-2 top-2 flex flex-col gap-1">
        {targets.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setArmed(t.key)}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium shadow-sm transition-colors ${
              armed === t.key
                ? "border-eikon-accent bg-eikon-accent text-white"
                : "border-gray-300 bg-white text-eikon-midnight hover:bg-eikon-panel"
            }`}
          >
            <span
              className="h-2 w-2 rounded-full ring-1 ring-white"
              style={{ backgroundColor: t.color }}
            />
            {t.label}
            {t.set ? " ✓" : ""}
          </button>
        ))}
        <button
          type="button"
          disabled={!value.origin && !value.dest}
          onClick={clearAll}
          className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-red-600 shadow-sm hover:bg-red-50 disabled:opacity-50"
        >
          ✕ Clear
        </button>
      </div>

      {/* Basemap selector — same options and placement as the AOI map. */}
      <div className="absolute right-2 top-2 flex gap-1">
        {(Object.keys(BASEMAP_STYLE) as Basemap[]).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBasemap(b)}
            className={`rounded border px-2 py-1 text-xs font-medium shadow-sm transition-colors ${
              basemap === b
                ? "border-eikon-navy bg-eikon-navy text-white"
                : "border-gray-300 bg-white text-eikon-midnight hover:bg-eikon-panel"
            }`}
          >
            {b}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A marker that stays legible over both satellite imagery and a flat basemap. */
function Dot({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white shadow"
      style={{ backgroundColor: color, outline: "2px solid rgba(255,255,255,0.9)" }}
    >
      {label}
    </span>
  );
}
