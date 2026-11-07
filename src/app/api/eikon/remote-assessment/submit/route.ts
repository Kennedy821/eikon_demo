import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { BACKEND, BackendError, callBackend, type BackendCall } from "@/lib/server/backend";
import {
  jobCache,
  pruneJobCache,
  parseVerificationResult,
  fireBlockingPost,
} from "@/lib/server/remoteAssessmentJobs";

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
/** Cap on country lookups per submit, so an intricate AOI cannot fan out. */
const MAX_COUNTRY_LOOKUPS = 8;

/**
 * Points to try the country lookup against, best first: the centre of the
 * AOI's bounding box, then its corners, then the geometry's own vertices. The
 * centre alone is not enough — the middle of a box drawn over Hong Kong lands
 * in Victoria Harbour, where the lookup answers null and the AOI would be
 * taken for a country it is nowhere near. A vertex on land settles it.
 */
function candidatePoints(geodataframe: unknown): [number, number][] {
  const box = boundingBox(geodataframe);
  if (!box) return [];
  const { minLon, minLat, maxLon, maxLat } = box;

  const points: [number, number][] = [
    [(minLat + maxLat) / 2, (minLon + maxLon) / 2],
    [minLat, minLon],
    [maxLat, maxLon],
    [minLat, maxLon],
    [maxLat, minLon],
  ];

  for (const v of vertices(geodataframe)) {
    if (points.length >= MAX_COUNTRY_LOOKUPS) break;
    points.push(v);
  }
  return points.slice(0, MAX_COUNTRY_LOOKUPS);
}

/** Every [lon, lat] pair in the collection, as [lat, lon]. */
function vertices(geodataframe: unknown): [number, number][] {
  const out: [number, number][] = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node) || out.length >= MAX_COUNTRY_LOOKUPS) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      const [lon, lat] = node as [number, number];
      if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lat, lon]);
      return;
    }
    for (const child of node) walk(child);
  };
  const features = (geodataframe as { features?: unknown })?.features;
  if (Array.isArray(features)) {
    for (const f of features) {
      walk((f as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates);
    }
  }
  return out;
}

function boundingBox(geodataframe: unknown): {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
} | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      const [lon, lat] = node as [number, number];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const child of node) walk(child);
  };

  const features = (geodataframe as { features?: unknown })?.features;
  if (!Array.isArray(features)) return null;
  for (const f of features) {
    walk((f as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates);
  }

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Resolve the country serving a point. The endpoint answers 200 with
 * { country: null } for a point it does not cover — open water, or anywhere
 * outside the served countries — so a null is an answer, not a failure, and
 * the caller moves on to the next candidate point.
 */
async function countryFor(
  location: [number, number],
  apiKey: string,
): Promise<string | null> {
  try {
    const res = await callBackend<{ country?: string | null }>("locationCountry", {
      json: { location, api_key: apiKey },
      timeoutMs: 20_000,
    });
    return res?.country ?? null;
  } catch {
    return null;
  }
}

/** First candidate point that resolves to a country, or null if none do. */
async function countryForAoi(
  geodataframe: unknown,
  apiKey: string,
): Promise<string | null> {
  for (const point of candidatePoints(geodataframe)) {
    const country = await countryFor(point, apiKey);
    if (country) return country;
  }
  return null;
}

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
