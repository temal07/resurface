// Handles everything related to the page the user is on.

import { cosineSimilarity } from "./helpers";
import { BACKEND_URL } from "./constants";
import { getBookmarkedPages, getSearchHistory, topCandidatesByLocalScore } from "./pageRelevance";
import { BACKFILL_BATCH, EMBEDDING_CANDIDATE_CAP, embedCacheKey, isCacheFresh, jsonHeaders } from "./config";
import type {
  BackfillItem,
  CacheEntry,
  CandidateItem,
  ExpandPromptResponse,
  PageData,
  RankedPage,
  ReasoningResponse,
} from "../types";

export const pageData: PageData = {
  id: "",
  name: "",
  url: "",
  favIcon: "",
  description: "",
  body: "",
};

export const fetchExpandedQuery = async (prompt: string): Promise<ExpandPromptResponse> => {
  const res = await fetch(`${BACKEND_URL}/expand-prompt`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);

  return (await res.json()) as ExpandPromptResponse;
};

export const fetchUncachedEmbeddings = async (
  uncachedItems: CandidateItem[],
): Promise<number[][]> => {
  const res = await fetch(`${BACKEND_URL}/embed-uncached`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ uncached_items: uncachedItems }),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);

  const data = (await res.json()) as number[][];
  return data;
};

/**
 * Resolves embeddings for a list of candidates, hitting `/embed-uncached` only
 * for genuine cache misses. Returned embeddings line up index-for-index with
 * `items`. Every fresh embedding is written back in the canonical CacheEntry
 * shape ({ summary, embedding, cachedAt }) — matches what background.ts writes.
 */
export const getCandidateEmbeddings = async (items: CandidateItem[]): Promise<number[][]> => {
  const cacheKeys = items.map((item) => embedCacheKey(item.url));
  const cachedResults = await Promise.all(cacheKeys.map((key) => chrome.storage.local.get(key)));

  // Stale or malformed entries (no cachedAt, expired, or legacy raw arrays) are
  // treated as uncached so they get re-embedded with a fresh, uniform shape.
  const uncachedIndices: number[] = [];
  const uncachedItems: CandidateItem[] = [];
  items.forEach((item, i) => {
    if (!isCacheFresh(cachedResults[i][cacheKeys[i]])) {
      uncachedIndices.push(i);
      uncachedItems.push(item);
    }
  });

  const uncachedEmbeddings =
    uncachedItems.length > 0 ? await fetchUncachedEmbeddings(uncachedItems) : [];

  uncachedItems.forEach((item, i) => {
    chrome.storage.local.set({
      [embedCacheKey(item.url)]: { summary: "", embedding: uncachedEmbeddings[i], cachedAt: Date.now(), source: "title" },
    });
  });

  const embeddings: number[][] = new Array(items.length);
  uncachedIndices.forEach((itemIndex, i) => {
    embeddings[itemIndex] = uncachedEmbeddings[i];
  });
  items.forEach((_, i) => {
    if (embeddings[i]) return;
    embeddings[i] = cachedResults[i][cacheKeys[i]].embedding as number[];
  });

  return embeddings;
};

/**
 * Upgrades title-only cache entries to content-based ones by re-fetching the
 * page server-side. Runs AFTER results are shown, never before: a backfill
 * round-trip is ~7s and the user is already looking at their results. The
 * payoff lands on the next search instead.
 *
 * Deliberately fire-and-forget — nothing awaits this, and any failure is
 * swallowed. A failed upgrade leaves the existing title embedding in place,
 * so the worst case is "no better than before", never "worse".
 */
export const backfillTitleOnly = async (candidates: CandidateItem[]): Promise<void> => {
  
  const keys = candidates.map((c) => embedCacheKey(c.url));
  const stored = await Promise.all(keys.map((k) => chrome.storage.local.get(k)));

  // Only "title" entries are eligible. "content" is already done, and
  // "unfetchable" failed before — retrying it burns quota for a known miss.
  const eligible = candidates.filter((_, i) => {
    const entry = stored[i][keys[i]] as CacheEntry | undefined;
    return entry?.source === "title";
  });

  
  if (eligible.length === 0) return;

  const batch = eligible.slice(0, BACKFILL_BATCH);

  let items: BackfillItem[];
  try {
    const res = await fetch(`${BACKEND_URL}/backfill`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ urls: batch.map((c) => c.url) }),
    });
    if (!res.ok) return;
    ({ items } = (await res.json()) as { items: BackfillItem[] });
  } catch {
    return; // offline, rate-limited, cold start — try again next search
  }

  // One batched write rather than N. Chrome throttles storage writes per
  // minute, and a per-item loop here is the easiest way to hit that ceiling.
  const updates: Record<string, CacheEntry> = {};
  for (const item of items) {
    const key = embedCacheKey(item.url);

    if (item.status === "ok" && item.embedding.length > 0) {
      updates[key] = {
        summary: item.summary,
        embedding: item.embedding,
        cachedAt: Date.now(),
        source: "content",
      };
    } else {
      // Preserve the existing title embedding; only mark it as a dead end so
      // future searches skip it. Without this, every search retries every
      // login page in the user's bookmarks, forever.
      const existing = (await chrome.storage.local.get(key))[key] as CacheEntry | undefined;
      if (!existing) continue;
      updates[key] = { ...existing, source: "unfetchable" };
    }
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
};

export const fetchPageReasoningData = async (
  inputQuery: string,
  embedding: number[] | null,
): Promise<ReasoningResponse> => {
  const currentUrl = (await chrome.tabs.query({ active: true, currentWindow: true }))[0].url;

  const rawBookmarks = await getBookmarkedPages();
  const rawHistory = await getSearchHistory();

  const allItems = [...rawBookmarks, ...rawHistory]
    .filter((item) => item.url != currentUrl)
    .filter((item) => (item.title?.trim() || item.url?.trim()));
  
  const candidateItems: CandidateItem[] = allItems.map((item) => ({
    url: item.url ?? "",
    title: item.title ?? "",
  }));

  if (embedding) {
    // Same pre-filter as tier 1: cap what gets resolved to embeddings so a
    // large history pool doesn't mean a large /embed-uncached batch here too.
    const capped = topCandidatesByLocalScore(candidateItems, inputQuery, EMBEDDING_CANDIDATE_CAP);
    const embeddings = await getCandidateEmbeddings(capped);

    const scored = capped.map((item, i) => ({
      score: cosineSimilarity(embedding, embeddings[i]),
      item,
    }));
    const top20 = scored.sort((a, b) => b.score - a.score).slice(0, 20);

    const res = await fetch(`${BACKEND_URL}/page-reasoning`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        summary: inputQuery,
        top_items: top20.map((x) => ({ title: x.item.title, url: x.item.url })),
      }),
    });

    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);

    return (await res.json()) as ReasoningResponse;
  } else {
    const res = await fetch(`${BACKEND_URL}/page-reasoning`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        summary: inputQuery,
        top_items: candidateItems.slice(0, 20).map((item) => ({ title: item.title, url: item.url })),
      }),
    });

    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);

    return (await res.json()) as ReasoningResponse;
  }
};

export const extractWordsFromUrl = (url: string): string[] => {
  try {
    const { hostname, pathname, search, hash } = new URL(url);

    // Split on . and - and /
    const parts = [
      ...hostname.split(/[\.\-]/g),
      ...pathname.split(/[\/\-\_]/g),
      ...search.replace(/^\?/, "").split(/[&=_\-]/g),
      ...hash.replace(/^#/, "").split(/[\-_\?&=]/g),
    ];

    // Filter out short/meaningless parts, common TLDs, and empty strings
    return parts
      .map((part) => part.trim().toLowerCase())
      .filter(
        (word) =>
          word &&
          word.length > 1 &&
          !["www", "com", "net", "org", "io", "html", "htm", "php", "www2"].includes(word),
      );
  } catch {
    // fallback for invalid URLs
    return url
      .split(/[\W_]+/)
      .map((w) => w.toLowerCase())
      .filter(Boolean);
  }
};

export const updatePageData = (newData: Partial<PageData>): void => {
  Object.assign(pageData, newData);
};

export const renderPageData = (data: PageData, container: HTMLElement): void => {
  // Trim the page name if it's too long (e.g., > 50 chars)
  const trimmedName = data.name.length > 20 ? data.name.slice(0, 17) + "..." : data.name;

  const trimmedLink = data.url.length > 30 ? data.url.slice(0, 28) + "..." : data.url;

  container.innerHTML = `
        <ul class="">
            <li class="flex items-center gap-2 py-2 px-2 rounded-md" id=${data.id}>
                <img src=${data.favIcon} alt="Website 1 Icon" class="w-6 h-6 mr-2 rounded" />
                <span
                    class="text-gray-700 font-medium flex-none"
                    title="${data.name}"
                >
                    ${trimmedName}
                </span>
                <span class="text-gray-400 flex items-center ml-2">
                    <a href=${data.url} class="hover:text-blue-700 text-blue-400 truncate max-w-max inline-block align-middle" id="url-1" target="_blank" rel="noopener noreferrer">
                        ${trimmedLink}
                    </a>
                </span>
            </li>
        </ul>
    `;
};

export const renderRelativePageData = (
  recommendations: RankedPage[],
  container: HTMLElement,
): void => {
  container.innerHTML = `
    <ul class="">
        ${
          recommendations.length > 0
            ? recommendations
                .map((page) => {
                  const trimmedName =
                    page.title && page.title.length > 20 ? page.title.slice(0, 17) + "..." : page.title;

                  const trimmedLink =
                    page.url && page.url.length > 30 ? page.url.slice(0, 28) + "..." : page.url;

                  return `
                    <li class="flex items-center gap-2 py-2 px-2 rounded-md" id="${page.id || ""}">
                        <img src="${page.favIcon}" alt="Website Icon" class="w-6 h-6 mr-2 rounded" />
                        <span
                            class="text-gray-700 font-medium flex-none"
                            title="${page.title}"
                        >
                            ${trimmedName}
                        </span>
                        <span class="text-gray-400 flex items-center ml-2">
                            <button class="hover:text-blue-700 text-blue-400 truncate max-w-max inline-block align-middle open-tab-btn cursor-pointer" data-url="${page.url}">
                                ${trimmedLink}
                            </button>
                        </span>
                    </li>
                    `;
                })
                .join("")
            : `
                <li class="flex items-center gap-2 py-2 px-2 rounded-md">
                    <p class="text-gray-400">No matched results with the page/prompt.</p>
                </li>
                `
        }
    </ul>
    `;

  container.querySelectorAll<HTMLButtonElement>(".open-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      chrome.tabs.create({ url: btn.dataset.url, active: false });
    });
  });
};

export const getFavIconFromPage = (url: string): string => {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
  } catch {
    return "https://www.google.com/s2/favicons?sz=64&domain=example.com";
  }
};
