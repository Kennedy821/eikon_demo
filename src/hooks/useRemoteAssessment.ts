"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Feature, Polygon } from "geojson";
import { submitRemoteAssessment, getRemoteAssessmentStatus } from "@/lib/api";
import { POLL } from "@/lib/config";
import { useAuth } from "./useAuth";
import type { RemoteAssessmentCell, RemoteAssessmentProgressDetail } from "@/lib/types";

/** What the user asked for — kept alongside the job so the results view can
 *  label itself and redraw the AOI after a reload. */
export interface RemoteAssessmentRequest {
  inspection: string;
  executionMode: "fast" | "standard";
  area?: string | null;
  aoi?: Feature<Polygon> | null;
}

const JOB_KEY = "eikon_active_remote_assessment_job";

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
    if (!job) {
      lastProgressRef.current = 0;
      lastDetailRef.current = null;
    }
  }, [job]);

  const submit = useMutation({
    mutationFn: async (request: RemoteAssessmentRequest) => {
      const geodataframe = request.aoi
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

  const status = useQuery({
    queryKey: ["remote-assessment-status", jobId],
    queryFn: () => getRemoteAssessmentStatus(apiKey as string, jobId as string),
    enabled: !!jobId && !!apiKey,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "completed" || s === "failed" ? false : POLL.remoteAssessmentStatus;
    },
    // TanStack pauses interval refetches while the tab is in the background
    // by default. A multi-minute assessment is exactly when users switch away,
    // and the progress bar must keep tracking the backend while they do.
    refetchIntervalInBackground: true,
    // Transient poll failures during a long job are not fatal.
    retry: false,
  });

  const isComplete = status.data?.status === "completed";
  const isFailed = status.data?.status === "failed";
  const isRunning = submit.isPending || (!!jobId && !isComplete && !isFailed);

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
    (isFailed ? new Error(status.data?.error ?? "Assessment failed") : null);

  function reset() {
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
    note: status.data?.note ?? null,
    cells,
    error,
  };
}
