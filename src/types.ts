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

/** chrome.storage.local entry stored under `embed<url>`. */
export interface CacheEntry {
  summary: string;
  embedding: number[];
  cachedAt?: number;
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

export interface CompareResponse {
  pages: { url: string; title: string; score: number }[];
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
