import "./style.css";

import {
  fetchExpandedQuery,
  fetchPageReasoningData,
  compareEmbeddingResponse,
  renderPageData,
  renderRelativePageData,
  getFavIconFromPage,
  updatePageData,
  pageData,
} from "../utils/pageData";
import { getBookmarkedPages, getSearchHistory, comparePages } from "../utils/pageRelevance";
import { getActiveTab, getPageMeaning } from "../utils/helpers";
import { BACKEND_URL } from "../utils/constants";
import { TOP_N, isCacheFresh } from "../utils/config";
import type { CacheEntry, PageMeaning, RankedPage } from "../types";

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

  // Tier 1 — LLM reasoning. Fall through on error OR on an empty result set
  // (a 200 with no pages is still a failure for our purposes).
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
    console.warn("Reasoning returned no pages. Falling back to embedding compare.");
  } catch (reasoningError) {
    console.warn("Reasoning failed. Falling back to embedding compare.", reasoningError);
  }

  // Tier 2 — server-side embedding compare. Same empty-result guard.
  if (embedding) {
    try {
      const compareData = await compareEmbeddingResponse(embedding, bookmarks, searchHistory);
      console.log(compareData);
      const pages = compareData?.pages ?? [];
      if (pages.length > 0) {
        return pages.slice(0, TOP_N).map((page) => ({
          url: page.url,
          title: page.title,
          favIcon: getFavIconFromPage(page.url),
          score: page.score,
        }));
      }
      console.warn("Embedding compare returned no pages. Falling back to local similarity.");
    } catch (embeddingError) {
      console.warn("Embedding compare failed. Falling back to local similarity.", embeddingError);
    }
  } else {
    console.warn("No query embedding provided. Skipping embedding compare fallback.");
  }

  // Tier 3 — fully local TF-IDF (already capped at TOP_N inside comparePages).
  return comparePages({ id: "prompt-or-inspect" }, bookmarks, searchHistory, inputQuery);
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
    const cacheKey = `embed${tab.url}`;
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
      const pageResponse = (await chrome.tabs.sendMessage(tab.id!, {
        type: "EXTRACT_PAGE_MEANING",
      })) as PageMeaning;
      const res = await fetch(`${BACKEND_URL}/process-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: tab.id,
          name: tab.title || "",
          url: tab.url,
          favIcon: tab.favIconUrl || "",
          description: pageResponse.description || "",
          body: pageResponse.body || "",
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
  const pageMeaning = tab.id != null ? await getPageMeaning(tab.id) : null;

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
