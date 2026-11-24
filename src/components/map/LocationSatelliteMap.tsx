"use client";

import { Map } from "react-map-gl/maplibre";
import { cellToBoundary } from "h3-js";
import "maplibre-gl/dist/maplibre-gl.css";
import { SATELLITE_STYLE } from "@/components/map/basemaps";
import {
  NO_IMAGERY,
  registerEsriTileFilter,
  throughTileFilter,
} from "@/components/map/esriTiles";

registerEsriTileFilter();

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
 * How deep Esri's pyramid is read for this card, overriding the shared style's
 * cap of 19.
 *
 * 19 is the level that is safe everywhere, which is what a basemap shared by
 * every map in the app has to be: z20 is already absent over all 18 UK and
 * Hong Kong locations sampled, so those maps keep it. This card is only drawn
 * for the OSM search countries, where there is no backend render behind a
 * result and the imagery is the whole point, and where Esri carries a level
 * more than that across Spain, Austria and Denmark — 4x the detail, 0.06m per
 * pixel against 0.23m.
 *
 * It is not a claim that every OSM country has z20; most do not. The tile
 * loader drops the "no imagery" placeholder (see esriTiles), so where the
 * level is missing the parent tile is scaled instead and nothing goes grey.
 * That makes this a ceiling rather than a promise, and it can be raised: z21
 * exists over central Madrid, Vienna and Tallinn, at the cost of a wasted
 * request per tile everywhere else.
 */
const MAX_TILE_ZOOM = 20;

/**
 * The shared SATELLITE_STYLE draws Esri's place-names overlay over the
 * imagery. That overlay is wanted on the maps you navigate with, but this one
 * stands in for a photograph of a single cell, so it carries no text. Only the
 * imagery source and layer are kept, taken from the shared style so the tile
 * URL and the Esri attribution stay defined in one place.
 */
const SATELLITE_NO_LABELS = {
  ...SATELLITE_STYLE,
  sources: {
    esri: {
      ...SATELLITE_STYLE.sources.esri,
      tiles: SATELLITE_STYLE.sources.esri.tiles.map(throughTileFilter),
      maxzoom: MAX_TILE_ZOOM,
    },
  },
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
        // A dropped placeholder tile is a normal outcome, not a fault worth
        // putting in the console on every pan at the deepest zooms.
        onError={(e) => {
          if (e.error?.message !== NO_IMAGERY) console.error(e.error);
        }}
        style={{ position: "absolute", inset: 0 }}
      />
    </div>
  );
}
