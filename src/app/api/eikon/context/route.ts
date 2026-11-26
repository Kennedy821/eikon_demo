import { NextRequest, NextResponse } from "next/server";
import { callBackend } from "@/lib/server/backend";
import { backendErrorResponse } from "@/lib/server/safeError";
import { OSM_SEARCH_COUNTRY_LIST } from "@/lib/searchPipeline";

/**
 * POST /api/eikon/context  { lat, lon, resolution, apiKey }
 *   -> { description, image }   (image is base64 or null)
 *
 * Both halves use the country-aware v2 endpoints.
 *
 * Mirrors eikonsai.context.get_location_description + get_location_image
 * (POST pagekite /get_location_description and /get_location_image, payload
 * { text:"placeholder", location:[lat,lon], resolution, api_key }).
 * Both are fetched in parallel; image failures are non-fatal.
 */
/**
 * Derived from the shared list rather than written out, so a country the
 * dropdown offers cannot be 400'd here. This is a guard against a value the
 * app never offers, not a coverage claim: there is one pair of upstream
 * endpoints and they decide what they hold for a location.
 */
const VALID_COUNTRIES = ["uk", "hongkong", ...OSM_SEARCH_COUNTRY_LIST];

export async function POST(req: NextRequest) {
  try {
    const { lat, lon, resolution, apiKey, country } = (await req.json()) as {
      lat?: number;
      lon?: number;
      resolution?: string;
      apiKey?: string;
      country?: string;
    };
    if (lat === undefined || lon === undefined || !apiKey) {
      return NextResponse.json({ error: "lat, lon, apiKey required" }, { status: 400 });
    }
    // Reject an unknown country here rather than letting it fail deeper in.
    const countryValue = (country ?? "uk").toLowerCase();
    if (!VALID_COUNTRIES.includes(countryValue)) {
      return NextResponse.json(
        { error: `country must be one of: ${VALID_COUNTRIES.join(", ")}` },
        { status: 400 },
      );
    }

    const payload = {
      text: "placeholder",
      location: [lat, lon],
      resolution: resolution ?? "medium",
      api_key: apiKey,
      country: countryValue,
    };

    const [descRes, imgRes] = await Promise.allSettled([
      callBackend<{ location_description?: string }>("locationDescriptionV2", { json: payload }),
      callBackend<{ location_image?: string }>("locationImageV2", { json: payload }),
    ]);

    const description =
      descRes.status === "fulfilled" ? (descRes.value?.location_description ?? null) : null;
    const image =
      imgRes.status === "fulfilled" ? (imgRes.value?.location_image ?? null) : null;

    if (description === null && image === null) {
      return NextResponse.json({ error: "Context unavailable" }, { status: 502 });
    }
    return NextResponse.json({ description, image });
  } catch (err) {
    return backendErrorResponse(err, "Context failed");
  }
}
