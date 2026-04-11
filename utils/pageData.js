// Handles everything related to the page the user is on.

import { cosineSimilarity } from "./helpers.js";
import { BACKEND_URL } from "./constants.js";
import { getBookmarkedPages, getSearchHistory } from "./pageRelevance.js";

export const pageData = {
    id: "",
    name: "",
    url: "",
    favIcon: "",
    description: "",
    body: "",
}

export const compareEmbeddingResponse = async (embedding, bookmarks, searchHistory) => {
    const res = await fetch(`${BACKEND_URL}/compare-pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            embedding,
            bookmarks: bookmarks.map(b => ({ url: b.url, title: b.title, summary: "" })),
            history: searchHistory.map(h => ({ url: h.url, title: h.title, summary: "", timestamp: h.lastVisitTime?.toString() || null })),
        }),
    });
    const compareData = await res.json();
    return compareData;
}

export const fetchExpandedQuery = async (prompt) => {
    const res = await fetch(`${BACKEND_URL}/expand-prompt`, {
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
    });

    return await res.json();
}


export const fetchUncachedEmbeddings = async (uncachedItems) => {
    const res = await fetch(`${BACKEND_URL}/embed-uncached`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ uncached_items: uncachedItems })
    });

    const data = await res.json();
    return data;
}

export const fetchPageReasoningData = async (inputQuery, embedding) => {
    const currentUrl = (await chrome.tabs.query({ active: true, currentWindow: true }))[0].url;

    const rawBookmarks = await getBookmarkedPages();
    const rawHistory = await getSearchHistory();

    const allItems = [...rawBookmarks, ...rawHistory].filter(item => item.url != currentUrl);
    const cacheKeys = allItems.map(item => `embed${item.url}`);

    const cachedResults = await Promise.all(
        cacheKeys.map(key => chrome.storage.local.get(key))
    );

    const areNotCached = allItems.filter((item, i) => !cachedResults[i][`embed${item.url}`]);
    const areCached = allItems.filter((item, i) => cachedResults[i][`embed${item.url}`]);
    const allCachesCombined = [...areCached, ...areNotCached];

    if (embedding) {
        const uncachedEmbeddings = await fetchUncachedEmbeddings(areNotCached);

        areNotCached.forEach((item, i) => {
            chrome.storage.local.set({ [`embed${item.url}`]: uncachedEmbeddings[i] });
        });

        const cachedEmbeddings = await Promise.all(
            areCached.map(async item => {
                const result = await chrome.storage.local.get(`embed${item.url}`);
                return result[`embed${item.url}`];
            })
        );

        const allEmbeddings = [...cachedEmbeddings, ...uncachedEmbeddings];

        const score = allEmbeddings.map(e => cosineSimilarity(embedding, e));
        const scored = allCachesCombined.map((item, i) => ({ score: score[i], item }));
        const top20 = scored.sort((a, b) => b.score - a.score).slice(0, 20);

        const res = await fetch(`${BACKEND_URL}/page-reasoning`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ summary: inputQuery, top_items: top20.map((x) => ({ title: x.item.title, url: x.item.url })) }),
        });

        return await res.json();

    } else {
        const res = await fetch(`${BACKEND_URL}/page-reasoning`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ summary: inputQuery, top_items: allCachesCombined.slice(0,20).map(item => ({ title: item.title, url: item.url })) }),
        });
    
        return await res.json();
    }
};


export const extractWordsFromUrl = (url) => {
    try {
        const { hostname, pathname, search, hash } = new URL(url);

        // Split on . and - and /
        const parts = [
            ...hostname.split(/[\.\-]/g),
            ...pathname.split(/[\/\-\_]/g),
            ...search.replace(/^\?/, '').split(/[&=_\-]/g),
            ...hash.replace(/^#/, '').split(/[\-_\?&=]/g)
        ];

        // Filter out short/meaningless parts, common TLDs, and empty strings
        return parts
            .map(part => part.trim().toLowerCase())
            .filter(word =>
                word &&
                word.length > 1 &&
                !['www', 'com', 'net', 'org', 'io', 'html', 'htm', 'php', 'www2'].includes(word)
            );
    } catch (e) {
        // fallback for invalid URLs
        return url.split(/[\W_]+/).map(w => w.toLowerCase()).filter(Boolean);
    }
}

export const updatePageData = (newData) => {
    Object.assign(pageData, newData);
}

export const renderPageData = (pageData, container) => {
    // Trim the page name if it's too long (e.g., > 50 chars)
    const trimmedName = pageData.name.length > 20 
        ? pageData.name.slice(0, 17) + "..." 
        : pageData.name;

    const trimmedLink = pageData.url.length > 30
        ? pageData.url.slice(0, 28) + "..."
        : pageData.url;

    container.innerHTML = `
        <ul class="">
            <li class="flex items-center gap-2 py-2 px-2 rounded-md" id=${pageData.id}>
                <img src=${pageData.favIcon} alt="Website 1 Icon" class="w-6 h-6 mr-2 rounded" />
                <span 
                    class="text-gray-700 font-medium flex-none"
                    title="${pageData.name}"
                >
                    ${trimmedName}
                </span>
                <span class="text-gray-400 flex items-center ml-2">
                    <a href=${pageData.url} class="hover:text-blue-700 text-blue-400 truncate max-w-max inline-block align-middle" id="url-1" target="_blank" rel="noopener noreferrer">
                        ${trimmedLink}
                    </a>
                </span>
            </li>
        </ul>
    `;
}

export const renderRelativePageData = (recommendations, container) => {
    container.innerHTML = `
    <ul class="">
        ${
            recommendations.length > 0 ? 
            recommendations.map(page => {
                    const trimmedName = page.title && page.title.length > 20 
                        ? page.title.slice(0, 17) + "..." 
                        : page.title;

                    const trimmedLink = page.url && page.url.length > 30
                        ? page.url.slice(0, 28) + "..."
                        : page.url;

                    return `
                    <li class="flex items-center gap-2 py-2 px-2 rounded-md" id="${page.id || ''}">
                        <img src="${page.favIcon}" alt="Website Icon" class="w-6 h-6 mr-2 rounded" />
                        <span 
                            class="text-gray-700 font-medium flex-none"
                            title="${page.title}"
                        >
                            ${trimmedName}
                        </span>
                        <span class="text-gray-400 flex items-center ml-2">
                            <a href="${page.url}" class="hover:text-blue-700 text-blue-400 truncate max-w-max inline-block align-middle" target="_blank" rel="noopener noreferrer">
                                ${trimmedLink}
                            </a>
                        </span>
                    </li>
                    `;
                }).join('') : `
                <li class="flex items-center gap-2 py-2 px-2 rounded-md">
                    <p class="text-gray-400">No matched results with the page/prompt.</p>
                </li>
                `
        }
    </ul>
    `;
}

export const getFavIconFromPage = (url) => {
    try {
        const { hostname } = new URL(url);
        return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
    } catch (err) {
        return "https://www.google.com/s2/favicons?sz=64&domain=example.com";
    }
}

