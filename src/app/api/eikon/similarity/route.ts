import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError, type BackendKey } from "@/lib/server/backend";

/**
 * POST /api/eikon/similarity
 *   { location1:[lat,lon], location2:[lat,lon], resolution, apiKey, type? }
 *   -> { visual?, descriptive?, combined? }
 *
 * Mirrors eikonsai.similarity.{visual,descriptive,combined}_similarity
 * (POST pagekite /get_similarity_image, /get_similarity_descriptive,
 *  /get_combined_location_similarity).
 * `type` selects which to compute; omit/"all" computes all three in parallel.
 */

const SIM_ENDPOINTS = {
  visual: { key: "visualSimilarity" as BackendKey, field: "location_pair_similarity_value" },
  descriptive: {
    key: "descriptiveSimilarity" as BackendKey,
    field: "location_pair_descriptive_similarity_value",
  },
  combined: { key: "combinedSimilarity" as BackendKey, field: "combined_similarity_value" },
} as const;

type SimType = keyof typeof SIM_ENDPOINTS;

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

    const payload = {
      text: "placeholder",
      location_1: [location1[0], location1[1]],
      location_2: [location2[0], location2[1]],
      api_key: apiKey,
      resolution,
    };

    const wanted: SimType[] = type === "all" ? ["visual", "descriptive", "combined"] : [type];

    const results = await Promise.allSettled(
      wanted.map((t) =>
        callBackend<Record<string, unknown>>(SIM_ENDPOINTS[t].key, { json: payload }),
      ),
    );

    const out: Record<string, number> = {};
    let firstError: string | null = null;
    wanted.forEach((t, i) => {
      const r = results[i];
      if (r.status === "fulfilled") {
        const raw = r.value?.[SIM_ENDPOINTS[t].field];
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
