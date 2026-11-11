import { NextRequest, NextResponse } from "next/server";
import { callBackend, BackendError } from "@/lib/server/backend";
import { isOsmSearchCountry } from "@/lib/searchPipeline";

/**
 * POST /api/eikon/search/submit
 *   { prompt, apiKey, effort, spatialResolution, borough?, country? }  ->  { jobId }
 *
 * Mirrors search_locations() submit step:
 *   POST ngrok /eikon_search_agent_api_uk_submit
 *   { prompt, api_key, effort_selection, spatial_resolution_for_search, selected_area? }
 *
 * Three upstream pipelines, picked in this order: an OSM country (Spain) goes
 * to the _osm routes, otherwise `rapid` chooses between the rapid and the
 * standard trio.
 */
const VALID_COUNTRIES = ["uk", "hongkong", "spain"];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      prompt?: string;
      apiKey?: string;
      effort?: string;
      spatialResolution?: string;
      borough?: string | null;
      geodataframe?: unknown;
      rapid?: boolean;
      country?: string;
    };
    const {
      prompt,
      apiKey,
      effort = "test",
      spatialResolution = "UK - all",
      borough,
      geodataframe,
      rapid = false,
      country,
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
    const countryValue = (country ?? "uk").toLowerCase();
    if (!VALID_COUNTRIES.includes(countryValue)) {
      return NextResponse.json(
        { error: `country must be one of: ${VALID_COUNTRIES.join(", ")}` },
        { status: 400 },
      );
    }
    // An OSM country goes to the _osm routes whatever `rapid` says, because no
    // rapid _osm pipeline exists upstream. The country alone decides, so the
    // two polling routes reach the same conclusion from the stored job.
    const osm = isOsmSearchCountry(countryValue);
    // Both the rapid and the OSM pipelines are country-aware and want to know
    // which country the search is for.
    if (rapid || osm) {
      payload.country = countryValue;
    }
    // The by-area value is country-prefixed ("UK - area"), so match the suffix
    // rather than one country's literal.
    if (spatialResolution.endsWith(" - area") && borough) {
      payload.selected_area = borough;
    }
    // Custom map-drawn AOI: add the geodataframe (GeoJSON FeatureCollection with
    // a unique_id column, CRS 4326) plus its crs/id descriptors, mirroring the
    // aoi_type=="custom" payload. Only added when a polygon was drawn.
    if (geodataframe) {
      payload.geodataframe = geodataframe;
      payload.crs = "EPSG:4326";
      payload.unique_id = "unique_id";
    }

    const data = await callBackend<{ job_id?: string }>(
      osm ? "rapidSearchSubmitOsm" : rapid ? "rapidSearchSubmit" : "searchSubmit",
      {
        json: payload,
        timeoutMs: 30_000,
      },
    );

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
