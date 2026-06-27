import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/context  { lat, lon, resolution, apiKey }
 *   -> { description, image }   (image is base64 or null)
 *
 * Mirrors eikonsai.context.get_location_description + get_location_image
 * (POST pagekite /get_location_description and /get_location_image, payload
 * { text:"placeholder", location:[lat,lon], resolution, api_key }).
 * Both are fetched in parallel; image failures are non-fatal.
 */
export async function POST(req: NextRequest) {
  try {
    const { lat, lon, resolution, apiKey } = (await req.json()) as {
      lat?: number;
      lon?: number;
      resolution?: string;
      apiKey?: string;
    };
    if (lat === undefined || lon === undefined || !apiKey) {
      return NextResponse.json({ error: "lat, lon, apiKey required" }, { status: 400 });
    }

    const payload = {
      text: "placeholder",
      location: [lat, lon],
      resolution: resolution ?? "medium",
      api_key: apiKey,
    };

    const [descRes, imgRes] = await Promise.allSettled([
      callBackend<{ location_description?: string }>("locationDescription", { json: payload }),
      callBackend<{ location_image?: string }>("locationImage", { json: payload }),
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
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Context failed" },
      { status },
    );
  }
}
