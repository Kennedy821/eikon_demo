"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Map, type ViewStateChangeEvent } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawCircleMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Feature, Polygon } from "geojson";

/**
 * geojson.io-style AOI drawing map. Navigate anywhere in the world, then draw a
 * single area of interest as a point-based Polygon, a Rectangle, or a Circle
 * (all three produce a GeoJSON Polygon in CRS 4326). The finished shape is
 * emitted via onChange; only one AOI exists at a time.
 *
 * Built on Terra Draw (the MapLibre-native equivalent of the mapbox-gl-draw
 * toolset geojson.io uses), since this app renders with maplibre-gl.
 */

// Satellite imagery (Esri World Imagery) plus Esri's companion labels-only
// overlay (place names, no roads). The arcgis_hybrid style previously used
// here drew a prominent road network on top, which distracted from drawing
// an AOI — this pairing keeps orientation labels without the road clutter.
const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    esri: {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution:
        "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      maxzoom: 19,
    },
    esriLabels: {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: "esri-imagery", type: "raster" as const, source: "esri" },
    { id: "esri-labels", type: "raster" as const, source: "esriLabels" },
  ],
};

// Same Carto styles the drone risk-assessment map offers.
type Basemap = "Satellite" | "Light" | "Dark";
const BASEMAP_STYLE: Record<Basemap, unknown> = {
  Satellite: SATELLITE_STYLE,
  Light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  Dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};

type DrawMode = "polygon" | "rectangle" | "circle";

export default function PolygonDrawMap({
  onChange,
  height = 380,
}: {
  onChange: (feature: Feature<Polygon> | null) => void;
  height?: number;
}) {
  const drawRef = useRef<TerraDraw | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<DrawMode | "idle">("idle");
  const [basemap, setBasemap] = useState<Basemap>("Satellite");

  // Keep the latest onChange without forcing the map to re-init.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // The current AOI, kept so it can be re-added after a basemap change
  // (switching styles remounts the map — see key={basemap} below).
  const featureRef = useRef<Feature<Polygon> | null>(null);

  // Camera position, tracked so a basemap change doesn't reset the view.
  const viewRef = useRef({ longitude: -2.5, latitude: 54, zoom: 4.2 });

  const initDraw = useCallback((e: { target: unknown }) => {
    const draw = new TerraDraw({
      // The adapter accepts the underlying maplibre-gl Map instance.
      adapter: new TerraDrawMapLibreGLAdapter({ map: e.target as never }),
      modes: [
        new TerraDrawPolygonMode(),
        new TerraDrawRectangleMode(),
        new TerraDrawCircleMode(),
      ],
    });
    draw.start();

    draw.on("finish", (id) => {
      const feature = draw.getSnapshot().find((f) => f.id === id);
      // Return to idle so the shape isn't accidentally extended/duplicated.
      draw.setMode("static");
      setMode("idle");
      if (feature && feature.geometry.type === "Polygon") {
        featureRef.current = feature as unknown as Feature<Polygon>;
        onChangeRef.current(featureRef.current);
      }
    });

    // Re-add the existing AOI after a basemap-change remount.
    if (featureRef.current) {
      draw.addFeatures([featureRef.current as never]);
    }

    drawRef.current = draw;
    setReady(true);
  }, []);

  useEffect(() => {
    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
    };
  }, []);

  function switchBasemap(next: Basemap) {
    if (next === basemap) return;
    // The MapLibre adapter does not survive setStyle (its layers get wiped),
    // so tear down and let the keyed <Map> remount re-initialise drawing.
    drawRef.current?.stop();
    drawRef.current = null;
    setReady(false);
    setMode("idle");
    setBasemap(next);
  }

  function pick(next: DrawMode) {
    const draw = drawRef.current;
    if (!draw) return;
    // Enforce a single AOI: clear any previous shape before drawing a new one.
    draw.clear();
    featureRef.current = null;
    onChangeRef.current(null);
    draw.setMode(next);
    setMode(next);
  }

  function clearAll() {
    const draw = drawRef.current;
    if (!draw) return;
    draw.clear();
    draw.setMode("static");
    setMode("idle");
    featureRef.current = null;
    onChangeRef.current(null);
  }

  const tools: { key: DrawMode; label: string; hint: string }[] = [
    { key: "polygon", label: "▰ Polygon", hint: "Click to add points; click the first point to close" },
    { key: "rectangle", label: "▭ Rectangle", hint: "Click and drag to draw a rectangle" },
    { key: "circle", label: "◯ Circle", hint: "Click centre, drag out to set radius" },
  ];

  return (
    <div className="relative overflow-hidden rounded-lg border" style={{ height }}>
      <Map
        key={basemap}
        initialViewState={viewRef.current}
        mapStyle={BASEMAP_STYLE[basemap] as never}
        onLoad={(e) => initDraw(e)}
        onMoveEnd={(e: ViewStateChangeEvent) => {
          viewRef.current = {
            longitude: e.viewState.longitude,
            latitude: e.viewState.latitude,
            zoom: e.viewState.zoom,
          };
        }}
        style={{ width: "100%", height: "100%" }}
      />

      {/* Floating toolbar — mirrors geojson.io's draw controls. */}
      <div className="absolute left-2 top-2 flex flex-col gap-1">
        {tools.map((t) => (
          <button
            key={t.key}
            type="button"
            title={t.hint}
            disabled={!ready}
            onClick={() => pick(t.key)}
            className={`rounded border px-2.5 py-1 text-xs font-medium shadow-sm transition-colors disabled:opacity-50 ${
              mode === t.key
                ? "border-eikon-orange bg-eikon-orange text-white"
                : "border-gray-300 bg-white text-eikon-midnight hover:bg-eikon-panel"
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          disabled={!ready}
          onClick={clearAll}
          className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-red-600 shadow-sm hover:bg-red-50 disabled:opacity-50"
        >
          ✕ Clear
        </button>
      </div>

      {/* Basemap selector — same options as the drone risk-assessment map. */}
      <div className="absolute right-2 top-2 flex gap-1">
        {(Object.keys(BASEMAP_STYLE) as Basemap[]).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => switchBasemap(b)}
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

      {mode !== "idle" && (
        <div className="absolute bottom-2 left-2 right-2 rounded bg-black/70 px-3 py-1.5 text-xs text-white">
          {tools.find((t) => t.key === mode)?.hint}
        </div>
      )}
    </div>
  );
}
