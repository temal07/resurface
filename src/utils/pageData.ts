// Handles everything related to the page the user is on.

import { cosineSimilarity } from "./helpers";
import { BACKEND_URL } from "./constants";
import { getBookmarkedPages, getSearchHistory } from "./pageRelevance";
import { isCacheFresh } from "./config";
import type {
  CandidateItem,
  CompareResponse,
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

export const compareEmbeddingResponse = async (
  embedding: number[],
  bookmarks: chrome.bookmarks.BookmarkTreeNode[],
  searchHistory: chrome.history.HistoryItem[],
): Promise<CompareResponse> => {
  const res = await fetch(`${BACKEND_URL}/compare-pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embedding,
      bookmarks: bookmarks.map((b) => ({ url: b.url, title: b.title, summary: "" })),
      history: searchHistory.map((h) => ({
        url: h.url,
        title: h.title,
        summary: "",
        timestamp: h.lastVisitTime?.toString() || null,
      })),
    }),
  });
  const compareData = (await res.json()) as CompareResponse;
  return compareData;
};

export const fetchExpandedQuery = async (prompt: string): Promise<ExpandPromptResponse> => {
  const res = await fetch(`${BACKEND_URL}/expand-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  return (await res.json()) as ExpandPromptResponse;
};

export const fetchUncachedEmbeddings = async (
  uncachedItems: CandidateItem[],
): Promise<number[][]> => {
  const res = await fetch(`${BACKEND_URL}/embed-uncached`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uncached_items: uncachedItems }),
  });

  const data = (await res.json()) as number[][];
  return data;
};

export const fetchPageReasoningData = async (
  inputQuery: string,
  embedding: number[] | null,
): Promise<ReasoningResponse> => {
  const currentUrl = (await chrome.tabs.query({ active: true, currentWindow: true }))[0].url;

  const rawBookmarks = await getBookmarkedPages();
  const rawHistory = await getSearchHistory();

  const allItems = [...rawBookmarks, ...rawHistory].filter((item) => item.url != currentUrl);
  const cacheKeys = allItems.map((item) => `embed${item.url}`);

  const cachedResults = await Promise.all(cacheKeys.map((key) => chrome.storage.local.get(key)));

  // Stale or malformed entries (no cachedAt, expired, or legacy raw arrays) are
  // treated as uncached so they get re-embedded with a fresh, uniform shape.
  const areNotCached = allItems.filter((item, i) => !isCacheFresh(cachedResults[i][`embed${item.url}`]));
  const areCached = allItems.filter((item, i) => isCacheFresh(cachedResults[i][`embed${item.url}`]));
  const allCachesCombined = [...areCached, ...areNotCached];

  if (embedding) {
    const uncachedItems: CandidateItem[] = areNotCached.map((item) => ({
      url: item.url ?? "",
      title: item.title ?? "",
    }));
    const uncachedEmbeddings = await fetchUncachedEmbeddings(uncachedItems);

    // Write the canonical CacheEntry shape ({ summary, embedding, cachedAt }) so
    // every reader can rely on `.embedding` — matches what background.ts writes.
    areNotCached.forEach((item, i) => {
      chrome.storage.local.set({
        [`embed${item.url}`]: { summary: "", embedding: uncachedEmbeddings[i], cachedAt: Date.now() },
      });
    });

    const cachedEmbeddings = await Promise.all(
      areCached.map(async (item) => {
        const result = await chrome.storage.local.get(`embed${item.url}`);
        const val = result[`embed${item.url}`];
        return (val?.embedding ?? val) as number[];
      }),
    );

    const allEmbeddings = [...cachedEmbeddings, ...uncachedEmbeddings];

    const score = allEmbeddings.map((e) => cosineSimilarity(embedding, e));
    const scored = allCachesCombined.map((item, i) => ({ score: score[i], item }));
    const top20 = scored.sort((a, b) => b.score - a.score).slice(0, 20);

    const res = await fetch(`${BACKEND_URL}/page-reasoning`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: inputQuery,
        top_items: top20.map((x) => ({ title: x.item.title, url: x.item.url })),
      }),
    });

    return (await res.json()) as ReasoningResponse;
  } else {
    const res = await fetch(`${BACKEND_URL}/page-reasoning`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: inputQuery,
        top_items: allCachesCombined.slice(0, 20).map((item) => ({ title: item.title, url: item.url })),
      }),
    });

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
