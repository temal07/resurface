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
