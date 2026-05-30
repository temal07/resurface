// background.ts and content.ts run in separate contexts in a Chrome extension,
// so they communicate by message passing: background sends EXTRACT_PAGE_MEANING
// and the content script responds with the extracted page meaning.

import { BACKEND_URL } from "./utils/constants";
import { isCacheFresh, jsonHeaders } from "./utils/config";
import type { PageMeaning, ProcessPageResponse } from "./types";

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url || !tab.url.startsWith("http")) return;

  // embedding caching implementation
  const cacheKey = `embed${tab.url}`;
  const cached = await chrome.storage.local.get(cacheKey);

  // Skip only when a fresh (non-expired) entry already exists; stale ones fall
  // through and get re-embedded, overwriting the old value below.
  if (isCacheFresh(cached[cacheKey])) {
    console.log("Fresh cache exists, skipping embed:", tab.url);
    return;
  }

  // Send message to content script and get a response
  chrome.tabs.sendMessage(
    tabId,
    { type: "EXTRACT_PAGE_MEANING" },
    async (response: PageMeaning | null) => {
      if (chrome.runtime.lastError) {
        console.warn("Could not get page meaning:", chrome.runtime.lastError);
        return;
      }

      try {
        // Call the process-page endpoint to generate the embedding and summary, then cache the embedding
        const res = await fetch(`${BACKEND_URL}/process-page`, {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({
            id: tabId,
            name: tab.title || "",
            url: tab.url,
            favIcon: tab.favIconUrl || "",
            description: response?.description || "",
            body: response?.body || "",
          }),
        });

        if (!res.ok) return;

        const data = (await res.json()) as ProcessPageResponse;

        // Cache the result keyed by URL
        await chrome.storage.local.set({
          [cacheKey]: {
            summary: data.summary,
            embedding: data.embedding,
            cachedAt: Date.now(),
          },
        });

        console.log("Cached embedding for:", tab.url);
      } catch (error) {
        console.warn("Background embedding failed:", error);
      }

      console.log("Page meaning extracted:", response);
    },
  );
});
