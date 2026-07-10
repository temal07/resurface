// App-level tunables shared across contexts. Kept separate from the gitignored
// constants.ts (which only holds the environment-specific BACKEND_URL).

import type { CacheEntry } from "../types";
import { API_SECRET } from "./constants";

/** Headers for every POST to the backend: JSON + the shared-secret auth header. */
export const jsonHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  "x-api-key": API_SECRET,
});

/** Max results surfaced by every ranking tier, so the popup list stays bounded. */
export const TOP_N = 5;

/**
 * How long a tab must stay on a page before the background worker embeds it.
 * Pages the user bounces off within this window never hit Gemini, which is the
 * single biggest API-cost lever (each /process-page call = 2 Gemini requests).
 */
export const EMBED_DWELL_MS = 15_000;

/** Query params that vary per visit but never change page content. */
const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "ref_src",
  "igshid",
];

/**
 * Canonical URL used for embedding-cache keys: drops the hash and tracking
 * params so `?utm_source=...` variants of the same page share one cache entry
 * instead of each costing a fresh embed. Content-bearing params (e.g. YouTube
 * `?v=`) are preserved.
 */
export const normalizeUrlForCache = (raw: string): string => {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
    return url.toString();
  } catch {
    return raw;
  }
};

/**
 * The one place embedding-cache keys are built. Every reader and writer must
 * use this so normalized writes never become misses elsewhere.
 */
export const embedCacheKey = (url: string): string => `embed${normalizeUrlForCache(url)}`;

/** How long a cached page embedding stays valid before it is re-embedded. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * True when a stored value is a well-formed CacheEntry that hasn't expired.
 * Doubles as a type guard and as the cleanup signal for legacy raw-array
 * entries (which have no `cachedAt` and are therefore treated as stale).
 */
export const isCacheFresh = (entry: unknown): entry is CacheEntry => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const e = entry as Partial<CacheEntry>;
  if (typeof e.cachedAt !== "number" || !Array.isArray(e.embedding)) return false;
  return Date.now() - e.cachedAt < CACHE_TTL_MS;
};