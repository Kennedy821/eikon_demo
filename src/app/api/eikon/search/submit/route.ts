import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";

/**
 * POST /api/eikon/search/submit
 *   { prompt, apiKey, effort, spatialResolution, borough? }  ->  { jobId }
 *
 * Mirrors search_locations() submit step:
 *   POST ngrok /eikon_search_agent_api_uk_submit
 *   { prompt, api_key, effort_selection, spatial_resolution_for_search, selected_area? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      prompt?: string;
      apiKey?: string;
      effort?: string;
      spatialResolution?: string;
      borough?: string | null;
    };
    const {
      prompt,
      apiKey,
      effort = "test",
      spatialResolution = "UK - all",
      borough,
    } = body;

    if (!prompt || !apiKey) {
      return NextResponse.json({ error: "prompt and apiKey required" }, { status: 400 });
    }

    const payload: Record<string, unknown> = {
      prompt,
      api_key: apiKey,
      effort_selection: effort,
      spatial_resolution_for_search: spatialResolution,
    };
    if (spatialResolution === "UK - area" && borough) {
      payload.selected_area = borough;
    }

    const data = await callBackend<{ job_id?: string }>("searchSubmit", {
      json: payload,
      timeoutMs: 30_000,
    });

    if (!data?.job_id) {
      return NextResponse.json({ error: "No job_id returned" }, { status: 502 });
    }
    return NextResponse.json({ jobId: data.job_id });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search submit failed" },
      { status },
    );
  }
}
