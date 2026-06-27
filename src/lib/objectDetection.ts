/**
 * Object-detection helpers — ported from eikon_demo_app_beta.py
 * (DETECTABLE_OBJECTS and the normalize/aggregate logic in
 * render_object_detection_tab).
 */

export const DETECTABLE_OBJECTS = [
  "building", "tree", "water", "road", "parking_lot", "roundabout",
  "sports_stadium", "field", "agricultural_land", "swimming_pool",
  "industrial_land", "lake", "tennis_court", "cars", "golf_course",
  "railway_line", "golf_sand_bunker", "forest", "motorway", "major_road",
  "minor_road", "train_depot", "solar_panels", "quarry", "airplane",
  "outdoor_sports_court", "fuel_station", "circular_sedimentation_tank",
  "outdoor_sports_field", "cemetry", "electricity_pylon", "residential_buildings",
  "industrial_buildings", "factory_chimney", "power_substation", "parking_spaces",
  "tent", "airplane_runway", "construction_land", "solar_battery_storage",
  "water_treatment_site", "crane", "shipping_container", "ship", "boat",
  "bridge", "canoes", "tree_canopy", "airport_terminals", "airport_runway",
];

export interface ObjectRecord {
  object: string;
  count: number;
  areaCoverage?: string | number;
}

function titleCase(s: string): string {
  return s
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace("%", ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Normalise the objects payload (a JSON string, a {name: count} dict, or a list
 * of {name, objects_detected, proportion_of_area_that_is_label}) into a tidy,
 * aggregated, count-descending list of records.
 */
export function normalizeObjects(objectsData: unknown): ObjectRecord[] {
  if (!objectsData || objectsData === "no_objects_found") return [];

  let parsed: unknown = objectsData;
  if (typeof objectsData === "string") {
    try {
      parsed = JSON.parse(objectsData);
    } catch {
      return [];
    }
  }

  const records: ObjectRecord[] = [];

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const o = item as Record<string, unknown>;
      const name = o.name ?? o.object;
      const count = toNumber(o.objects_detected ?? o.count ?? o.Count);
      if (typeof name !== "string" || count === null) continue;
      records.push({
        object: titleCase(name),
        count,
        areaCoverage: (o.proportion_of_area_that_is_label ?? o.coverage ?? undefined) as
          | string
          | number
          | undefined,
      });
    }
  } else if (typeof parsed === "object" && parsed !== null) {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const count = toNumber(v);
      if (count === null) continue;
      records.push({ object: titleCase(k), count });
    }
  }

  // Aggregate by object name (sum counts, keep first coverage), sort desc.
  const byName = new Map<string, ObjectRecord>();
  for (const r of records) {
    const existing = byName.get(r.object);
    if (existing) {
      existing.count += r.count;
      if (existing.areaCoverage === undefined) existing.areaCoverage = r.areaCoverage;
    } else {
      byName.set(r.object, { ...r });
    }
  }
  return Array.from(byName.values()).sort((a, b) => b.count - a.count);
}

/** Parse an area-coverage value (e.g. "12.5%" or 12.5) to a float. */
export function parsePercent(v: string | number | undefined): number | null {
  if (v === undefined) return null;
  return toNumber(v);
}
