// Shared types used across the extension contexts (popup, background, content).

/** A word-frequency map (TF) or a raw embedding array. cosineSimilarity accepts both. */
export type FrequencyVector = Record<string, number>;
export type Vector = number[] | FrequencyVector;

/** The current page the popup describes, plus payload sent to /process-page. */
export interface PageData {
  id: string | number;
  name: string;
  url: string;
  favIcon: string;
  description: string;
  body: string;
}

/** chrome.storage.local entry stored under `embed:v2:<url>`.
 *
 *  source tells us how good the embedding is, and what to do next:
 *    "content"     — built from real page text. Done, nothing to improve.
 *    "title"       — built from the title alone. Upgrade when possible.
 *    "unfetchable" — backfill tried and failed (login wall, SPA shell, 403).
 *                    Keeps the title embedding, but never retry the fetch.
 */
export interface CacheEntry {
  summary: string;
  embedding: number[];
  cachedAt?: number;
  source?: "content" | "title" | "unfetchable";
}

/** Result of content.js DOM extraction. */
export interface PageMeaning {
  pageType: PageType;
  title: string;
  description: string;
  urlContext: string;
  body: string;
}

export type PageType = "STATIC_DOMINANT" | "DYNAMIC_DOMINANT";

/** A candidate page rendered in the results list. */
export interface RankedPage {
  url: string;
  title: string;
  favIcon: string | null;
  reason?: string;
  score: number;
  id?: string | number;
}

// --- Backend (FastAPI) response shapes ---

export interface ProcessPageResponse {
  summary: string;
  embedding: number[];
}

export interface ReasoningResponse {
  pages: { url: string; title: string; reason: string }[];
}

export interface ExpandPromptResponse {
  expanded_query: string;
  embeddings: number[];
}

/** Minimal shape of items fed to /embed-uncached and ranking. */
export interface CandidateItem {
  url: string;
  title: string;
}

export interface StoredResults {
  pages: RankedPage[];
  savedAt: number;
}

/** Response item from POST /backfill. */
export interface BackfillItem {
  url: string;
  summary: string;
  embedding: number[];
  status: string; // "ok" when usable; anything else means unfetchable
}