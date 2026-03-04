import { tokenise, vectorise, cosineSimilarity } from "./helpers.js";
import { extractWordsFromUrl, getFavIconFromPage } from "./pageData.js";

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
            maxResults: 100,
        }, (historyItems) => {
            resolve(historyItems);
        });
    });
}


export const comparePages = (currentPage, bookmarks, historyItems, summary) => {
    // Get every currentPageData into one giant array
    const tokenisedCurrentPage = summary ? tokenise(summary) : [...tokenise(currentPage.name), ...extractWordsFromUrl(currentPage.url)];
    const vectorisedCurrentPage = vectorise(tokenisedCurrentPage);

    // stores the top pages' data
    const results = [];

    // For each bookmark item in user's bookmark, get its tokenised version, vectorise it, and do a cosine similarity
    bookmarks.forEach(bm => {
        const tokenisedBM = [...tokenise(bm.title), ...extractWordsFromUrl(bm.url)];
        const vectorisedBM = vectorise(tokenisedBM);
        const score = cosineSimilarity(vectorisedBM, vectorisedCurrentPage);

        // Push an object into the results array that includes its title
        results.push({
            favIcon: getFavIconFromPage(bm.url),
            score,
            title: bm.title,
            url: bm.url,
        });
    });

    // For each search history item in user's search histories, get its tokenised version, vectorise it, and do a cosine similarity
    historyItems.forEach(hi => {
        const tokenisedHI = [...tokenise(hi.title), ...extractWordsFromUrl(hi.url)];
        const vectorisedHI = vectorise(tokenisedHI);
        const score = cosineSimilarity(vectorisedHI, vectorisedCurrentPage);

        // Push an object into the results array that includes its title
        results.push({
            favIcon: getFavIconFromPage(hi.url),
            score,
            title: hi.title,
            url: hi.url,
        });
    });

    return results.sort((a, b) => b.score - a.score);
}

