import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/similarity
 *   { location1:[lat,lon], location2:[lat,lon], resolution, apiKey, type? }
 *   -> { visual?, descriptive?, combined? }
 *
 * Backed by the unified POST /abstracted_similarity_comparison_any_country:
 *   { location_1_lat_lon_list, location_2_lat_lon_list, resolution,
 *     similarity_type, api_key, text, origin_country, dest_country }
 * Every similarity_type returns { location_pair_similarity_value }.
 * `type` selects which to compute; omit/"all" computes all three in parallel.
 *
 * Each location's country is resolved first via POST /get_location_country,
 * which takes { location: [lat, lon], api_key } and answers { country }. The
 * comparison is only attempted when both resolve, mirroring the reference
 * implementation, which returns nothing when either country is unknown.
 */

const SIM_TYPES = ["visual", "descriptive", "combined"] as const;
type SimType = (typeof SIM_TYPES)[number];

const UNKNOWN_COUNTRY = "unknown";

/**
 * Resolve the country serving a location. A failed lookup is not fatal here —
 * it yields "unknown", which the caller reports against the specific location
 * rather than as a generic similarity failure.
 */
async function countryFor(
  location: [number, number],
  apiKey: string,
): Promise<string> {
  try {
    const res = await callBackend<{ country?: string }>("locationCountry", {
      json: { location: [location[0], location[1]], api_key: apiKey },
      timeoutMs: 20_000,
    });
    return res?.country ?? UNKNOWN_COUNTRY;
  } catch {
    return UNKNOWN_COUNTRY;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      location1?: [number, number];
      location2?: [number, number];
      resolution?: string;
      apiKey?: string;
      type?: SimType | "all";
    };
    const { location1, location2, resolution = "medium", apiKey, type = "all" } = body;

    if (!location1 || !location2 || !apiKey) {
      return NextResponse.json(
        { error: "location1, location2, apiKey required" },
        { status: 400 },
      );
    }

    // Resolved once for the pair rather than per similarity type, so asking
    // for all three still costs two country lookups.
    const [originCountry, destCountry] = await Promise.all([
      countryFor(location1, apiKey),
      countryFor(location2, apiKey),
    ]);

    if (originCountry === UNKNOWN_COUNTRY || destCountry === UNKNOWN_COUNTRY) {
      const unresolved = [
        originCountry === UNKNOWN_COUNTRY ? "location 1" : null,
        destCountry === UNKNOWN_COUNTRY ? "location 2" : null,
      ].filter(Boolean);
      return NextResponse.json(
        {
          error: `Could not determine the country for ${unresolved.join(" and ")}. Similarity is only available for locations in a supported country.`,
        },
        { status: 422 },
      );
    }

    const wanted: readonly SimType[] = type === "all" ? SIM_TYPES : [type];

    const results = await Promise.allSettled(
      wanted.map((t) =>
        callBackend<Record<string, unknown>>("abstractedSimilarityAnyCountry", {
          json: {
            text: "placeholder",
            location_1_lat_lon_list: [location1[0], location1[1]],
            location_2_lat_lon_list: [location2[0], location2[1]],
            resolution,
            similarity_type: t,
            api_key: apiKey,
            origin_country: originCountry,
            dest_country: destCountry,
          },
          timeoutMs: 120_000,
        }),
      ),
    );

    const out: Record<string, number> = {};
    let firstError: string | null = null;
    wanted.forEach((t, i) => {
      const r = results[i];
      if (r.status === "fulfilled") {
        const raw = r.value?.["location_pair_similarity_value"];
        const num = typeof raw === "number" ? raw : parseFloat(String(raw));
        if (Number.isFinite(num)) out[t] = num;
      } else if (!firstError) {
        firstError = r.reason instanceof Error ? r.reason.message : String(r.reason);
      }
    });

    if (Object.keys(out).length === 0) {
      // Surface the real upstream error so failures are diagnosable.
      return NextResponse.json(
        { error: firstError ?? "Similarity unavailable" },
        { status: 502 },
      );
    }
    return NextResponse.json(out);
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Similarity failed" },
      { status },
    );
  }
}
