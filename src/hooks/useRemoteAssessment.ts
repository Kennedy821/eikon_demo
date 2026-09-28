"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Feature, Polygon } from "geojson";
import { submitRemoteAssessment, getRemoteAssessmentStatus } from "@/lib/api";
import { toGeodataframe, type AoiFeature } from "@/lib/geojsonAoi";
import { POLL } from "@/lib/config";
import { useAuth } from "./useAuth";
import type { RemoteAssessmentCell, RemoteAssessmentProgressDetail } from "@/lib/types";

/** What the user asked for — kept alongside the job so the results view can
 *  label itself and redraw the AOI after a reload. */
export interface RemoteAssessmentRequest {
  inspection: string;
  executionMode: "fast" | "standard";
  area?: string | null;
  /** Single polygon drawn on the map. */
  aoi?: Feature<Polygon> | null;
  /** Polygons from uploaded GeoJSON; each becomes one assessed location. */
  uploaded?: AoiFeature[] | null;
  /** Buffer applied to the uploaded geometry, in metres (0 = none). */
  bufferM?: number;
}

const JOB_KEY = "eikon_active_remote_assessment_job";

/** Consecutive status-poll failures tolerated before the run is called dead. */
const POLL_FAILURES_BEFORE_ERROR = 3;

interface StoredJob {
  jobId: string;
  request: RemoteAssessmentRequest;
}

function readStoredJob(): StoredJob | null {
  try {
    const raw = sessionStorage.getItem(JOB_KEY);
    return raw ? (JSON.parse(raw) as StoredJob) : null;
  } catch {
    return null;
  }
}

function writeStoredJob(job: StoredJob | null) {
  try {
    if (job) sessionStorage.setItem(JOB_KEY, JSON.stringify(job));
    else sessionStorage.removeItem(JOB_KEY);
  } catch {
    /* storage unavailable — degrade gracefully */
  }
}

/**
 * Remote location assessment job lifecycle: submit → poll status → cells.
 * Same shape as the Search job hooks (sessionStorage-backed job reference,
 * monotonic progress, explicit reset for stranded jobs).
 */
export function useRemoteAssessment() {
  const { apiKey } = useAuth();
  const [job, setJobState] = useState<StoredJob | null>(readStoredJob);

  function setJob(next: StoredJob | null) {
    writeStoredJob(next);
    setJobState(next);
  }

  // Progress only moves forward — a transient poll with an empty checkpoint
  // must not snap the bar back to 0.
  const lastProgressRef = useRef(0);
  const lastDetailRef = useRef<RemoteAssessmentProgressDetail | null>(null);
  useEffect(() => {
    setPollFailures(0);
    if (!job) {
      lastProgressRef.current = 0;
      lastDetailRef.current = null;
    }
  }, [job]);

  const submit = useMutation({
    mutationFn: async (request: RemoteAssessmentRequest) => {
      // Both custom-AOI modes send the same shape the SDK builds from
      // gdf[["unique_id","geometry"]].to_json().
      const geodataframe = request.uploaded?.length
        ? toGeodataframe(request.uploaded)
        : request.aoi
          ? {
              type: "FeatureCollection" as const,
              features: [
                {
                  type: "Feature" as const,
                  properties: { unique_id: "aoi_1" },
                  geometry: request.aoi.geometry,
                },
              ],
            }
          : undefined;
      const res = await submitRemoteAssessment({
        apiKey: apiKey as string,
        inspection: request.inspection,
        executionMode: request.executionMode,
        area: geodataframe ? null : request.area,
        geodataframe,
      });
      return { jobId: res.jobId, request };
    },
    onSuccess: (data) => {
      lastProgressRef.current = 0;
      setJob({ jobId: data.jobId, request: data.request });
    },
  });

  const jobId = job?.jobId ?? null;

  // TanStack resets its own failure count at the start of every fetch, so with
  // retry:false it never climbs above 1. Count consecutive poll failures here
  // instead, resetting whenever a poll succeeds.
  const [pollFailures, setPollFailures] = useState(0);

  const status = useQuery({
    queryKey: ["remote-assessment-status", jobId],
    queryFn: () => getRemoteAssessmentStatus(apiKey as string, jobId as string),
    enabled: !!jobId && !!apiKey,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s === "completed" || s === "failed") return false;
      // Give up once the endpoint has failed repeatedly, rather than polling a
      // dead server indefinitely.
      if (pollFailures >= POLL_FAILURES_BEFORE_ERROR) return false;
      return POLL.remoteAssessmentStatus;
    },
    // TanStack pauses interval refetches while the tab is in the background
    // by default. A multi-minute assessment is exactly when users switch away,
    // and the progress bar must keep tracking the backend while they do.
    refetchIntervalInBackground: true,
    // Transient poll failures during a long job are not fatal; a run of them
    // is, and is handled below via failureCount.
    retry: false,
  });

  const isComplete = status.data?.status === "completed";
  const isFailed = status.data?.status === "failed";

  // A status endpoint that keeps failing must not leave the user on a progress
  // bar forever. One or two failures are transient during a long run; several
  // consecutive ones mean the answer is not coming back.
  const pollFailed = !!jobId && pollFailures >= POLL_FAILURES_BEFORE_ERROR;

  // errorUpdatedAt / dataUpdatedAt change once per failed / successful fetch.
  const { isError: pollIsError, errorUpdatedAt, isSuccess: pollIsSuccess, dataUpdatedAt } = status;
  useEffect(() => {
    if (pollIsError) setPollFailures((n) => n + 1);
  }, [pollIsError, errorUpdatedAt]);
  useEffect(() => {
    if (pollIsSuccess) setPollFailures(0);
  }, [pollIsSuccess, dataUpdatedAt]);

  const isRunning =
    submit.isPending || (!!jobId && !isComplete && !isFailed && !pollFailed);

  // Latest structured progress (locations done / total / ETA); kept across
  // transient poll failures so the panel never blanks mid-run.
  const reported = status.data?.progress;
  if (typeof reported === "number" && reported > lastProgressRef.current) {
    lastProgressRef.current = reported;
  }
  if (status.data?.detail) lastDetailRef.current = status.data.detail;
  const progress = isComplete ? 100 : lastProgressRef.current;
  const detail = isComplete ? null : lastDetailRef.current;

  const cells: RemoteAssessmentCell[] = isComplete ? (status.data?.cells ?? []) : [];

  const error =
    submit.error ??
    (isFailed ? new Error(status.data?.error ?? "Assessment failed") : null) ??
    (pollFailed
      ? (status.error ?? new Error("Lost contact with the assessment server."))
      : null);

  function reset() {
    setPollFailures(0);
    setJob(null);
    lastProgressRef.current = 0;
    lastDetailRef.current = null;
    submit.reset();
  }

  return {
    submit: submit.mutate,
    reset,
    jobId,
    request: job?.request ?? null,
    isRunning,
    isComplete,
    progress,
    detail,
    note: isRunning ? (status.data?.note ?? null) : null,
    cells,
    error,
  };
}
