// Handles everything related to the page the user is on.

export const pageData = {
    id: "",
    name: "",
    url: "",
    favIcon: "",
    description: "",
    body: "",
}

export const fetchGeneratedPageData = async () => {
    // Since the URL in fetch is a POST req, specify that it is a post request
    // that you're fetching
    const res = await fetch("http://localhost:8000/process-page", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(pageData),
    });

    const data = await res.json();

    return data;
}

export const fetchPageReasoningData = async (summary) => {
    // Fetch bookmarks
    const rawBookmarks = await chrome.bookmarks.getRecent(50);
    const bookmarks = rawBookmarks
        .filter(b => b.url)
        .map(b => ({
            url: b.url,
            title: b.title || "",
            summary: "",
        }));

    // Fetch recent history
    const rawHistory = await chrome.history.search({ text: "", maxResults: 50 });
    const history = rawHistory
        .filter(h => h.url)
        .map(h => ({
            url: h.url,
            title: h.title || "",
            summary: "",
            timestamp: h.lastVisitTime?.toString() || null,
        }));

    const res = await fetch("http://localhost:8000/page-reasoning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, bookmarks, history }),
    });

    const data = await res.json();
    return data;
}

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
            recommendations.slice(0,3)
                .map(page => {
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
                    <p class="text-gray-400">No results found</p>
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