/**
 * Shared basemap styles for the maplibre-based maps.
 *
 * SATELLITE: Esri World Imagery plus Esri's companion labels-only overlay
 * (place names, no road network). The arcgis_hybrid style draws a prominent
 * road layer on top of the imagery, which gets in the way when the point of
 * the map is to look at what is on the ground — an AOI you are drawing, or a
 * detection you want to eyeball.
 */
export const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    esri: {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
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

export const LIGHT_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
export const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export type Basemap = "Satellite" | "Light" | "Dark";

export const BASEMAP_STYLE: Record<Basemap, string | typeof SATELLITE_STYLE> = {
  Satellite: SATELLITE_STYLE,
  Light: LIGHT_STYLE,
  Dark: DARK_STYLE,
};
