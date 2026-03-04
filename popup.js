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

const init = async () => {
    try {
        const tab = await getActiveTab();
        const bookmarks = await getBookmarkedPages();
        const searchHistory = await getSearchHistory();

        const pageMeaning = await getPageMeaning(tab.id);

        updatePageData({ 
            id: tab.id, 
            name: tab.title, 
            url: tab.url, 
            favIcon: tab.favIconUrl, 
            description: pageMeaning.description,
            body: pageMeaning.body,
        });

        const generatedPageData = await fetchGeneratedPageData();

        let finalResults;

        try {
            // Primary: embedding-based similarity
            const compareData = await compareEmbeddingResponse();
            finalResults = compareData.pages.map(page => ({
                url: page.url,
                title: page.title,
                favIcon: getFavIconFromPage(page.url),
                score: page.score,
            }));
            console.log("FINAL RESULTS COME FROM EMBEDDINGS!");
        } catch (err) {
            console.warn("Embedding comparison failed, trying Gemini ranking", err);
            try {
                // Secondary: Gemini ranking
                const recommendations = await fetchPageReasoningData(generatedPageData.summary);
                finalResults = recommendations.pages.map(page => ({
                    url: page.url,
                    title: page.title,
                    favIcon: getFavIconFromPage(page.url),
                    reason: page.reason,
                    score: 1,
                }));
                console.log("FINAL RESULTS COME FROM GEMINI-GENERATED SUMMARY!");
            } catch (err2) {
                console.warn("Gemini ranking failed, falling back to local TF-IDF", err2);
                // Fallback: local cosine similarity on summary
                finalResults = comparePages(pageData, bookmarks, searchHistory, generatedPageData.summary);
                console.log("FINAL RESULTS COME FROM LOCAL TF-IDF + COSINE SIM!");
            }
        }

        console.log(generatedPageData);
        console.log(finalResults);

        renderPageData(pageData, container);
        renderRelativePageData(finalResults, relatedPageContainer);
    } catch (err) {
        console.error(err);
        container.innerHTML = `<span class="text-red-500">Failed to load page info</span>`;
    }
};

init();