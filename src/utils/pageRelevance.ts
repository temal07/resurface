import { tokenise, cosineSimilarity, computeIdf, vectoriseTfIdf } from "./helpers";
import { extractWordsFromUrl, getFavIconFromPage } from "./pageData";
import { TOP_N } from "./config";
import type { RankedPage } from "../types";

export const getBookmarkedPages = (): Promise<chrome.bookmarks.BookmarkTreeNode[]> => {
  // always reach the bookmarks using a Promise since popup.js needs to display the information.
  // Flattening the bookmark tree means converting the nested bookmark folders and bookmarks into a single-level array
  // of all bookmark nodes (usually just the ones of type 'bookmark', i.e. not folders).
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getTree((bookmarkTreeNode) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message);
        return;
      }

      // Helper to recursively collect all bookmark nodes
      const flattenBookmarks = (
        nodes: chrome.bookmarks.BookmarkTreeNode[],
        out: chrome.bookmarks.BookmarkTreeNode[] = [],
      ): chrome.bookmarks.BookmarkTreeNode[] => {
        for (const node of nodes) {
          if (node.url) {
            out.push(node);
          }
          if (node.children) {
            flattenBookmarks(node.children, out);
          }
        }
        return out;
      };

      // bookmarkTreeNode is an array with a single root node
      const flatBookmarks = flattenBookmarks(bookmarkTreeNode);
      resolve(flatBookmarks);
    });
  });
};

export const getSearchHistory = (): Promise<chrome.history.HistoryItem[]> => {
  return new Promise((resolve, reject) => {
    if (chrome.runtime.lastError) {
      reject(chrome.runtime.lastError.message);
      return;
    }

    const oneMonthAgo = new Date().getTime() - 30 * 24 * 60 * 60 * 1000;

    chrome.history.search(
      {
        text: "",
        startTime: oneMonthAgo,
        maxResults: 200,
      },
      (historyItems) => {
        resolve(historyItems);
      },
    );
  });
};

export const comparePages = (
  currentPage: { id?: string | number; name?: string; url?: string },
  bookmarks: chrome.bookmarks.BookmarkTreeNode[],
  historyItems: chrome.history.HistoryItem[],
  inputQuery: string | null,
): RankedPage[] => {
  // Flatten bookmarks + history into one candidate pool (title + URL words).
  const candidates = [
    ...bookmarks.map((bm) => ({ title: bm.title, url: bm.url ?? "" })),
    ...historyItems.map((hi) => ({ title: hi.title ?? "", url: hi.url ?? "" })),
  ];
  const candidateTokens = candidates.map((c) => [
    ...tokenise(c.title),
    ...extractWordsFromUrl(c.url),
  ]);

  // The query is either an explicit prompt/summary or the current page's words.
  const queryTokens = inputQuery
    ? tokenise(inputQuery)
    : [...tokenise(currentPage.name ?? ""), ...extractWordsFromUrl(currentPage.url ?? "")];

  // IDF is computed across candidates + query so shared terms are weighted the
  // same on both sides of the cosine comparison.
  const idf = computeIdf([...candidateTokens, queryTokens]);
  const queryVector = vectoriseTfIdf(queryTokens, idf);

  const results: RankedPage[] = candidates.map((c, i) => ({
    favIcon: getFavIconFromPage(c.url),
    score: cosineSimilarity(vectoriseTfIdf(candidateTokens[i], idf), queryVector),
    title: c.title,
    url: c.url,
  }));

  return results.sort((a, b) => b.score - a.score).slice(0, TOP_N);
};
