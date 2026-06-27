/** Shared drone-corridor domain types. */

/** One assessment cell as returned by run_assessment_custom_polygon_cuda. */
export interface AssessmentCell {
  h3_index_9: string;
  cum_score: number;
  objects_detected?: unknown;
  [k: string]: unknown;
}

/** A candidate route. Mirrors the dicts from _parse_pathfinder_response. */
export interface DroneRoute {
  percentile: number;
  thresholdValue: number;
  cells: string[];
  coords: [number, number][]; // [lon, lat]
  routeLengthKm: number;
  riskThresholdRank: number;
  routeLengthRank: number;
  combinedRank: number;
  recommended: boolean;
}

export interface CorridorSummary {
  totalCells: number;
  areaKm2: number;
  meanScore: number;
  maxScore: number;
  minScore: number;
  routesFound: number;
  recommendedLengthKm: number | null;
  recommendedThreshold: number | null;
  recommendedPercentile: number | null;
}
