
// You cannot directly "import" extractPageMeaning from content.js in your background/service worker script;
// background.js and content.js run in separate contexts in a Chrome extension, so sharing functions directly is not possible.

// Instead, you should send a message from background.js to content.js,
// and have content.js respond by running extractPageMeaning and returning (sending) the result.

// For example, the background.js logic inside your tab update event would look like this:

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    if (!tab.url || !tab.url.startsWith("http")) return;

    // Send message to content script and get a response
    chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_MEANING" }, (response) => {
        if (chrome.runtime.lastError) {
            console.warn("Could not get page meaning:", chrome.runtime.lastError);
            return;
        }
        console.log("Page meaning extracted:", response);
    });
});