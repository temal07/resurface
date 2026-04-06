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
    const tab = await getActiveTab();
    const bookmarks = await getBookmarkedPages();
    const searchHistory = await getSearchHistory();

    const pageMeaning = await getPageMeaning(tab.id);

    // Update the page data with the page meaning
    updatePageData({ 
        id: tab.id, 
        name: tab.title, 
        url: tab.url, 
        favIcon: tab.favIconUrl, 
        description: pageMeaning.description,
        body: pageMeaning.body,
    });

    // Render the page data to the container before fetching the relevant pages from the backend
    renderPageData(pageData, container); // This is the page the user is on
    /* /////// RELEVANT PAGES LOGIC /////// */
    /* 
                try {
            // Check if the embedding is cached
            const cacheKey = `embed:${tab.url}`;
            const cached = await chrome.storage.local.get(cacheKey);

            // If the embedding is cached, use it, otherwise fetch it from the backend
            let generatedPageData = cached[cacheKey] || null;

            if (!generatedPageData) {
                try {
                    generatedPageData = await fetchGeneratedPageData();
                    // Cache it for next time
                    await chrome.storage.local.set({ [cacheKey]: generatedPageData });
                } catch (err) {
                    console.warn("Process page failed, proceeding without embedding", err);
                    generatedPageData = { summary: null, embedding: null };
                }
            }
            let finalResults;

            try {
                // Primary: Gemini ranking
                // embedding caching implementation

                const recommendations = await fetchPageReasoningData(generatedPageData.summary, generatedPageData.embedding);
                console.log(recommendations);
                finalResults = recommendations.pages.map(page => ({
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
                    // Secondary: Embedding-based similarity
                    const compareData = await compareEmbeddingResponse(
                        generatedPageData.embedding,
                        bookmarks,
                        searchHistory
                    );
                    console.log("Compare Data: ", compareData);
                    finalResults = compareData.pages.map(page => ({
                        url: page.url,
                        title: page.title,
                        favIcon: getFavIconFromPage(page.url),
                        score: page.score,
                    }));
                    console.log("FINAL RESULTS COME FROM EMBEDDINGS!");
                } catch (err2) {
                    console.warn("Embeddings Failed: Trying Local TF-IDF + COSINE SIM...", err2);
                    // Fallback: local cosine similarity on summary
                    finalResults = comparePages(pageData, bookmarks, searchHistory, generatedPageData.summary);
                    console.log("FINAL RESULTS COME FROM LOCAL TF-IDF + COSINE SIM!");
                }
            }

            console.log("Generated Page Data:", generatedPageData);
            console.log("Final Results:", finalResults);

            renderRelativePageData(finalResults, relatedPageContainer);
        } catch (err) {
            console.error(err);
            container.innerHTML = `<span class="text-red-500">Failed to load page info</span>`;
        }    
    */
};

init();