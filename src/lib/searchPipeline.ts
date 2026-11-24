/**
 * Which search pipeline a country runs on.
 *
 * This lives outside src/lib/server so both sides can read it: the route
 * handlers pick the upstream endpoints from it, and the Location Profile card
 * uses it to decide how to show the location. It must stay free of any
 * server-only import for that reason.
 */

/**
 * Countries whose search is served by the OSM pipeline rather than the
 * UK/Hong Kong imagery stack. The country is the only thing that decides this,
 * so submit and the two polling routes all agree without passing a separate
 * flag around.
 *
 * An OSM country has no backend imagery behind a result, which is what the
 * Location Profile card keys off to draw satellite tiles instead of asking for
 * a render. Adding one here is enough to route its search, but see
 * LocationSatelliteMap: how deep Esri's imagery goes varies by country.
 */
const OSM_SEARCH_COUNTRIES = new Set([
  "spain",
  "belgium",
  "austria",
  "bulgaria",
  "croatia",
  "cyprus",
  "czechia",
  "denmark",
  "estonia",
  "finland",
  "france",
  "germany",
  "greece",
  "hungary",
  "italy",
  "latvia",
  "lithuania",
  "luxembourg",
  "malta",
  "netherlands",
  "norway",
  "poland",
  "portugal",
  "romania",
  "slovakia",
  "slovenia",
  "sweden",
  "switzerland",
]);

/** The OSM countries, for callers that need the list rather than a test. */
export const OSM_SEARCH_COUNTRY_LIST: readonly string[] = [...OSM_SEARCH_COUNTRIES];

export function isOsmSearchCountry(country: string | null | undefined): boolean {
  return !!country && OSM_SEARCH_COUNTRIES.has(country.toLowerCase());
}
