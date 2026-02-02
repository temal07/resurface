/* 
    content.js --> prepares the page data for popup.js to log
    by inspecting the DOM and getting the page's URL, name, and description
*/
// Content.js always listens for popup.js 
// The 'sender' parameter provides details about the message sender (such as the tab it came from or the extension ID).
// In this handler we don't need any information from 'sender', but it must be included
// as part of the callback signature, according to the Chrome Extensions API.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_PAGE_DESCRIPTION") {
        const description = 
            document.querySelector('meta[name="description"]')?.getAttribute("content") ||
            document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
            "";

        sendResponse({ description });
        // Return true if you want to send a response asynchronously, but here it's not needed.
        // However, sometimes Chrome extensions require explicit return true for sendResponse if async.
        // Here, since sendResponse is synchronous, this is fine as-is.
    }
});

// function to extract meaning from a page
// it will return a string of the page's meaning
const extractPageMeaning = () => {
    const name = document.title;
    const description = document.querySelector("meta[name='description']")?.getAttribute("content") || "";
    const body = document.body.innerText
        .replace(/\s+/g, " ")
        .trim();

    return { name, description, body };
}

// Listen for EXTRACT_PAGE_MEANING requests from background.js and respond with the extracted page meaning
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.type === "EXTRACT_PAGE_MEANING") {
        const pageMeaning = extractPageMeaning();
        console.log("Page meaning extracted:", pageMeaning);
        sendResponse(pageMeaning);
    }
    // Explicitly return true to indicate async response and keep message channel open until sendResponse is called
    return true;
});