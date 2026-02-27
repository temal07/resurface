/* 
    popup.js --> Requests the page data from content.js
    once it has the page data, for now it will just print it 
    to the console as a neat object.
*/

import { fetchGeneratedPageData, fetchPageReasoningData, pageData, reasoningData } from "./utils/pageData.js";
import { renderPageData, renderRelativePageData, updatePageData } from "./utils/pageData.js";
import { getActiveTab, getPageMeaning } from "./utils/helpers.js";
import { getBookmarkedPages, getSearchHistory, comparePages } from "./utils/pageRelevance.js";

const container = document.getElementById("page-container");
const relatedPageContainer = document.getElementById("relevant-pages-container");

const init = async () => {
    try {
        const tab = await getActiveTab();
        const bookmarks = await getBookmarkedPages();
        const searchHistory = await getSearchHistory();

        console.log(searchHistory);
        console.log(bookmarks);

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
        reasoningData.summary = generatedPageData.summary;
        reasoningData.embedding = generatedPageData.embedding;
        
        const recommendations = await fetchPageReasoningData(reasoningData);

        console.log(generatedPageData);
        console.log(recommendations);

        const comparedResults = comparePages(pageData, bookmarks, searchHistory);
        console.log(comparedResults);
        renderPageData(pageData, container);
        renderRelativePageData(comparedResults, relatedPageContainer);
    } catch (err) {
        console.error(err);
        container.innerHTML = `<span class="text-red-500">Failed to load page info</span>`;
    }
};

init();