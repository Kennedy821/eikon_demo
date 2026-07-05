"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { submitSearch, getSearchStatus, getSearchProgress } from "@/lib/api";
import { POLL } from "@/lib/config";
import { stageFromCheckpoint, STAGES, type StageInfo } from "@/lib/searchStages";
import { useAuth } from "./useAuth";
import type { SearchResult } from "@/lib/types";

const JOB_ID_KEY = "eikon_active_search_job_id";

function readStoredJobId(): string | null {
  try {
    return sessionStorage.getItem(JOB_ID_KEY);
  } catch {
    return null;
  }
}

function writeStoredJobId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(JOB_ID_KEY, id);
    else sessionStorage.removeItem(JOB_ID_KEY);
  } catch {
    /* storage unavailable — degrade gracefully */
  }
}

/**
 * Search job lifecycle — mirrors crawl_uk's submit→poll pattern.
 *
 * jobId is persisted in sessionStorage so navigating away from /search and
 * back during a long moderate/exhaustive run resumes polling rather than
 * losing the job reference and leaving a ghost job running on the backend.
 */
export function useSearchJob() {
  const { apiKey } = useAuth();

  // Initialise from sessionStorage so navigation doesn't wipe an active job.
  const [jobId, setJobIdState] = useState<string | null>(readStoredJobId);

  function setJobId(id: string | null) {
    writeStoredJobId(id);
    setJobIdState(id);
  }

  // Tracks the last successfully-received stage so transient progress poll
  // errors don't snap the progress bar back to Stage 0.
  const lastStageRef = useRef<StageInfo>(STAGES[0]);

  const submit = useMutation({
    mutationFn: (input: {
      prompt: string;
      effort?: string;
      spatialResolution?: string;
      borough?: string | null;
    }) => submitSearch({ ...input, apiKey: apiKey as string }),
    onSuccess: (data) => setJobId(data.jobId),
  });

  const status = useQuery({
    queryKey: ["search-status", jobId],
    queryFn: () => getSearchStatus(jobId as string),
    enabled: !!jobId,
    // Poll at 5s — aggressive enough to catch completion promptly but not
    // hammering the backend for a multi-minute moderate/exhaustive run.
    refetchInterval: (query) =>
      query.state.data?.status === "completed" ? false : POLL.searchStatus,
    // Don't surface transient poll errors as user-facing failures while the
    // job is still running — a 502/timeout during a long search is not fatal.
    retry: false,
  });

  const isComplete = status.data?.status === "completed";
  const results: SearchResult[] = isComplete ? (status.data?.results ?? []) : [];
  const isRunning = submit.isPending || (!!jobId && !isComplete);

  const progress = useQuery({
    queryKey: ["search-progress", jobId],
    queryFn: () => getSearchProgress(apiKey as string),
    enabled: !!jobId && !!apiKey && !isComplete,
    refetchInterval: isComplete ? false : POLL.searchProgress,
    retry: false,
  });

  // Compute stage, but fall back to the last known good stage rather than
  // STAGES[0] when the progress poll is temporarily unavailable.
  let stage: StageInfo;
  if (isComplete) {
    stage = STAGES[STAGES.length - 1];
  } else if (progress.data) {
    stage = stageFromCheckpoint(progress.data.latestCkpt);
    lastStageRef.current = stage;
  } else {
    stage = lastStageRef.current;
  }

  // Only surface an error when the job itself has definitively failed —
  // not for transient status/progress poll failures during a live run.
  const jobFailed = status.data?.status === "failed";
  const error = submit.error ?? (jobFailed ? (status.error ?? new Error("Search failed")) : null);

  function reset() {
    setJobId(null);
    lastStageRef.current = STAGES[0];
    submit.reset();
  }

  return {
    submit: submit.mutate,
    reset,
    jobId,
    isRunning,
    isComplete,
    results,
    stage,
    error,
  };
}
