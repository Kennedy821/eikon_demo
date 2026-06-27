/**
 * Domain types for the EIKON front-end.
 * Derived from the data shapes used in eikon_demo_app_beta.py.
 * These will be refined per-tab as exact JSON schemas are confirmed
 * (migration plan §10 action item 4).
 */

// ---- Auth / user ----------------------------------------------------------
export interface AuthState {
  authenticated: boolean;
  apiKey: string | null;
  userEmail: string | null;
}

export interface Credits {
  balance: number;
}

// ---- Search ---------------------------------------------------------------
export type EffortLevel = "low" | "medium" | "high";
export type SpatialResolution = string; // e.g. H3 res label

export interface SearchRequest {
  prompt: string;
  effortLevel: EffortLevel;
  spatialResolution: SpatialResolution;
  borough?: string | null;
}

export interface SearchJob {
  jobId: string;
  status: "queued" | "in_progress" | "complete" | "failed";
  queuePosition?: number;
}

export interface SearchProgress {
  stage: string;
  detail?: string;
  progress?: number; // 0..1
  aiThoughts?: ModelThought[];
}

export interface ModelThought {
  raw: string;
  title?: string;
  body?: string;
}

export interface DetectedObject {
  name: string;
  coverage?: string | number;
}

export interface SearchResult {
  locationId: string;
  lat: number;
  lon: number;
  /** Relevance score 0-1 (from the backend `search_results` column). */
  relevance?: number;
  name?: string;
  description?: string;
  /** AI model evaluation score 0-1; >=0.5 == recommended. */
  aiModelEvaluation?: number | null;
  aiModelRationale?: string | null;
  /** Binary AI evaluation (mock/fallback): 1 == recommended. */
  aiEvaluation?: number | null;
  aiRationale?: string | null;
  objectsDetected?: DetectedObject[];
  /** Full original row, for the Data Table view and CSV export. */
  raw: Record<string, unknown>;
}

// ---- Context / similarity / object detection ------------------------------
export interface LocationContext {
  locationId: string;
  description: string;
  imageBase64?: string | null;
}

export interface SimilarityResult {
  visual?: number;
  descriptive?: number;
  combined?: number;
}

export interface ObjectDetectionResult {
  locationId: string;
  objects: Array<{ label: string; count: number; confidence?: number }>;
  annotatedImageBase64?: string | null;
}

// ---- Chat -----------------------------------------------------------------
export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  images?: string[]; // base64
}

export interface ReasoningTrace {
  index: number;
  text: string;
}

// ---- Drone corridor -------------------------------------------------------
export interface Coords {
  lat: number;
  lon: number;
}

export interface CorridorRequest {
  origin: Coords;
  dest: Coords;
  bufferMetres: number;
  resolution: number;
  criteria: string[];
}

export interface CorridorRoute {
  hexes: string[];
  geojson: unknown; // GeoJSON LineString/Polygon from backend
  safetyScore?: number;
}

export interface CorridorResults {
  assessment: Array<Record<string, unknown>>;
  routes: CorridorRoute[];
}

// ---- Generic API envelope -------------------------------------------------
export interface ApiError {
  status: number;
  message: string;
}
