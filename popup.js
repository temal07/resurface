import {
    fetchGeneratedPageData,
    fetchPageReasoningData,
    compareEmbeddingResponse,
    renderPageData,
    renderRelativePageData,
    getFavIconFromPage,
    updatePageData,
    pageData,
} from "./utils/pageData.js";
import { getBookmarkedPages, getSearchHistory, comparePages } from "./utils/pageRelevance.js";
import { getActiveTab, getPageMeaning } from "./utils/helpers.js";
import { BACKEND_URL } from "./utils/constants.js";

const container = document.getElementById("page-container");
const relatedPageContainer = document.getElementById("relevant-pages-container");
const inspectButton = document.getElementById("inspect-button");
const promptButton = document.getElementById("prompt-button");
const promptInput = document.getElementById("prompt-input");

let isInspecting = false;
let isPromptInspecting = false;

const setInspectState = (isLoading) => {
    if (!inspectButton) return;
    inspectButton.disabled = isLoading;
    inspectButton.classList.toggle("opacity-60", isLoading);
    inspectButton.classList.toggle("cursor-not-allowed", isLoading);
};

const setPromptState = (isLoading) => {
    if (!promptButton || !promptInput) return;
    promptButton.disabled = isLoading;
    promptInput.disabled = isLoading;
    promptButton.classList.toggle("opacity-60", isLoading);
    promptButton.classList.toggle("cursor-not-allowed", isLoading);
};

const renderInspectionLoading = (message) => {
    relatedPageContainer.innerHTML = `<span class="text-sm text-gray-600">${message}</span>`;
};

const renderInspectionError = (message) => {
    relatedPageContainer.innerHTML = `<span class="text-red-500 text-sm">${message}</span>`;
};

const rankWithFallbacks = async (summary, embedding, bookmarks, searchHistory, prompt) => {
    // Either accepts a page summary or a prompt
    const inputQuery = summary || prompt;

    try {
        const recommendations = await fetchPageReasoningData(
            inputQuery,
            embedding,
        );
        console.log(recommendations);
        return recommendations.pages.map((page) => ({
            url: page.url,
            title: page.title,
            favIcon: getFavIconFromPage(page.url),
            reason: page.reason,
            score: 1,
        }));
    } catch (reasoningError) {
        console.warn("Reasoning failed. Falling back to embedding compare.", reasoningError);
    }

    if (embedding) {
        try {
            const compareData = await compareEmbeddingResponse(embedding, bookmarks, searchHistory);
            console.log(compareData);
            return compareData.pages.map((page) => ({
                url: page.url,
                title: page.title,
                favIcon: getFavIconFromPage(page.url),
                score: page.score,
            }));
        } catch (embeddingError) {
            console.warn("Embedding compare failed. Falling back to local similarity.", embeddingError);
        }
    } else {
        console.warn("No query embedding provided. Skipping embedding compare fallback.");
    }

    return comparePages({ id: "prompt-or-inspect" }, bookmarks, searchHistory, inputQuery);
};

const runInspection = async (tab, bookmarks, searchHistory) => {
    if (isInspecting) return;
    isInspecting = true;
    setInspectState(true);
    renderInspectionLoading("Inspecting page and finding related links...");

    try {
        const cacheKey = `embed${tab.url}`;
        console.log("Cache key: ", cacheKey);
        const cached = await chrome.storage.local.get(cacheKey);
        console.log("Cached: ", cached);
        let generatedPageData = cached[cacheKey] || null;
        console.log("Generated Page Data", generatedPageData);

        if (!generatedPageData) {
            console.time("fetchGeneratedPageData");
            generatedPageData = await fetchGeneratedPageData();
            console.timeEnd("fetchGeneratedPageData");
            await chrome.storage.local.set({ [cacheKey]: generatedPageData });
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

const runPromptInspection = async (bookmarks, searchHistory) => {
    if (isPromptInspecting) return;
    const prompt = (promptInput?.value || "").trim();
    if (!prompt) return;

    isPromptInspecting = true;
    setPromptState(true);
    renderInspectionLoading("Finding related pages based on your prompt...");

    try {
        console.time("rankWithFallbacks (with prompt)");
        const finalResults = await rankWithFallbacks(
            null,
            null,
            bookmarks,
            searchHistory,
            prompt
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


const init = async () => {
    // Warm up the server by hitting the health endpoint 
    fetch(`${BACKEND_URL}/`).catch(() => {});

    // Gets the current page's info along with bookmarks and search histories. 
    const tab = await getActiveTab();
    if (tab.url.startsWith("chrome://")) {
    // INSERT_YOUR_CODE
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
    } else {
        // fallback: just append to main container
        container.appendChild(warning);
    }
    }

    const [bookmarks, searchHistory] = await Promise.all([getBookmarkedPages(), getSearchHistory()]);
    const pageMeaning = await getPageMeaning(tab.id);

    updatePageData({
        id: tab.id,
        name: tab.title,
        url: tab.url,
        favIcon: tab.favIconUrl,
        description: pageMeaning?.description || "",
        body: pageMeaning?.body || "",
    });

    renderPageData(pageData, container);

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
                runPromptInspection(bookmarks, searchHistory);
            }
        });
    }
};

init();