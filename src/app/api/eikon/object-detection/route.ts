import { NextRequest, NextResponse } from "next/server";
import { latLngToCell } from "h3-js";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/object-detection
 *   { lat?, lon?, locationId?, resolution, apiKey, withImage }
 *   -> { objects, annotatedImage, resolution, lat?, lon?, locationId? }
 *
 * Mirrors render_object_detection_tab's two input methods:
 *   - H3 Location ID  -> detect_objects_with_image(location_id) (yolo); image
 *     kept only when withImage.
 *   - Coordinates + withImage -> coords to H3 (low=7/medium=8/high=9) then yolo.
 *   - Coordinates, no image  -> detect_objects_at_location(lat, lon) (objectsDetected).
 */

const H3_RESOLUTION_MAP: Record<string, number> = { low: 7, medium: 8, high: 9 };
const INVALID_IMAGE = new Set(["", "no_objects_found", "no_image_in_demo_mode"]);

function sanitizeImage(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && !INVALID_IMAGE.has(t) ? t : null;
}

export async function POST(req: NextRequest) {
  try {
    const { lat, lon, locationId, resolution = "medium", apiKey, withImage } =
      (await req.json()) as {
        lat?: number;
        lon?: number;
        locationId?: string;
        resolution?: string;
        apiKey?: string;
        withImage?: boolean;
      };

    if (!apiKey) {
      return NextResponse.json({ error: "apiKey required" }, { status: 400 });
    }

    // H3 location-id input, or coordinates + annotated image: use the yolo
    // endpoint keyed by an H3 cell.
    const haveLocationId = typeof locationId === "string" && locationId.length > 0;
    const haveCoords = lat !== undefined && lon !== undefined;

    if (haveLocationId || (haveCoords && withImage)) {
      const cell = haveLocationId
        ? (locationId as string)
        : latLngToCell(lat as number, lon as number, H3_RESOLUTION_MAP[resolution] ?? 8);
      const data = await callBackend<{ objects?: unknown; img_w_objects_detected?: string }>(
        "yoloDetection",
        { json: { location_id: cell, api_key: apiKey }, timeoutMs: 200_000 },
      );
      return NextResponse.json({
        objects: data?.objects ?? null,
        annotatedImage: withImage ? sanitizeImage(data?.img_w_objects_detected) : null,
        resolution,
        lat: haveCoords ? lat : undefined,
        lon: haveCoords ? lon : undefined,
        locationId: cell,
      });
    }

    if (haveCoords) {
      const data = await callBackend<{ objects?: unknown }>("objectsDetected", {
        json: { lat, lon, resolution, api_key: apiKey },
        timeoutMs: 200_000,
      });
      return NextResponse.json({
        objects: data?.objects ?? data ?? null,
        annotatedImage: null,
        resolution,
        lat,
        lon,
      });
    }

    return NextResponse.json(
      { error: "Provide coordinates or an H3 location id" },
      { status: 400 },
    );
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Object detection failed" },
      { status },
    );
  }
}
