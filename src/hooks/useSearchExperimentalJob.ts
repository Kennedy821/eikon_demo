"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { submitSearch, getSearchStatus, getSearchProgress } from "@/lib/api";
import { POLL } from "@/lib/config";
import { stageFromCheckpoint, STAGES, type StageInfo } from "@/lib/searchStages";
import { useAuth } from "./useAuth";
import type { SearchResult } from "@/lib/types";

// Distinct storage key from the production Search tab so an experimental run
// and a production run can be active at the same time without clobbering each
// other's job reference.
const JOB_ID_KEY = "eikon_active_search_experimental_job_id";

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
 * Experimental search job lifecycle — an independent copy of useSearchJob so
 * the Search (experimental) tab can diverge freely without affecting the
 * production Search tab. Same submit→poll pattern; distinct storage/query keys.
 */
export function useSearchExperimentalJob() {
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
      geodataframe?: unknown;
    }) => submitSearch({ ...input, apiKey: apiKey as string }),
    onSuccess: (data) => {
      setExtraResults([]); // a fresh search starts with a clean slate
      setJobId(data.jobId);
    },
  });

  const status = useQuery({
    queryKey: ["search-exp-status", jobId],
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

  // Locations appended after the search — e.g. "More like this" similarity
  // matches. Merged into results so they appear in the Data Table, the Map
  // View, and the CSV export alongside the original search hits.
  const [extraResults, setExtraResults] = useState<SearchResult[]>([]);

  const baseResults: SearchResult[] = useMemo(
    () => (isComplete ? (status.data?.results ?? []) : []),
    [isComplete, status.data],
  );

  const results: SearchResult[] = useMemo(
    () => [...baseResults, ...extraResults],
    [baseResults, extraResults],
  );

  const addResults = useCallback(
    (newOnes: SearchResult[]) => {
      setExtraResults((prev) => {
        const seen = new Set([...baseResults, ...prev].map((r) => r.locationId));
        const fresh = newOnes.filter((r) => r.locationId && !seen.has(r.locationId));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    },
    [baseResults],
  );

  const isRunning = submit.isPending || (!!jobId && !isComplete);

  const progress = useQuery({
    queryKey: ["search-exp-progress", jobId],
    // Scope the poll to this tab's job so two concurrent searches (two tabs,
    // same api key) each track their own progress; jobId is always set here
    // (the query is enabled only when it exists), but the param stays optional
    // so legacy/no-id callers keep the backend's most-recent-job fallback.
    queryFn: () => getSearchProgress(apiKey as string, jobId ?? undefined),
    enabled: !!jobId && !!apiKey && !isComplete,
    refetchInterval: isComplete ? false : POLL.searchProgress,
    retry: false,
  });

  // Compute stage. The progress bar is strictly monotonic — it can only move
  // forward or hold, never rewind. This matters because when the backend job
  // finishes, the progress endpoint returns job_complete=true with an EMPTY
  // latest_ckpt; stageFromCheckpoint("") would otherwise fall through to
  // Stage 0 during the window where results are still transiting to the
  // browser (isComplete stays false until the status payload lands), making a
  // successful search look like it restarted.
  let stage: StageInfo;
  if (isComplete || progress.data?.jobComplete) {
    // Backend is done — pin to the final stage even while results transit.
    stage = STAGES[STAGES.length - 1];
    lastStageRef.current = stage;
  } else if (progress.data?.latestCkpt) {
    const next = stageFromCheckpoint(progress.data.latestCkpt);
    // Only advance; ignore any lower/empty checkpoint so the bar never rewinds.
    if (next.progress >= lastStageRef.current.progress) {
      lastStageRef.current = next;
    }
    stage = lastStageRef.current;
  } else {
    stage = lastStageRef.current;
  }

  // Only surface an error when the job itself has definitively failed —
  // not for transient status/progress poll failures during a live run.
  const jobFailed = status.data?.status === "failed";
  const error = submit.error ?? (jobFailed ? (status.error ?? new Error("Search failed")) : null);

  function reset() {
    setJobId(null);
    setExtraResults([]);
    lastStageRef.current = STAGES[0];
    submit.reset();
  }

  return {
    submit: submit.mutate,
    reset,
    addResults,
    jobId,
    isRunning,
    isComplete,
    results,
    stage,
    error,
  };
}
