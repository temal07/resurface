/* 
    popup.js --> Requests the page data from content.js
    once it has the page data, for now it will just print it 
    to the console as a neat object.
*/

import { fetchGeneratedPageData, fetchPageReasoningData, pageData, compareEmbeddingResponse } from "./utils/pageData.js";
import { renderPageData, renderRelativePageData, updatePageData, getFavIconFromPage } from "./utils/pageData.js";
import { getActiveTab, getPageMeaning } from "./utils/helpers.js";
import { getBookmarkedPages, getSearchHistory, comparePages } from "./utils/pageRelevance.js";

const container = document.getElementById("page-container");
const relatedPageContainer = document.getElementById("relevant-pages-container");
const inspectButton = document.getElementById("inspect-button");

let isInspectionInFlight = false;

const runInspection = async () => {
    if (isInspectionInFlight) {
        return;
    }

    isInspectionInFlight = true;
    inspectButton.disabled = true;
    inspectButton.classList.add("opacity-60", "cursor-not-allowed");
    relatedPageContainer.innerHTML = `<p class="text-gray-500 py-2">Inspecting this page...</p>`;

    try {
        const tab = await getActiveTab();
        const bookmarks = await getBookmarkedPages();
        const searchHistory = await getSearchHistory();
        const pageMeaning = await getPageMeaning(tab.id);

        // Update the page data with the current tab + content script extraction.
        updatePageData({
            id: tab.id,
            name: tab.title,
            url: tab.url,
            favIcon: tab.favIconUrl,
            description: pageMeaning.description,
            body: pageMeaning.body,
        });
        renderPageData(pageData, container);

        // Preserve ranking pipeline:
        // 1) backend reasoning from generated summary
        // 2) embedding comparison
        // 3) local similarity fallback over bookmarks/history
        let generatedPageData;
        try {
            generatedPageData = await fetchGeneratedPageData();
        } catch (err) {
            console.warn("Process page failed, proceeding without embedding", err);
            generatedPageData = { summary: null, embedding: null };
        }

        let finalResults;
        try {
            const recommendations = await fetchPageReasoningData(generatedPageData.summary, generatedPageData.embedding);
            finalResults = recommendations.pages.map((page) => ({
                url: page.url,
                title: page.title,
                favIcon: getFavIconFromPage(page.url),
                reason: page.reason,
                score: 1,
            }));
            console.log("FINAL RESULTS COME FROM GEMINI-GENERATED SUMMARY!");
        } catch (err) {
            console.warn("Gemini Summary Failed: Trying Embeddings...", err);
            try {
                const compareData = await compareEmbeddingResponse(
                    generatedPageData.embedding,
                    bookmarks,
                    searchHistory
                );
                finalResults = compareData.pages.map((page) => ({
                    url: page.url,
                    title: page.title,
                    favIcon: getFavIconFromPage(page.url),
                    score: page.score,
                }));
                console.log("FINAL RESULTS COME FROM EMBEDDINGS!");
            } catch (err2) {
                console.warn("Embeddings Failed: Trying Local TF-IDF + COSINE SIM...", err2);
                finalResults = comparePages(pageData, bookmarks, searchHistory, generatedPageData.summary);
                console.log("FINAL RESULTS COME FROM LOCAL TF-IDF + COSINE SIM!");
            }
        }

        renderRelativePageData(finalResults, relatedPageContainer);
    } catch (err) {
        console.error(err);
        container.innerHTML = `<span class="text-red-500">Failed to load page info</span>`;
        relatedPageContainer.innerHTML = `<span class="text-red-500">Failed to load related pages</span>`;
    } finally {
        isInspectionInFlight = false;
        inspectButton.disabled = false;
        inspectButton.classList.remove("opacity-60", "cursor-not-allowed");
    }
};

inspectButton.addEventListener("click", runInspection);