/* 
    popup.js --> Requests the page data from content.js
    once it has the page data, for now it will just print it 
    to the console as a neat object.
*/

import { pageData, renderPageData, updatePageData } from "./utils/pageData.js";
import { getActiveTab, getPageDescription } from "./utils/helpers.js";
import { getBookmarkedPages, getSearchHistory } from "./utils/pageRelevance.js";

const container = document.getElementById("page-container");

const init = async () => {
    try {
        const tab = await getActiveTab();
        const bookmarks = await getBookmarkedPages();
        const searchHistory = await getSearchHistory();
        console.log(searchHistory);
        console.log(bookmarks);
        pageData.description = await getPageDescription(tab.id);
        updatePageData({ id: tab.id, name: tab.title, url: tab.url, favIcon: tab.favIconUrl });
        renderPageData(pageData, container);
    } catch (err) {
        console.error(err);
        container.innerHTML = `<span class="text-red-500">Failed to load page info</span>`;
    }
};

init();