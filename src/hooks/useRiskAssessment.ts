"use client";

import { useCallback, useRef, useState } from "react";
import { assessArea } from "@/lib/api";
import type { AssessmentCell } from "@/lib/geo/types";
import { useAuth } from "./useAuth";

export interface RiskRunParams {
  /** The H3 res-9 cells covering the AOI, derived client-side. */
  h3Cells: string[];
  criteria: string[];
  /** The AOI itself — the submit route resolves its country from this. */
  geodataframe: unknown;
  /** Only a fallback for when the country lookup cannot place the AOI. */
  country?: string;
  /** Cell -> uploaded location id, so results can be grouped per location. */
  owners: Map<string, string>;
  /** Ring of the AOI's outline, for framing the result map. */
  bounds: [number, number][];
}

export interface RiskResult {
  assessment: AssessmentCell[];
  /** Cell -> location id for the run that produced `assessment`. */
  owners: Map<string, string>;
  bounds: [number, number][];
  /** The country the backend assessed against. */
  country: string;
  criteria: string[];
}

/**
 * Runs the risk half of the drone-corridor pipeline over an arbitrary AOI:
 * the cells are assessed by the backend, then coloured and tabulated here.
 * Single in-flight guard, same as the corridor hook — one assessment at a time.
 *
 * The criteria go up together and come back as one `cum_score` per cell: the
 * combining is the backend's job, so anything per-criterion would have to come
 * from there rather than from one call per criterion here.
 */
export function useRiskAssessment() {
  const { apiKey } = useAuth();
  const [result, setResult] = useState<RiskResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (params: RiskRunParams) => {
      if (inFlight.current || !apiKey) return;
      const { h3Cells, criteria, geodataframe, country, owners, bounds } = params;

      setError(null);
      if (h3Cells.length === 0) {
        setError("No H3 cells fall inside that area. Try a larger area or a buffer.");
        return;
      }
      if (criteria.length === 0) {
        setError("Please provide at least one assessment criterion.");
        return;
      }

      inFlight.current = true;
      setIsRunning(true);
      try {
        const { assessment, country: assessed } = await assessArea({
          apiKey,
          criteria,
          h3Cells,
          geodataframe,
          country,
        });
        setResult({
          assessment: assessment as unknown as AssessmentCell[],
          owners,
          bounds,
          country: assessed,
          criteria,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Assessment failed");
      } finally {
        inFlight.current = false;
        setIsRunning(false);
      }
    },
    [apiKey],
  );

  /**
   * Clear the run: the lock, the error and the result.
   *
   * The result is cleared too, so this returns the tab to its input state
   * rather than releasing the lock and leaving the previous assessment on
   * screen, which read as though the reset had not worked. The inputs are
   * left alone — they are the user's work, and the usual reason to reset is
   * to adjust them and go again.
   */
  const reset = useCallback(() => {
    inFlight.current = false;
    setIsRunning(false);
    setError(null);
    setResult(null);
  }, []);

  return { run, reset, isRunning, error, result };
}
