import "./style.css";

import {
  fetchExpandedQuery,
  fetchPageReasoningData,
  getCandidateEmbeddings,
  renderPageData,
  renderRelativePageData,
  getFavIconFromPage,
  updatePageData,
  pageData,
} from "../utils/pageData";
import { getBookmarkedPages, getSearchHistory, comparePages } from "../utils/pageRelevance";
import { getActiveTab, getPageMeaning, cosineSimilarity } from "../utils/helpers";
import { BACKEND_URL } from "../utils/constants";
import { TOP_N, SIMILARITY_THRESHOLD, embedCacheKey, isCacheFresh, jsonHeaders } from "../utils/config";
import type { CacheEntry, CandidateItem, PageMeaning, RankedPage, StoredResults } from "../types";

const container = document.getElementById("page-container") as HTMLElement | null;
const relatedPageContainer = document.getElementById("relevant-pages-container") as HTMLElement;
const inspectButton = document.getElementById("inspect-button") as HTMLButtonElement | null;
const promptButton = document.getElementById("prompt-button") as HTMLButtonElement | null;
const promptInput = document.getElementById("prompt-input") as HTMLInputElement | null;

let isInspecting = false;
let isPromptInspecting = false;

const setInspectState = (isLoading: boolean): void => {
  if (!inspectButton) return;
  inspectButton.disabled = isLoading;
  inspectButton.classList.toggle("opacity-60", isLoading);
  inspectButton.classList.toggle("cursor-not-allowed", isLoading);
};

const setPromptState = (isLoading: boolean): void => {
  if (!promptButton || !promptInput) return;
  promptButton.disabled = isLoading;
  promptInput.disabled = isLoading;
  promptButton.classList.toggle("opacity-60", isLoading);
  promptButton.classList.toggle("cursor-not-allowed", isLoading);
};

const renderInspectionLoading = (message: string): void => {
  relatedPageContainer.innerHTML = `<span class="text-sm text-gray-600">${message}</span>`;
};

const renderInspectionError = (message: string): void => {
  relatedPageContainer.innerHTML = `<span class="text-red-500 text-sm">${message}</span>`;
};

const rankWithFallbacks = async (
  summary: string | null,
  embedding: number[] | null,
  bookmarks: chrome.bookmarks.BookmarkTreeNode[],
  searchHistory: chrome.history.HistoryItem[],
  prompt: string | null,
): Promise<RankedPage[]> => {
  // Either accepts a page summary or a prompt
  const inputQuery = summary || prompt;

  // Tier 1 — local cosine similarity against candidate embeddings (cached where
  // possible, via getCandidateEmbeddings). Fall through on error, empty result,
  // or a weak top score (below SIMILARITY_THRESHOLD) to the LLM reasoning tier.
  if (embedding) {
    try {
      const candidateItems: CandidateItem[] = [
        ...bookmarks.map((b) => ({ url: b.url ?? "", title: b.title ?? "" })),
        ...searchHistory.map((h) => ({ url: h.url ?? "", title: h.title ?? "" })),
      ];
      const embeddings = await getCandidateEmbeddings(candidateItems);
      const scored = candidateItems
        .map((item, i) => ({ ...item, score: cosineSimilarity(embedding, embeddings[i]) }))
        .sort((a, b) => b.score - a.score);
      const top = scored.slice(0, TOP_N);

      if (top.length > 0 && top[0].score >= SIMILARITY_THRESHOLD) {
        return top.map((page) => ({
          url: page.url,
          title: page.title,
          favIcon: getFavIconFromPage(page.url),
          score: page.score,
        }));
      }
      console.warn("Local similarity below threshold. Falling back to LLM reasoning.");
    } catch (embeddingError) {
      console.warn("Local similarity compare failed. Falling back to LLM reasoning.", embeddingError);
    }
  } else {
    console.warn("No query embedding provided. Skipping embedding compare.");
  }

  // Tier 2 — LLM reasoning. Same empty-result guard.
  try {
    const recommendations = await fetchPageReasoningData(inputQuery ?? "", embedding);
    console.log(recommendations);
    const pages = recommendations?.pages ?? [];
    if (pages.length > 0) {
      return pages.slice(0, TOP_N).map((page) => ({
        url: page.url,
        title: page.title,
        favIcon: getFavIconFromPage(page.url),
        reason: page.reason,
        score: 1,
      }));
    }
    console.warn("Reasoning returned no pages. Falling back to local similarity.");
  } catch (reasoningError) {
    console.warn("Reasoning failed. Falling back to local similarity.", reasoningError);
  }

  // Tier 3 — fully local TF-IDF (already capped at TOP_N inside comparePages).
  return comparePages({ id: "prompt-or-inspect" }, bookmarks, searchHistory, inputQuery);
};

// Last ranked results are persisted per tab URL (separate `results` namespace —
// never the `embed` keys, those belong to the embedding cache) so reopening the
// popup can show them without re-running the pipeline. Results go stale much
// faster than embeddings: bookmarks/history shift as the user browses.
const RESULTS_TTL_MS = 60 * 60 * 1000; // 1 hour

const resultsKey = (tabUrl: string): string => `results${tabUrl}`;

const storeResults = async (tabUrl: string, pages: RankedPage[]): Promise<void> => {
  const entry: StoredResults = { pages, savedAt: Date.now() };
  await chrome.storage.local.set({ [resultsKey(tabUrl)]: entry });
};

const loadStoredResults = async (tabUrl: string): Promise<RankedPage[] | null> => {
  const key = resultsKey(tabUrl);
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key] as StoredResults | undefined;
  if (!entry || !Array.isArray(entry.pages) || entry.pages.length === 0) return null;
  if (typeof entry.savedAt !== "number" || Date.now() - entry.savedAt > RESULTS_TTL_MS) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return entry.pages;
};

const runInspection = async (
  tab: chrome.tabs.Tab,
  bookmarks: chrome.bookmarks.BookmarkTreeNode[],
  searchHistory: chrome.history.HistoryItem[],
): Promise<void> => {
  if (isInspecting) return;
  isInspecting = true;
  setInspectState(true);
  renderInspectionLoading("Inspecting page and finding related links...");

  try {
    const cacheKey = embedCacheKey(tab.url ?? "");
    console.log("Cache key: ", cacheKey);
    const cached = await chrome.storage.local.get(cacheKey);
    console.log("Cached: ", cached);
    let generatedPageData: CacheEntry | null = cached[cacheKey] || null;
    console.log("Generated Page Data", generatedPageData);

    // Treat anything that isn't a fresh, well-formed CacheEntry as a miss. This
    // covers legacy raw-array entries and expired embeddings (TTL), clearing
    // them so they get regenerated below.
    if (generatedPageData && !isCacheFresh(generatedPageData)) {
      generatedPageData = null;
      await chrome.storage.local.remove(cacheKey);
    }

    // on-demand trigger on the page data instead of calling fetchGeneratedPageData()
    if (!generatedPageData) {
      const pageResponse = await getPageMeaning(tab.id!)

      if (!pageResponse) 
        renderInspectionError("Cannot read this page.");
      const res = await fetch(`${BACKEND_URL}/process-page`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          id: tab.id,
          name: tab.title || "",
          url: tab.url,
          favIcon: tab.favIconUrl || "",
          description: pageResponse?.description || "",
          body: pageResponse?.body || "",
        }),
      });
      generatedPageData = (await res.json()) as CacheEntry;
      await chrome.storage.local.set({ [cacheKey]: { ...generatedPageData, cachedAt: Date.now() } });
    }
    console.log("Gemini page summary:", generatedPageData.summary);

    console.time("rankWithFallbacks (with summary)");
    const finalResults = await rankWithFallbacks(
      generatedPageData.summary,
      generatedPageData.embedding,
      bookmarks,
      searchHistory,
      null,
    );
    console.timeEnd("rankWithFallbacks (with summary)");
    renderRelativePageData(finalResults, relatedPageContainer);
    if (tab.url) {
      await storeResults(tab.url, finalResults);
    }
  } catch (error) {
    console.error(error);
    renderInspectionError("Failed to inspect this page. Please try again.");
  } finally {
    isInspecting = false;
    setInspectState(false);
  }
};

const runPromptInspection = async (
  bookmarks: chrome.bookmarks.BookmarkTreeNode[],
  searchHistory: chrome.history.HistoryItem[],
): Promise<void> => {
  if (isPromptInspecting) return;
  const prompt = (promptInput?.value || "").trim();
  if (!prompt) return;

  isPromptInspecting = true;
  setPromptState(true);
  renderInspectionLoading("Finding related pages based on your prompt...");

  const { expanded_query, embeddings } = await fetchExpandedQuery(prompt);

  console.log(expanded_query, embeddings);
  try {
    console.time("rankWithFallbacks (with prompt)");
    const finalResults = await rankWithFallbacks(
      null,
      embeddings,
      bookmarks,
      searchHistory,
      expanded_query,
    );
    console.timeEnd("rankWithFallbacks (with prompt)");
    console.log(finalResults);
    renderRelativePageData(finalResults, relatedPageContainer);
  } catch (error) {
    console.error(error);
    renderInspectionError("Failed to process prompt. Please try again.");
  } finally {
    isPromptInspecting = false;
    setPromptState(false);
  }
};

const init = async (): Promise<void> => {
  // Warm up the server by hitting the health endpoint
  fetch(`${BACKEND_URL}/`).catch(() => {});

  // Gets the current page's info along with bookmarks and search histories.
  const tab = await getActiveTab();
  if (tab.url?.startsWith("chrome://")) {
    // Show a warning message if the current page is a chrome:// page
    const warning = document.createElement("div");
    warning.style.background = "#FFF3CD";
    warning.style.color = "#856404";
    warning.style.padding = "12px";
    warning.style.margin = "12px 0";
    warning.style.border = "1px solid #ffeeba";
    warning.style.borderRadius = "4px";
    warning.style.fontSize = "14px";
    warning.style.fontWeight = "500";
    warning.style.display = "flex";
    warning.style.alignItems = "center";
    warning.innerHTML = `
            <svg height="18" viewBox="0 0 24 24" width="18" style="margin-right: 8px;min-width:18px" fill="#856404">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
            </svg>
            <span>Resurface doesn&apos;t work for Chrome system pages like <b>chrome://</b>. Try another webpage!</span>
        `;

    // Find the "Current Page Content" display, and insert after it
    const currentPageEl = document.querySelector("#page-content") || container; // adjust selector as needed
    if (currentPageEl && currentPageEl.parentNode) {
      currentPageEl.parentNode.insertBefore(warning, currentPageEl.nextSibling);
    } else if (container) {
      // fallback: just append to main container
      container.appendChild(warning);
    }
    if (inspectButton) {
      inspectButton.disabled = true;
      inspectButton.classList.add("opacity-60", "cursor-not-allowed");
    }
    if (promptButton) {
      promptButton.disabled = true;
      promptButton.classList.add("opacity-60", "cursor-not-allowed");
    }
  }

  const [bookmarks, searchHistory] = await Promise.all([getBookmarkedPages(), getSearchHistory()]);

  // getPageMeaning messages the content script, which only runs on http/https
  // pages. On restricted tabs (chrome://, Chrome Web Store, view-source:, PDF
  // viewer, other extension pages) the message rejects. That's not fatal — the
  // prompt flow needs no page meaning — so swallow it and keep going so the
  // buttons below still get wired up instead of leaving a dead popup.
  let pageMeaning: PageMeaning | null = null;
  if (tab.id != null) {
    try {
      pageMeaning = await getPageMeaning(tab.id);
    } catch (err) {
      console.warn("Could not read page meaning; continuing without it.", err);
    }
  }

  updatePageData({
    id: tab.id,
    name: tab.title,
    url: tab.url,
    favIcon: tab.favIconUrl,
    description: pageMeaning?.description || "",
    body: pageMeaning?.body || "",
  });

  if (container) {
    renderPageData(pageData, container);
  }

  // Restore the last inspection results for this page (if any and not expired)
  // so closing and reopening the popup doesn't lose them. Inspect still re-runs
  // the pipeline and overwrites.
  if (tab.url) {
    const previousResults = await loadStoredResults(tab.url);
    if (previousResults) {
      renderRelativePageData(previousResults, relatedPageContainer);
    }
  }

  if (inspectButton) {
    inspectButton.addEventListener("click", () => runInspection(tab, bookmarks, searchHistory));
  }

  if (promptButton) {
    promptButton.addEventListener("click", () => runPromptInspection(bookmarks, searchHistory));
  }

  if (promptInput) {
    promptInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        console.log("prompt button entered");
        runPromptInspection(bookmarks, searchHistory);
      }
    });
  }
};

init();
