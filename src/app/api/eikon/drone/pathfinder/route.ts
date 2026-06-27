import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/drone/pathfinder
 *   { apiKey, originHex, destHex, assessment[], kring }  ->  { routesGdf }
 *
 * Ports the live pathfinder call: POST /eikon_safest_route_pathfinder with the
 * assessment records and kring constraint. Returns the raw routes_gdf JSON
 * string (WKT in EPSG:27700) for the client to parse via parsePathfinderResponse.
 */
export async function POST(req: NextRequest) {
  try {
    const { apiKey, originHex, destHex, assessment, kring } = (await req.json()) as {
      apiKey?: string;
      originHex?: string;
      destHex?: string;
      assessment?: Record<string, unknown>[];
      kring?: number;
    };
    if (!apiKey || !originHex || !destHex || !assessment?.length) {
      return NextResponse.json(
        { error: "apiKey, originHex, destHex and assessment are required" },
        { status: 400 },
      );
    }

    const data = await callBackend<{ routes_gdf?: string }>("safestRoute", {
      json: {
        origin: originHex,
        orig: originHex,
        dest: destHex,
        risk_assessment_df: assessment,
        kring_constraint: kring ?? 0,
        api_key: apiKey,
      },
      timeoutMs: 1_200_000,
    });

    return NextResponse.json({ routesGdf: data?.routes_gdf ?? "[]" });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Pathfinder failed" },
      { status },
    );
  }
}
