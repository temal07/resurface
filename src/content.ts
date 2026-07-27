/*
    content.ts --> prepares the page data for the popup to log
    by inspecting the DOM and getting the page's URL, name, and description
*/
// Content scripts listen for messages from the popup and background worker.
// The 'sender' parameter provides details about the message sender; we don't
// use it here but it is part of the Chrome Extensions API callback signature.

import {
  classifyPage,
  extractDynamicContent,
  extractStaticContent,
  processURL,
} from "./utils/helpers";
import type { PageMeaning } from "./types";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_PAGE_DESCRIPTION") {
    const description =
      document.querySelector('meta[name="description"]')?.getAttribute("content") ||
      document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
      "";

    sendResponse({ description });
  }
});

// function to extract meaning from a page
const extractPageMeaning = async (): Promise<PageMeaning> => {
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
    body,
  };
};

// Listen for EXTRACT_PAGE_MEANING requests and respond with the extracted page meaning
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ ok: true });
    return;
  }

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
