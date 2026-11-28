"use client";

import { useCallback, useRef, useState } from "react";
import { runSiteSelection, type SiteSelectionResponse } from "@/lib/api";
import type { Criterion, ScoreColumn, SiteRow } from "@/lib/siteSelection";
import {
  catchmentProblem,
  isCellScope,
  toPayloadLists,
  weightingProblem,
} from "@/lib/siteSelection";
import { useAuth } from "./useAuth";

export interface SiteSelectionRunParams {
  /** The H3 res-9 cells covering the AOI — empty for a backend-resolved scope. */
  h3Cells: string[];
  /** "UK - all", "UK - area", "Map selection", "GeoJSON upload". */
  spatialResolution: string;
  /** The named area, when the scope is a by-area one. */
  selectedArea: string | null;
  /** Which country's areas a named scope is resolved against. */
  country: string;
  desired: Criterion[];
  undesired: Criterion[];
  /** True to score each criterion over its catchment area, not just the cell. */
  catchment: boolean;
  /** Cell -> uploaded location id, so results can be grouped per location. */
  owners: Map<string, string>;
  /** Ring of the AOI's outline, for framing the result map. */
  bounds: [number, number][];
}

export interface SiteSelectionResult {
  rows: SiteRow[];
  cellColumn: string;
  scoreColumns: ScoreColumn[];
  unmatchedCriteria: string[];
  owners: Map<string, string>;
  bounds: [number, number][];
  /** The criteria this table was produced from, as submitted. */
  desired: string[];
  undesired: string[];
  /** The catchment radii in rings, or null for a run without a catchment. */
  catchment: { desired: number[]; undesired: number[] } | null;
}

/**
 * Runs site selection over an area of interest: one backend call returning the
 * net-desired table, which every view on the tab is then a reading of.
 *
 * Single in-flight guard and a reset that clears the result as well as the
 * lock, the same as the risk assessment and corridor hooks.
 */
export function useSiteSelection() {
  const { apiKey } = useAuth();
  const [result, setResult] = useState<SiteSelectionResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (params: SiteSelectionRunParams) => {
      if (inFlight.current || !apiKey) return;
      const {
        h3Cells,
        spatialResolution,
        selectedArea,
        country,
        desired,
        undesired,
        catchment,
        owners,
        bounds,
      } = params;

      setError(null);
      // Only a drawn or uploaded AOI has cells to check: a whole-country or
      // by-area scope is a name the backend resolves.
      if (isCellScope(spatialResolution) && h3Cells.length === 0) {
        setError("No H3 cells fall inside that area. Try a larger area or a buffer.");
        return;
      }

      const d = toPayloadLists(desired);
      const u = toPayloadLists(undesired);
      if (d.criteria.length === 0) {
        setError("Please provide at least one desired criterion.");
        return;
      }
      // The endpoint rejects an empty undesired list, so this is a hard
      // requirement rather than a nicety.
      if (u.criteria.length === 0) {
        setError("Please provide at least one undesired criterion.");
        return;
      }
      const weightIssue = weightingProblem(desired) ?? weightingProblem(undesired);
      if (weightIssue) {
        setError(weightIssue);
        return;
      }
      const catchmentIssue = catchment
        ? (catchmentProblem(desired) ?? catchmentProblem(undesired))
        : null;
      if (catchmentIssue) {
        setError(catchmentIssue);
        return;
      }

      inFlight.current = true;
      setIsRunning(true);
      try {
        const res: SiteSelectionResponse = await runSiteSelection({
          apiKey,
          desiredCriteria: d.criteria,
          undesiredCriteria: u.criteria,
          h3Cells: isCellScope(spatialResolution) ? h3Cells : undefined,
          spatialResolution,
          selectedArea,
          country,
          desiredWeighting: d.weighting,
          undesiredWeighting: u.weighting,
          catchment,
          ...(catchment ? { desiredKrings: d.krings, undesiredKrings: u.krings } : {}),
        });
        setResult({
          rows: res.rows,
          cellColumn: res.cellColumn,
          scoreColumns: res.scoreColumns,
          unmatchedCriteria: res.unmatchedCriteria ?? [],
          owners,
          bounds,
          desired: d.criteria,
          undesired: u.criteria,
          catchment: catchment ? { desired: d.krings, undesired: u.krings } : null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Site selection failed");
      } finally {
        inFlight.current = false;
        setIsRunning(false);
      }
    },
    [apiKey],
  );

  const reset = useCallback(() => {
    inFlight.current = false;
    setIsRunning(false);
    setError(null);
    setResult(null);
  }, []);

  return { run, reset, isRunning, error, result };
}
