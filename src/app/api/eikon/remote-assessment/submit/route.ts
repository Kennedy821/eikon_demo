import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { BACKEND, BackendError, callBackend, type BackendCall } from "@/lib/server/backend";
import {
  jobCache,
  pruneJobCache,
  parseVerificationResult,
  fireBlockingPost,
} from "@/lib/server/remoteAssessmentJobs";
import { countryForAoi } from "@/lib/server/aoiCountry";

/**
 * POST /api/eikon/remote-assessment/submit
 *   { apiKey, inspection, executionMode, area? | geodataframe? }  ->  { jobId }
 *
 * Mirrors eikonsai.jobs.get_location_verification's submit step. The upstream
 * POST blocks until the job completes, so we fire it without awaiting and
 * return the job_id straight away; the status route then polls the
 * completion endpoint (and checks the cached outcome of this POST).
 *
 *   aoi_type "standard": { api_key, aoi_type, inspection_list, area_list, job_id }
 *   aoi_type "custom":   { api_key, aoi_type, geodataframe, crs, inspection_list,
 *                          job_id, unique_id }
 * inspection_list is a single object class (e.g. "solar_panels") or "all".
 *
 * A drawn or uploaded AOI can sit anywhere, so it goes to the _any_country
 * pair with the `country` resolved from its own geometry. A named area stays
 * on the original pair: the country-aware routes reject `area_list`, since an
 * aoi_type of "standard" means the whole country to them. Execution mode picks
 * between fast and standard within whichever pair is used.
 */

const UK = "uk";
/** The backend accepts these for `country`; anything else it rejects. */
const SUPPORTED_COUNTRIES = new Set([UK, "hongkong"]);

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      apiKey?: string;
      inspection?: string;
      executionMode?: "fast" | "standard";
      area?: string | null;
      geodataframe?: unknown;
    };
    const { apiKey, inspection, executionMode = "fast", area, geodataframe } = body;

    if (!apiKey || !inspection) {
      return NextResponse.json({ error: "apiKey and inspection are required" }, { status: 400 });
    }
    if (!area && !geodataframe) {
      return NextResponse.json(
        { error: "Either an area name or a drawn polygon (geodataframe) is required" },
        { status: 400 },
      );
    }

    const jobId = `job_${randomBytes(6).toString("hex")}`;

    const payload: Record<string, unknown> = geodataframe
      ? {
          api_key: apiKey,
          aoi_type: "custom",
          geodataframe,
          crs: "EPSG:4326",
          inspection_list: inspection,
          job_id: jobId,
          unique_id: "unique_id",
        }
      : {
          api_key: apiKey,
          aoi_type: "standard",
          inspection_list: inspection,
          area_list: area,
          job_id: jobId,
        };

    const isStandardCoverage = executionMode === "standard";
    let endpoint: BackendCall = isStandardCoverage
      ? BACKEND.remoteVerificationStandard
      : BACKEND.remoteVerificationFast;

    // Only a custom AOI can fall outside the UK — the named-area list is UK
    // areas, and the country-aware routes do not accept it.
    if (geodataframe) {
      const country = await countryForAoi(geodataframe, apiKey);

      if (!country) {
        return NextResponse.json(
          {
            error:
              "Couldn't tell which country that area is in. Draw it over land in the UK or Hong Kong.",
          },
          { status: 422 },
        );
      }
      if (!SUPPORTED_COUNTRIES.has(country)) {
        return NextResponse.json(
          {
            error: `Remote inspection doesn't cover ${country} yet. Draw an area over the UK or Hong Kong.`,
          },
          { status: 422 },
        );
      }

      endpoint = isStandardCoverage
        ? BACKEND.remoteVerificationStandardAnyCountry
        : BACKEND.remoteVerificationFastAnyCountry;
      payload.country = country;
      payload.spatial_resolution_for_search = "map selection";
    }

    pruneJobCache();
    const cache = jobCache();
    cache.set(jobId, { startedAt: Date.now() });

    // Fire-and-forget: the upstream call blocks for the life of the job, so it
    // goes through a raw http request with no response-headers timeout.
    void fireBlockingPost(endpoint.base, endpoint.path, payload)
      .then(({ status, body }) => {
        const entry = cache.get(jobId) ?? { startedAt: Date.now() };
        if (status >= 200 && status < 300) {
          const data = body as { eikon_remote_location_verification_result?: unknown } | null;
          entry.rows = parseVerificationResult(data?.eikon_remote_location_verification_result);
        } else {
          // A 4xx, or a 500 from the application itself, means the request was
          // rejected and the poll will never complete — fail fast.
          // A 502/503/504 is the gateway, not the app: the job may still be
          // running server-side, so leave it to the poll to rescue.
          const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
          const gatewayError = status === 502 || status === 503 || status === 504;
          entry.error = {
            message: `Backend returned ${status}: ${text.slice(0, 200)}`,
            fatal: status >= 400 && !gatewayError,
          };
        }
        cache.set(jobId, entry);
      })
      .catch((err: unknown) => {
        const entry = cache.get(jobId) ?? { startedAt: Date.now() };
        entry.error = {
          message: err instanceof Error ? err.message : "Assessment request failed",
          fatal: false,
        };
        cache.set(jobId, entry);
      });

    return NextResponse.json({ jobId });
  } catch (err) {
    const status = err instanceof BackendError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Assessment submit failed" },
      { status },
    );
  }
}
