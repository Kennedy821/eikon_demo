/**
 * Search pipeline stage definitions — ported from SEARCH_STAGES and
 * STAGE_DETAIL_MESSAGES in eikon_demo_app_beta.py. Used to drive the staged
 * progress bar from the `latest_ckpt` string returned by check_job_complete.
 */

export interface StageInfo {
  key: string;
  /** 0-100 progress for the bar. */
  progress: number;
  /** Short status line (Stage N/6 …). */
  status: string;
  /** Longer caption describing what's happening. */
  detail: string;
  level: "info" | "success";
}

/** Ordered stages; index in latest_ckpt is matched stage_6 → stage_1. */
export const STAGES: StageInfo[] = [
  {
    key: "stage_0",
    progress: 5,
    status: "Stage 0/6: Warming up search agents…",
    detail: "Initializing pipelines and reserving compute…",
    level: "info",
  },
  {
    key: "stage_1",
    progress: 15,
    status: "Stage 1/6: Done processing your search query…",
    detail: "Translating your query into agent-ready instructions…",
    level: "info",
  },
  {
    key: "stage_2",
    progress: 30,
    status: "Stage 2/6: Done initial screening of locations…",
    detail: "Sweeping the area of interest for candidate locations…",
    level: "info",
  },
  {
    key: "stage_3",
    progress: 50,
    status: "Stage 3/6: Done secondary screening…",
    detail: "Applying advanced filters to shortlist promising sites…",
    level: "info",
  },
  {
    key: "stage_4",
    progress: 65,
    status: "Stage 4/6: Done gathering location context…",
    detail: "Collecting imagery and contextual intel on each site…",
    level: "info",
  },
  {
    key: "stage_5",
    progress: 85,
    status: "Stage 5/6: AI evaluation completed…",
    detail: "AI evaluators scoring every candidate against your brief…",
    level: "info",
  },
  {
    key: "stage_6",
    progress: 100,
    status: "Stage 6/6: Finalizing results…",
    detail: "Packaging final recommendations and visualizations…",
    level: "success",
  },
];

const STAGE_BY_KEY = new Map(STAGES.map((s) => [s.key, s]));

/** Map a `latest_ckpt` string to the furthest stage it mentions. */
export function stageFromCheckpoint(latestCkpt: string): StageInfo {
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (latestCkpt.includes(STAGES[i].key)) return STAGES[i];
  }
  return STAGE_BY_KEY.get("stage_0")!;
}
