"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { submitSearch, getSearchStatus, getSearchProgress } from "@/lib/api";
import { POLL } from "@/lib/config";
import { stageFromCheckpoint, STAGES, type StageInfo } from "@/lib/searchStages";
import { useAuth } from "./useAuth";
import type { SearchResult } from "@/lib/types";

/**
 * Search job lifecycle — replaces search_locations()'s blocking
 * submit + time.sleep poll loop. Submitting stores a jobId; a polling query
 * then refetches status every POLL.searchStatus ms until "completed".
 *
 * Crucially, the UI never unmounts/reruns while polling (the Streamlit pain).
 */
export function useSearchJob() {
  const { apiKey } = useAuth();
  const [jobId, setJobId] = useState<string | null>(null);

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
    refetchInterval: (query) =>
      query.state.data?.status === "completed" ? false : POLL.searchStatus,
  });

  const isComplete = status.data?.status === "completed";
  const results: SearchResult[] = isComplete ? (status.data?.results ?? []) : [];
  const isRunning = submit.isPending || (!!jobId && !isComplete);

  // Stage-progress poll (check_job_complete) — runs alongside the result poll.
  const progress = useQuery({
    queryKey: ["search-progress", jobId],
    queryFn: () => getSearchProgress(apiKey as string),
    enabled: !!jobId && !!apiKey && !isComplete,
    refetchInterval: isComplete ? false : POLL.searchProgress,
  });

  const stage: StageInfo = isComplete
    ? STAGES[STAGES.length - 1]
    : progress.data
      ? stageFromCheckpoint(progress.data.latestCkpt)
      : STAGES[0];

  // Stage-specific caption enrichments (mirror the Streamlit per-stage logic),
  // sourced from the server-side progress files.
  let stageCaptionExtra: string | null = null;
  const p = progress.data;
  if (p) {
    if (stage.key === "stage_2" && p.candidateCount) {
      stageCaptionExtra = `(${p.candidateCount} candidate locations under review)`;
    } else if (stage.key === "stage_5" && p.thoughtsCount > 0) {
      const icon = p.latestEvaluation === "1" ? "✅" : "❌";
      stageCaptionExtra = `Evaluated ${p.thoughtsCount} locations… Latest: ${icon}`;
    }
  }

  function reset() {
    setJobId(null);
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
    stageCaptionExtra,
    stage1Info: progress.data?.stage1 ?? null,
    error: submit.error ?? status.error,
  };
}
