/**
 * Client-side API — calls our own Next.js route handlers under /api/eikon/*,
 * which proxy to the EIKON backends. Same-origin, so no CORS; the api_key never
 * touches an external origin from the browser.
 */

import type { SearchResult, LocationContext, SimilarityResult } from "./types";
import type { RawTrace } from "./chatFormat";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}

// ---- auth ----
export function login(email: string, password: string) {
  return postJson<{ apiKey: string; email: string }>("/api/eikon/auth", { email, password });
}

// ---- credits ----
export function getCredits(apiKey: string) {
  return postJson<{ balance: number | null }>("/api/eikon/credits", { apiKey });
}

// ---- search ----
export function submitSearch(input: {
  prompt: string;
  apiKey: string;
  effort?: string;
  spatialResolution?: string;
  borough?: string | null;
}) {
  return postJson<{ jobId: string }>("/api/eikon/search/submit", input);
}

export function getSearchStatus(jobId: string) {
  return getJson<{ status: string; results?: SearchResult[] }>(
    `/api/eikon/search/status?jobId=${encodeURIComponent(jobId)}`,
  );
}

export interface SearchProgress {
  latestCkpt: string;
  jobComplete: boolean;
  thoughtsCount: number;
  latestEvaluation: string | null;
  candidateCount: number | null;
  stage1: { original: string | null; cleaned: string | null } | null;
}

export function getSearchProgress(apiKey: string) {
  return postJson<SearchProgress>("/api/eikon/search/progress", { apiKey });
}

// ---- context ----
export function getContext(input: {
  lat: number;
  lon: number;
  resolution: string;
  apiKey: string;
}): Promise<LocationContext & { image: string | null }> {
  return postJson("/api/eikon/context", input);
}

// ---- similarity ----
export function getSimilarity(input: {
  location1: [number, number];
  location2: [number, number];
  resolution: string;
  apiKey: string;
  type?: "visual" | "descriptive" | "combined" | "all";
}) {
  return postJson<SimilarityResult>("/api/eikon/similarity", input);
}

// ---- object detection ----
export interface DetectionResponse {
  objects: unknown;
  annotatedImage: string | null;
  resolution: string;
  lat?: number;
  lon?: number;
  locationId?: string;
}

export function detectObjects(input: {
  lat?: number;
  lon?: number;
  locationId?: string;
  resolution: string;
  apiKey: string;
  withImage?: boolean;
}) {
  return postJson<DetectionResponse>("/api/eikon/object-detection", input);
}

// ---- chat ----
export function submitChat(input: {
  message: string;
  modelCotHistory: string[];
  conversationHistory: string[];
  apiKey: string;
}) {
  return postJson<{ jobId: string }>("/api/eikon/chat/submit", input);
}

export function getChatStatus(jobId: string) {
  return getJson<{
    status: string;
    result?: {
      in_conversation_information?: string;
      model_response?: string;
      map_bytes?: string[];
    };
    error?: string;
  }>(`/api/eikon/chat/status?jobId=${encodeURIComponent(jobId)}`);
}

// ---- drone corridor ----
export function assessCorridor(input: { apiKey: string; criteria: string[]; h3Cells: string[] }) {
  return postJson<{ assessment: Record<string, unknown>[] }>("/api/eikon/drone/assess", input);
}

export function findSafestRoutes(input: {
  apiKey: string;
  originHex: string;
  destHex: string;
  assessment: Record<string, unknown>[];
  kring: number;
}) {
  return postJson<{ routesGdf: string }>("/api/eikon/drone/pathfinder", input);
}

export function getChatTraces(apiKey: string, sinceIndex: number) {
  return postJson<{
    traces: RawTrace[];
    latest_index: number;
    is_complete: boolean;
  }>("/api/eikon/chat/traces", { apiKey, sinceIndex });
}

// ---- portfolio ----
export interface PortfolioPair {
  orig: string;
  dest: string;
  origLat: number;
  origLon: number;
  destLat: number;
  destLon: number;
}

export interface PortfolioResult {
  orig: string;
  dest: string;
  similarity: number | null;
}

export function runPortfolio(input: {
  pairs: PortfolioPair[];
  resolution: string;
  similarityType: string;
  apiKey: string;
}) {
  return postJson<{ results: PortfolioResult[] }>("/api/eikon/portfolio", input);
}

// ---- history ----
export interface PreviousSearch {
  columns: string[];
  rows: Record<string, unknown>[];
}

export function getHistory(apiKey: string, numSearches = 3) {
  return postJson<{ searches: PreviousSearch[] }>("/api/eikon/history", { apiKey, numSearches });
}

// ---- memory ----
export interface MemorySnippet {
  id: string;
  type: string;
  content: string;
  created_at: string;
}

export interface MemoryData {
  reflection: { content: string; created_at: string; version: number } | null;
  snippets: MemorySnippet[];
  snippetCountSinceReflection: number;
}

export function getMemory(apiKey: string) {
  return getJson<MemoryData>(`/api/eikon/memory?apiKey=${encodeURIComponent(apiKey)}`);
}

export function reflectMemory(apiKey: string) {
  return postJson<{ reflection: unknown }>("/api/eikon/memory", { apiKey });
}

export async function deleteSnippet(apiKey: string, snippetId: string) {
  const res = await fetch("/api/eikon/memory", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, snippetId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as { ok: boolean };
}
