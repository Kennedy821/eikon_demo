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
 */
const OSM_SEARCH_COUNTRIES = new Set(["spain"]);

export function isOsmSearchCountry(country: string | null | undefined): boolean {
  return !!country && OSM_SEARCH_COUNTRIES.has(country.toLowerCase());
}
