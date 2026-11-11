"use client";

import { Map } from "react-map-gl/maplibre";
import { cellToBoundary } from "h3-js";
import "maplibre-gl/dist/maplibre-gl.css";
import { SATELLITE_STYLE } from "@/components/map/basemaps";

/**
 * Satellite view of a single location, rendered from Esri World Imagery rather
 * than fetched from the backend.
 *
 * The location cards normally show the backend's satellite image, but the OSM
 * search pipeline has no imagery behind it — there is no image to fetch for a
 * result in one of those countries. This fills the same slot at the same
 * proportions, so an OSM card sits in the carousel like any other.
 *
 * Search results are H3 resolution 9 throughout, which the card asks for as
 * the "high" image tier: a 1000x583 render, measured off the image set rather
 * than assumed. Hence one frame and one zoom, not a per-resolution table.
 */
const IMAGE_ASPECT = "1000 / 583";

/** Breathing room around the cell, in pixels. */
const FIT_PADDING = 16;

/**
 * Fit the view to the cell itself rather than to a fixed zoom.
 *
 * A resolution 9 cell spans about 365m, while a fixed zoom of 14.5 covered
 * roughly 2.7km of ground — wide enough that two neighbouring cells rendered
 * near-identical views. Fitting the cell's own boundary frames the location
 * that was actually returned, and does it correctly at whatever width the card
 * gives the map.
 */
function boundsForCell(cell: string): [[number, number], [number, number]] | null {
  try {
    const boundary = cellToBoundary(cell); // [lat, lon] pairs
    if (boundary.length === 0) return null;
    const lats = boundary.map((p) => p[0]);
    const lons = boundary.map((p) => p[1]);
    return [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];
  } catch {
    return null;
  }
}

/**
 * The shared SATELLITE_STYLE draws Esri's place-names overlay over the
 * imagery. That overlay is wanted on the maps you navigate with, but this one
 * stands in for a photograph of a single cell, so it carries no text. Only the
 * imagery source and layer are kept, taken from the shared style so the tile
 * URL and the Esri attribution stay defined in one place.
 */
const SATELLITE_NO_LABELS = {
  ...SATELLITE_STYLE,
  sources: { esri: SATELLITE_STYLE.sources.esri },
  layers: SATELLITE_STYLE.layers.filter((layer) => layer.source === "esri"),
};

export default function LocationSatelliteMap({
  cell,
  lat,
  lon,
}: {
  /** H3 index of the result — the view is fitted to this cell's boundary. */
  cell: string;
  lat: number;
  lon: number;
}) {
  const bounds = boundsForCell(cell);

  return (
    <div
      className="relative w-full overflow-hidden rounded border"
      style={{ aspectRatio: IMAGE_ASPECT }}
    >
      <Map
        // maplibre reads the initial view once, so without a key the map keeps
        // the first location it was given. The carousel swaps the cell in place
        // rather than remounting the card, which is how two different cells
        // ended up showing the same image.
        key={cell}
        initialViewState={
          bounds
            ? { bounds, fitBoundsOptions: { padding: FIT_PADDING } }
            : { longitude: lon, latitude: lat, zoom: 15.5 }
        }
        mapStyle={SATELLITE_NO_LABELS as never}
        // Scroll must keep scrolling the page — the map sits mid-card in a
        // long carousel. Drag to pan and double-click to zoom still work.
        scrollZoom={false}
        dragRotate={false}
        // Esri's terms require the credit, so the attribution control stays.
        style={{ position: "absolute", inset: 0 }}
      />
    </div>
  );
}
