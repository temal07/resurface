export const getBookmarkedPages = () => {
    // always reach the bookmarks using a Promise since popup.js needs to display the information.
    // Flattening the bookmark tree means converting the nested bookmark folders and bookmarks into a single-level array
    // of all bookmark nodes (usually just the ones of type 'bookmark', i.e. not folders).
    return new Promise((resolve, reject) => {
        chrome.bookmarks.getTree((bookmarkTreeNode) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError.message);
                return;
            }

            // Helper to recursively collect all bookmark nodes
            const flattenBookmarks = (nodes, out = []) => {
                for (const node of nodes) {
                    if (node.url) {
                        out.push(node);
                    }
                    if (node.children) {
                        flattenBookmarks(node.children, out);
                    }
                }
                return out;
            };

            // bookmarkTreeNode is an array with a single root node
            const flatBookmarks = flattenBookmarks(bookmarkTreeNode);
            resolve(flatBookmarks);
        });
    });
}

let oneWeekAgo = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;

export const getSearchHistory = () => {
    return new Promise((resolve, reject) => {
        if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError.message);
            return;
        }

        chrome.history.search({
            text: '',
            startTime: oneWeekAgo,
            maxResults: 10,
        }, (historyItems) => {
            for (const historyItem of historyItems) {
                console.log(historyItem);
                resolve(historyItem);
            }
        });
    });
}