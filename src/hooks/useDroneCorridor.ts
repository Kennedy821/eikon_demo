"use client";

import { useCallback, useRef, useState } from "react";
import { assessCorridor, findSafestRoutes } from "@/lib/api";
import {
  corridorPolygon,
  corridorH3Cells,
  geoToH3,
  parsePathfinderResponse,
  corridorSummary,
  rerankRoutes,
} from "@/lib/geo/corridor";
import type { AssessmentCell, CorridorSummary, DroneRoute } from "@/lib/geo/types";
import { useAuth } from "./useAuth";

export interface DroneResult {
  assessment: AssessmentCell[];
  routes: DroneRoute[];
  summary: CorridorSummary;
  corridorRing: [number, number][]; // [lon, lat]
  origin: [number, number]; // [lat, lon]
  dest: [number, number];
}

export interface DroneRunParams {
  origin: [number, number]; // [lat, lon]
  dest: [number, number];
  bufferMetres: number;
  kring: number;
  criteria: string[];
}

type Phase = "idle" | "assessing" | "routing" | "complete";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "",
  assessing: "Part 1 of 2: Running corridor risk assessment — this may take several minutes…",
  routing: "Part 2 of 2: Identifying the safest routes through the corridor…",
  complete: "Corridor assessment complete.",
};

/**
 * Orchestrates the exact live drone-corridor pipeline from
 * render_drone_corridor_tab: build corridor polygon + H3 cells (client geo),
 * run the assessment (backend), then the safest-route pathfinder (backend),
 * parse + summarise (client geo). Two-phase progress; single in-flight guard.
 */
export function useDroneCorridor() {
  const { apiKey } = useAuth();
  const [result, setResult] = useState<DroneResult | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const isRunning = phase === "assessing" || phase === "routing";

  const run = useCallback(
    async (params: DroneRunParams) => {
      if (inFlight.current || !apiKey) return;
      const { origin, dest, bufferMetres, kring, criteria } = params;

      setError(null);
      setWarning(null);

      if (origin[0] === dest[0] && origin[1] === dest[1]) {
        setError("Origin and destination must be different locations.");
        return;
      }
      if (criteria.length === 0) {
        setError("Please provide at least one assessment criterion.");
        return;
      }

      inFlight.current = true;
      setPhase("assessing");
      try {
        // 1–2. Corridor polygon + H3 res-9 cells (client geo).
        const ring = corridorPolygon(origin, dest, bufferMetres);
        const h9Cells = corridorH3Cells(ring, 9);
        if (h9Cells.length === 0) {
          setError("No H3 cells found in the corridor. Try increasing the buffer width.");
          return;
        }
        if (h9Cells.length > 15000) {
          setWarning(`Large corridor: ${h9Cells.length.toLocaleString()} cells. Assessment may take 5+ minutes.`);
        }

        // 3. Assessment (backend).
        const { assessment } = await assessCorridor({ apiKey, criteria, h3Cells: h9Cells });
        const assessmentRows = assessment as unknown as AssessmentCell[];

        // 4. Origin/dest parent hexes at res 7, then pathfinder (backend).
        setPhase("routing");
        const originHex = geoToH3(origin[0], origin[1], 7);
        const destHex = geoToH3(dest[0], dest[1], 7);
        const { routesGdf } = await findSafestRoutes({
          apiKey,
          originHex,
          destHex,
          assessment,
          kring,
        });

        // 5–6. Parse routes + summary (client geo).
        const routes = parsePathfinderResponse(routesGdf);
        const summary = corridorSummary(assessmentRows, routes);

        setResult({ assessment: assessmentRows, routes, summary, corridorRing: ring, origin, dest });
        setPhase("complete");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Assessment failed");
        setPhase("idle");
      } finally {
        inFlight.current = false;
      }
    },
    [apiKey],
  );

  /** Re-rank routes by safety↔efficiency without re-running the assessment. */
  const rerank = useCallback((safetyWeight: number) => {
    setResult((prev) => (prev ? { ...prev, routes: rerankRoutes(prev.routes, safetyWeight) } : prev));
  }, []);

  const reset = useCallback(() => {
    inFlight.current = false;
    setPhase("idle");
    setError(null);
    setWarning(null);
  }, []);

  return {
    run,
    rerank,
    reset,
    isRunning,
    phaseLabel: PHASE_LABEL[phase],
    phase,
    warning,
    error,
    result,
  };
}
