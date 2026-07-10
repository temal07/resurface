// background.ts and content.ts run in separate contexts in a Chrome extension,
// so they communicate by message passing: background sends EXTRACT_PAGE_MEANING
// and the content script responds with the extracted page meaning.
//
// Cost control: each /process-page call costs 2 Gemini requests, so embedding
// is gated three ways — a dwell timer (skip pages the user bounces off), an
// in-flight set (duplicate `complete` events for the same URL can't double-
// fire while the first request is still pending), and normalized cache keys
// (tracking-param variants of a URL share one entry instead of re-embedding).

import { BACKEND_URL } from "./utils/constants";
import { EMBED_DWELL_MS, embedCacheKey, isCacheFresh, jsonHeaders } from "./utils/config";
import type { PageMeaning, ProcessPageResponse } from "./types";

const pendingEmbeds = new Map<number, ReturnType<typeof setTimeout>>();
const inFlightKeys = new Set<string>();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url || !tab.url.startsWith("http")) return;

  // Restart the dwell clock on every load; a navigation before it fires means
  // the user bounced and the old page never gets embedded.
  const pending = pendingEmbeds.get(tabId);
  if (pending) clearTimeout(pending);

  const url = tab.url;
  pendingEmbeds.set(
    tabId,
    setTimeout(() => {
      pendingEmbeds.delete(tabId);
      void embedIfStillViewing(tabId, url);
    }, EMBED_DWELL_MS),
  );
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const pending = pendingEmbeds.get(tabId);
  if (pending) {
    clearTimeout(pending);
    pendingEmbeds.delete(tabId);
  }
});

const embedIfStillViewing = async (tabId: number, originalUrl: string): Promise<void> => {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return; // tab closed during the dwell window
  }

  // Only embed pages the user is actually looking at. Background tabs are
  // skipped — if one matters later, the popup's on-demand path covers it.
  if (tab.url !== originalUrl || !tab.active) return;

  const cacheKey = embedCacheKey(originalUrl);
  if (inFlightKeys.has(cacheKey)) return;

  const cached = await chrome.storage.local.get(cacheKey);

  // Skip only when a fresh (non-expired) entry already exists; stale ones fall
  // through and get re-embedded, overwriting the old value below.
  if (isCacheFresh(cached[cacheKey])) {
    console.log("Fresh cache exists, skipping embed:", originalUrl);
    return;
  }

  inFlightKeys.add(cacheKey);
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "EXTRACT_PAGE_MEANING",
    })) as PageMeaning | null;

    // Call the process-page endpoint to generate the embedding and summary, then cache the embedding
    const res = await fetch(`${BACKEND_URL}/process-page`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        id: tabId,
        name: tab.title || "",
        url: originalUrl,
        favIcon: tab.favIconUrl || "",
        description: response?.description || "",
        body: response?.body || "",
      }),
    });

    if (!res.ok) return;

    const data = (await res.json()) as ProcessPageResponse;

    // Cache the result keyed by normalized URL
    await chrome.storage.local.set({
      [cacheKey]: {
        summary: data.summary,
        embedding: data.embedding,
        cachedAt: Date.now(),
      },
    });

    console.log("Cached embedding for:", originalUrl);
  } catch (error) {
    console.warn("Background embedding failed:", error);
  } finally {
    inFlightKeys.delete(cacheKey);
  }
};
