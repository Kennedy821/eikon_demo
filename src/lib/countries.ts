/**
 * The countries EIKON covers, for copy that names the coverage.
 *
 * Each tab keeps its own COUNTRIES constant because each carries tab-specific
 * configuration — map views, coordinate presets, which area modes apply. This
 * is the plain roll-up of what is covered overall, so a sentence naming the
 * coverage reads it from one place instead of hard-coding a list that goes
 * stale the next time a country is added, as "across the UK" did when Hong
 * Kong and then Spain arrived.
 *
 * Coverage is not uniform: Spain is Search only, on the OSM pipeline. This
 * lists where EIKON can answer at all, which is what the copy claims.
 *
 * Bare names, no articles — they are rendered as labels rather than read as
 * part of the sentence, and "the UK" inside a badge reads as a mistake.
 */
export const COVERED_COUNTRIES = ["UK", "Hong Kong", "Spain"] as const;
