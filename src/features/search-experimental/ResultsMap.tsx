"use client";

import { DeckGL } from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import { WebMercatorViewport } from "@deck.gl/core";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
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

/** Breathing room around the outermost points, in pixels. */
const FIT_PADDING = 48;

/**
 * How far in a fit may go. A search returning one location, or a handful
 * within the same town, would otherwise fit to a span of metres and open at
 * building zoom — which shows the result but not where in the country it is.
 */
const FIT_MAX_ZOOM = 12;

/**
 * Smallest span a fit is computed over, in degrees (~2km). Covers the
 * degenerate case of every point sharing one coordinate, where the bounds have
 * no extent to fit at all.
 */
const FIT_MIN_EXTENT = 0.02;

/** Marker size on screen, in pixels, held roughly constant across zooms. */
const DOT_PIXELS = 6;

/** Used only before the container is measured, and when there is nothing to show. */
const FALLBACK_VIEW = { longitude: -0.1278, latitude: 51.5074, zoom: 9 };

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

  // Fitting needs the pixel box it is fitting into. Measured in a layout
  // effect so the first painted frame is already framed, with no jump from a
  // placeholder view.
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * Frame the results, rather than guessing a zoom for their midpoint.
   *
   * The previous framing centred on the mean of the points and took a zoom
   * from a three-step ladder bottoming out at 8 — roughly 1.5 degrees across
   * this card. Results spread over a whole country span many times that, so
   * the midpoint landed in empty countryside with every marker outside the
   * viewport: the wider the search, the emptier the map.
   *
   * fitBounds fixes both ends of that. It zooms out as far as needed to hold
   * the outermost points, and in as far as FIT_MAX_ZOOM permits when they are
   * clustered, so a city-sized result set stops being framed as a country.
   */
  const viewState = useMemo(() => {
    if (points.length === 0 || width === 0) return FALLBACK_VIEW;
    const lats = points.map((p) => p.lat);
    const lons = points.map((p) => p.lon);
    const fitted = new WebMercatorViewport({ width, height }).fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, minExtent: FIT_MIN_EXTENT },
    );
    return { longitude: fitted.longitude, latitude: fitted.latitude, zoom: fitted.zoom };
  }, [points, width, height]);

  /**
   * Dot radius is in metres, but the fitted zoom now spans anything from a
   * continent to a town, so a fixed radius would be a speck at one end and a
   * blob at the other. Converting a pixel size back to metres keeps the
   * markers readable at whatever the fit produced; radiusMinPixels and
   * radiusMaxPixels still bound the result.
   */
  const radius = useMemo(() => {
    const metresPerPixel =
      (156_543.03 * Math.cos((viewState.latitude * Math.PI) / 180)) / 2 ** viewState.zoom;
    return DOT_PIXELS * metresPerPixel;
  }, [viewState]);

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
    <div ref={containerRef} style={{ position: "relative", height, width: "100%" }}>
      <DeckGL
        // deck.gl re-applies initialViewState when it changes, so a new result
        // set re-frames the map without remounting the GL context.
        initialViewState={viewState}
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
