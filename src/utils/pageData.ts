// Handles everything related to the page the user is on.

import { cosineSimilarity } from "./helpers";
import { BACKEND_URL } from "./constants";
import { getBookmarkedPages, getSearchHistory } from "./pageRelevance";
import { embedCacheKey, isCacheFresh, jsonHeaders } from "./config";
import type {
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
    const embeddings = await getCandidateEmbeddings(candidateItems);

    const scored = candidateItems.map((item, i) => ({
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
