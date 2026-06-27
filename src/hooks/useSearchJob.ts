"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { submitSearch, getSearchStatus, getSearchProgress } from "@/lib/api";
import { POLL } from "@/lib/config";
import { stageFromCheckpoint, STAGES, type StageInfo } from "@/lib/searchStages";
import { useAuth } from "./useAuth";
import type { SearchResult } from "@/lib/types";

/**
 * Search job lifecycle — mirrors crawl_uk's submit→poll pattern.
 * Submits, stores a jobId, then polls status + the checkJobComplete
 * progress endpoint (for stage display) until "completed".
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
    error: submit.error ?? status.error,
  };
}
