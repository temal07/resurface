
// You cannot directly "import" extractPageMeaning from content.js in your background/service worker script;
// background.js and content.js run in separate contexts in a Chrome extension, so sharing functions directly is not possible.

// Instead, you should send a message from background.js to content.js,
// and have content.js respond by running extractPageMeaning and returning (sending) the result.

// For example, the background.js logic inside your tab update event would look like this:

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    if (!tab.url || !tab.url.startsWith("http")) return;

    // embedding caching implementation
    const cacheKey = `embed${tab.url}`;
    const cached = await chrome.storage.local.get(cacheKey);

    if (cached[cacheKey]) {
        console.log("Cache exists already, skipping embed:", tab.url);
        return;
    }

    // Send message to content script and get a response
    chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_MEANING" }, async (response) => {
        if (chrome.runtime.lastError) {
            console.warn("Could not get page meaning:", chrome.runtime.lastError);
            return;
        }

        try {
            // Call the process-page endpoint to generate the embedding and summary, then cache the embedding
            const res = await fetch("https://resurface-si7m.onrender.com/process-page", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: tabId,
                    name: tab.title || "",
                    url: tab.url,
                    favIcon: tab.favIconUrl || "",
                    description: response.description || "",
                    body: response.body || "",
                }),
            });

            if (!res.ok) return;

            const data = await res.json();
            
            // Cache the result keyed by URL
            await chrome.storage.local.set({
                [cacheKey]: {
                    summary: data.summary,
                    embedding: data.embedding,
                    cachedAt: Date.now(),
                }
            });

            console.log("Cached embedding for:", tab.url);
        } catch(error) {
            console.warn("Background embedding failed:", error);
        }

        console.log("Page meaning extracted:", response);
    });
});