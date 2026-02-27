/* 
    content.js --> prepares the page data for popup.js to log
    by inspecting the DOM and getting the page's URL, name, and description
*/
// Content.js always listens for popup.js 
// The 'sender' parameter provides details about the message sender (such as the tab it came from or the extension ID).
// In this handler we don't need any information from 'sender', but it must be included
// as part of the callback signature, according to the Chrome Extensions API.

// Content scripts often can't use static ES imports; load helpers via dynamic import so it works in the extension context.
let helpersPromise = null;
const getHelpers = () => {
    if (!helpersPromise) {
        helpersPromise = import(chrome.runtime.getURL("utils/helpers.js"));
    }
    return helpersPromise;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_PAGE_DESCRIPTION") {
        const description =
            document.querySelector('meta[name="description"]')?.getAttribute("content") ||
            document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
            "";

        sendResponse({ description });
    }
});

// function to extract meaning from a page (uses helpers from getHelpers())
const extractPageMeaning = async () => {
    /*
        Given any page, extracts the content of it so that Gemini has the right context to
        work with.

        For V0, Resurface will work with 2 types of pages:
            1. Static > Dynamic (More static content than dynamic content) --> Things like code documentations, recipes, articles, etc.
            2. Dynamic > Static (More dynamic content than static content) --> Things like social media, online IDEs, etc.

        In ANY given page, the following are important:
            1. Title (document.title) --> Depending on the page, the document.title property can be
            pretty resourceful, or not provide any context at all.
            2. Meta Description --> Depending on the page, it may or may not be there (in google searches there isn't any)
            3. URL --> In documentations (openai/docs/blogs/....), it's really beneficial. In home pages (like www.instagram.com), it's useless.
            4. Body --> The MOST IMPORTANT element within a page.
                If the .innerText contains more than 2000 words, it's STATIC
    */
    const { classifyPage, extractDynamicContent, extractStaticContent, processURL } = await getHelpers();

    const pageType = classifyPage();

    const title = document.title?.trim() || "";
    const description = document.querySelector("meta[name='description']")?.getAttribute("content") || "";

    const urlContext = processURL(location.href);

    const body = pageType === "STATIC_DOMINANT" ? extractStaticContent() : extractDynamicContent();

    return {
        pageType,
        title,
        description,
        urlContext,
        body
    };
};

// Listen for EXTRACT_PAGE_MEANING requests from background.js and respond with the extracted page meaning
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "EXTRACT_PAGE_MEANING") {
        extractPageMeaning()
            .then((pageMeaning) => {
                console.log("Page meaning extracted:", pageMeaning);
                sendResponse(pageMeaning);
            })
            .catch((err) => {
                console.error("Failed to extract page meaning:", err);
                sendResponse(null);
            });
    }
    return true;
});