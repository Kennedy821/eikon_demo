/**
 * SERVER-ONLY readers for the search-job progress files the backend writes to
 * local disk. Ports check_search_progress / get_ai_model_thoughts /
 * parse_model_thought / get_stage_1_info / get_relevant_location_count from
 * eikon_demo_app_beta.py.
 *
 * The Streamlit app reads these because it is co-located with the backend on
 * the same host. The theta route handlers run server-side on that same host,
 * so they read the identical files. Set EIKON_USER_DATA_DIR if the base path
 * differs from the original Mac layout.
 *
 * Import only from route handlers (src/app/api/**).
 */

import fs from "node:fs";
import path from "node:path";

const USER_DATA_DIR =
  process.env.EIKON_USER_DATA_DIR ??
  "/Users/tariromashongamhende/Local Files/ml_projects/satellite_slug/project_eikon/mapping_tables/user_data_tables/users";

function progressDir(apiKey: string): string {
  return path.join(USER_DATA_DIR, apiKey);
}

function modelThoughtsDir(apiKey: string): string {
  return path.join(USER_DATA_DIR, apiKey, "model_thoughts");
}

function safeRead(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

function listFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Ports check_search_progress — the latest stage name + completion flag. */
export function checkSearchProgress(apiKey: string): {
  stage: string | null;
  isComplete: boolean;
} {
  const dir = progressDir(apiKey);
  const stageFiles = listFiles(dir)
    .filter((f) => f.startsWith("stage_") && f.endsWith(".txt"))
    .sort();
  if (stageFiles.length === 0) return { stage: null, isComplete: false };
  const latest = stageFiles[stageFiles.length - 1];
  return {
    stage: latest.replace(/^stage_\d+_complete_/, "").replace(/\.txt$/, "").replace(/_/g, " "),
    isComplete: latest === "stage_6_complete_final_results.txt",
  };
}

/** Ports get_ai_model_thoughts + parse_model_thought (latest evaluation). */
export function getAiModelThoughts(apiKey: string): {
  available: boolean;
  count: number;
  latestEvaluation: string | null;
  latestRationale: string | null;
} {
  const dir = modelThoughtsDir(apiKey);
  const thoughtFiles = listFiles(dir)
    .filter((f) => f.startsWith("thoughts_"))
    .sort();
  if (thoughtFiles.length === 0) {
    return { available: false, count: 0, latestEvaluation: null, latestRationale: null };
  }
  const latest = safeRead(path.join(dir, thoughtFiles[thoughtFiles.length - 1])) ?? "";
  let evaluation: string | null = null;
  let rationale: string | null = null;
  for (const line of latest.split("\n")) {
    if (line.startsWith("AI Evaluation:")) evaluation = line.replace("AI Evaluation:", "").trim();
    else if (line.startsWith("AI Rationale:")) rationale = line.replace("AI Rationale:", "").trim();
  }
  return {
    available: true,
    count: thoughtFiles.length,
    latestEvaluation: evaluation,
    latestRationale: rationale,
  };
}

/** Ports get_stage_1_info — original/cleaned prompt from stage 1. */
export function getStage1Info(apiKey: string): { original: string | null; cleaned: string | null } | null {
  const content = safeRead(path.join(progressDir(apiKey), "stage_1_complete_initial_processing.txt"));
  if (content === null) return null;
  let original: string | null = null;
  let cleaned: string | null = null;
  for (const line of content.split("\n")) {
    if (line.startsWith("Original Prompt:")) original = line.replace("Original Prompt:", "").trim();
    else if (line.startsWith("Cleaned Prompt:")) cleaned = line.replace("Cleaned Prompt:", "").trim();
  }
  return { original, cleaned };
}

/** Ports get_relevant_location_count — candidate count from the latest stage. */
export function getRelevantLocationCount(apiKey: string): number | null {
  const dir = progressDir(apiKey);
  const stageFiles = listFiles(dir)
    .filter((f) => f.startsWith("stage_"))
    .sort();
  if (stageFiles.length === 0) return null;
  const content = safeRead(path.join(dir, stageFiles[stageFiles.length - 1]));
  if (content === null || !content.includes("Relevant Locations to Consider:")) return null;
  const match = /\[([^\]]+)\]/.exec(content);
  if (!match) return null;
  return match[1].split(",").filter((l) => l.trim()).length;
}
