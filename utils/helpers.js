export const getActiveTab = async () => {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
            }
            if (!tabs || tabs.length === 0) {
                reject(new Error("No active tab found."));
                return;
            }
            resolve(tabs[0]);
        });
    });  
}

export const getPageDescription = (tabId) => {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_DESCRIPTION" }, (res) => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError.message);
            resolve(res.description);
        });
    });
};