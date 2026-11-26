/**
 * The countries EIKON covers, and where to point a map at each of them.
 *
 * Tabs keep their own tab-specific country configuration — which area modes
 * apply, what prefix the backend wants — but the geography is the same
 * wherever it is shown, so `value`, `label`, `region` and `mapView` live here
 * and each tab derives its own table from this one. That is deliberate: the
 * same list had already been duplicated into the search submit route, where
 * one typo was all it took for a country to appear in the dropdown and then be
 * rejected by the route it fed.
 *
 * Order matters. The UK is first because each tab falls back to the first
 * entry for an unrecognised value.
 *
 * Coverage is NOT uniform and this list does not claim it is. The UK and Hong
 * Kong are the imagery-backed countries; the rest are described from OSM data
 * and are Search-only on that pipeline. What any one tab can actually do in a
 * given country is the backend's answer, not this table's.
 */
export const COUNTRIES = [
  {
    value: "uk",
    region: "Europe",
    label: "United Kingdom",
    mapView: { longitude: -2.5, latitude: 54.0, zoom: 4.2 },
  },
  {
    value: "hongkong",
    region: "Asia",
    label: "Hong Kong",
    mapView: { longitude: 114.15, latitude: 22.35, zoom: 9.5 },
  },
  {
    value: "spain",
    region: "Europe",
    label: "Spain",
    mapView: { longitude: -3.7, latitude: 40.2, zoom: 5.2 },
  },
  {
    value: "belgium",
    region: "Europe",
    label: "Belgium",
    mapView: { longitude: 4.48, latitude: 50.52, zoom: 6.8 },
  },
  {
    value: "austria",
    region: "Europe",
    label: "Austria",
    mapView: { longitude: 13.34, latitude: 47.71, zoom: 6.5 },
  },
  {
    value: "bulgaria",
    region: "Europe",
    label: "Bulgaria",
    mapView: { longitude: 25.48, latitude: 42.75, zoom: 6.5 },
  },
  {
    value: "croatia",
    region: "Europe",
    label: "Croatia",
    mapView: { longitude: 16.47, latitude: 44.51, zoom: 6.0 },
  },
  {
    value: "cyprus",
    region: "Europe",
    label: "Cyprus",
    mapView: { longitude: 33.44, latitude: 35.13, zoom: 8.0 },
  },
  {
    value: "czechia",
    region: "Europe",
    label: "Czechia",
    mapView: { longitude: 15.47, latitude: 49.82, zoom: 6.5 },
  },
  {
    value: "denmark",
    region: "Europe",
    label: "Denmark",
    mapView: { longitude: 11.63, latitude: 56.19, zoom: 6.0 },
  },
  {
    value: "estonia",
    region: "Europe",
    label: "Estonia",
    mapView: { longitude: 24.98, latitude: 58.61, zoom: 6.4 },
  },
  {
    value: "finland",
    region: "Europe",
    label: "Finland",
    mapView: { longitude: 26.07, latitude: 65.45, zoom: 3.9 },
  },
  {
    value: "france",
    region: "Europe",
    label: "France",
    mapView: { longitude: 2.21, latitude: 46.43, zoom: 4.7 },
  },
  {
    value: "germany",
    region: "Europe",
    label: "Germany",
    mapView: { longitude: 10.46, latitude: 51.33, zoom: 4.9 },
  },
  {
    value: "greece",
    region: "Europe",
    label: "Greece",
    mapView: { longitude: 23.81, latitude: 38.36, zoom: 5.4 },
  },
  {
    value: "hungary",
    region: "Europe",
    label: "Hungary",
    mapView: { longitude: 19.5, latitude: 47.18, zoom: 6.4 },
  },
  {
    value: "italy",
    region: "Europe",
    label: "Italy",
    mapView: { longitude: 12.57, latitude: 42.07, zoom: 4.7 },
  },
  {
    value: "latvia",
    region: "Europe",
    label: "Latvia",
    mapView: { longitude: 24.6, latitude: 56.9, zoom: 6.4 },
  },
  {
    value: "lithuania",
    region: "Europe",
    label: "Lithuania",
    mapView: { longitude: 23.89, latitude: 55.2, zoom: 6.3 },
  },
  {
    value: "luxembourg",
    region: "Europe",
    label: "Luxembourg",
    mapView: { longitude: 6.13, latitude: 49.82, zoom: 8.3 },
  },
  {
    value: "malta",
    region: "Europe",
    label: "Malta",
    mapView: { longitude: 14.38, latitude: 35.94, zoom: 10.0 },
  },
  {
    value: "netherlands",
    region: "Europe",
    label: "Netherlands",
    mapView: { longitude: 5.29, latitude: 52.18, zoom: 6.3 },
  },
  {
    value: "norway",
    region: "Europe",
    label: "Norway",
    mapView: { longitude: 17.86, latitude: 65.4, zoom: 3.5 },
  },
  {
    value: "poland",
    region: "Europe",
    label: "Poland",
    mapView: { longitude: 19.13, latitude: 52.02, zoom: 5.3 },
  },
  {
    value: "portugal",
    region: "Europe",
    label: "Portugal",
    mapView: { longitude: -7.85, latitude: 39.6, zoom: 5.7 },
  },
  {
    value: "romania",
    region: "Europe",
    label: "Romania",
    mapView: { longitude: 24.98, latitude: 45.99, zoom: 5.8 },
  },
  {
    value: "slovakia",
    region: "Europe",
    label: "Slovakia",
    mapView: { longitude: 19.7, latitude: 48.68, zoom: 6.9 },
  },
  {
    value: "slovenia",
    region: "Europe",
    label: "Slovenia",
    mapView: { longitude: 15.0, latitude: 46.15, zoom: 7.4 },
  },
  {
    value: "sweden",
    region: "Europe",
    label: "Sweden",
    mapView: { longitude: 17.64, latitude: 62.99, zoom: 3.6 },
  },
  {
    value: "switzerland",
    region: "Europe",
    label: "Switzerland",
    mapView: { longitude: 8.22, latitude: 46.82, zoom: 7.0 },
  },
] as const;

/** A country's value, as the tabs' selects and the backend payloads use it. */
export type CountryValue = (typeof COUNTRIES)[number]["value"];

export type Country = (typeof COUNTRIES)[number];

/**
 * A populated default point per country, as [lat, lon] — the capital.
 *
 * A tab that has to put the user somewhere when they pick a country needs a
 * point on land with something to look at, which `mapView` is not: that is a
 * whole-country framing, and its centre is open sea for Greece and farmland
 * for most of the rest. Describing or routing from a country centroid gives an
 * empty answer about nowhere in particular.
 *
 * The UK and Hong Kong are deliberately absent. Both tabs that use this have
 * a hand-picked default for them — London and Mong Kok — chosen before this
 * table existed and better than "the capital" would be, Hong Kong having none.
 * A lookup here returning nothing means "use your own default", not an error.
 */
export const CAPITALS: Partial<Record<CountryValue, [number, number]>> = {
  spain: [40.4168, -3.7038],
  belgium: [50.8476, 4.3572],
  austria: [48.2082, 16.3738],
  bulgaria: [42.6977, 23.3219],
  croatia: [45.815, 15.9819],
  cyprus: [35.1856, 33.3823],
  czechia: [50.0755, 14.4378],
  denmark: [55.6761, 12.5683],
  estonia: [59.437, 24.7536],
  finland: [60.1699, 24.9384],
  france: [48.8566, 2.3522],
  germany: [52.52, 13.405],
  greece: [37.9838, 23.7275],
  hungary: [47.4979, 19.0402],
  italy: [41.9028, 12.4964],
  latvia: [56.9496, 24.1052],
  lithuania: [54.6872, 25.2797],
  luxembourg: [49.6116, 6.1319],
  malta: [35.8989, 14.5146],
  netherlands: [52.3676, 4.9041],
  norway: [59.9139, 10.7522],
  poland: [52.2297, 21.0122],
  portugal: [38.7223, -9.1393],
  romania: [44.4268, 26.1025],
  slovakia: [48.1486, 17.1077],
  slovenia: [46.0569, 14.5058],
  sweden: [59.3293, 18.0686],
  switzerland: [46.948, 7.4474],
};

/**
 * Continent headings, in the order they are shown. Alphabetical sorting alone
 * put Hong Kong between Greece and Hungary; grouping by continent first keeps
 * the one non-European country from being lost mid-list.
 */
export const REGIONS = ["Europe", "Asia"] as const;

/**
 * The countries grouped under their continent heading, each group sorted by
 * label, for rendering as optgroups. Empty groups are dropped so a region can
 * be listed here before any country in it exists.
 */
export function countriesByRegion<T extends { region: string; label: string }>(
  countries: readonly T[],
): { region: string; countries: T[] }[] {
  return REGIONS.map((region) => ({
    region,
    countries: countries
      .filter((c) => c.region === region)
      .sort((a, b) => a.label.localeCompare(b.label)),
  })).filter((group) => group.countries.length > 0);
}

/** Look a country up, falling back to the first entry (the UK). */
export function countryByValue(value: string): Country {
  return COUNTRIES.find((c) => c.value === value) ?? COUNTRIES[0];
}

/**
 * Shorter forms for the rotating coverage badge, where the name sits inside a
 * sentence and every character widens the badge. Only where the full label
 * would be needlessly long.
 */
const BADGE_LABELS: Partial<Record<CountryValue, string>> = { uk: "UK" };

/**
 * The countries named in copy that states the coverage, as plain names.
 *
 * Derived, so a country cannot be offered in the dropdowns and left out of the
 * coverage line. Table order is kept rather than sorted: it puts the UK, Hong
 * Kong and Spain first, so the three with the most behind them are the ones a
 * reader sees before their attention moves on.
 *
 * Bare names, no articles — they are rendered as labels rather than read as
 * part of the sentence, and "the UK" inside a badge reads as a mistake.
 */
export const COVERED_COUNTRIES: readonly string[] = COUNTRIES.map(
  (c) => BADGE_LABELS[c.value] ?? c.label,
);
