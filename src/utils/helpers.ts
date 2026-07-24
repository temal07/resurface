// Helper functions for the extension.

import type { FrequencyVector, PageMeaning, PageType, Vector } from "../types";

export const getActiveTab = async (): Promise<chrome.tabs.Tab> => {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      if (!tabs || tabs.length === 0) {
        reject(new Error("No active tab found."));
        return;
      }
      resolve(tabs[0]);
    });
  });
};

export const getPageDescription = (tabId: number): Promise<string | null> => {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_DESCRIPTION" }, (res) => {
      // Instead of rejecting, resolve, expected issue.
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(res ?? null);
    });
  });
};

export const getPageMeaning = (tabId: number): Promise<PageMeaning | null> => {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_MEANING" }, (res) => {
      // Instead of rejecting, resolve, expected issue (no content script).
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve((res as PageMeaning) ?? null);
    });
  });
};

export const getFavIconFromPage = (url: string): string | null => {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
  } catch {
    return null;
  }
};

// Tokenisation: Given a piece of text, it will tokenise it, meaning, it will separate the text into individual words and put it in an array.
export const tokenise = (text: string): string[] => {
  // Convert to lowercase, remove punctuation, split on whitespace, filter out empty
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
};

// Vectorisation: Given a piece of tokenised array, it will create an object with a frequency map (i.e. how many times each word appears)
// and this will be used for dot product.
export const vectorise = (tokens: string[]): FrequencyVector => {
  const vector: FrequencyVector = {};

  for (const token of tokens) {
    vector[token] = (vector[token] || 0) + 1;
  }
  return vector;
};

// Inverse document frequency over a corpus of tokenised documents. Rare terms
// score high, terms appearing in every document score low — this is what makes
// the local similarity an actual TF-IDF rather than raw term-frequency cosine.
export const computeIdf = (documents: string[][]): FrequencyVector => {
  const docFreq: FrequencyVector = {};
  for (const doc of documents) {
    for (const term of new Set(doc)) {
      docFreq[term] = (docFreq[term] || 0) + 1;
    }
  }

  const n = documents.length;
  const idf: FrequencyVector = {};
  for (const term in docFreq) {
    // Smoothed idf so a term present in every doc still keeps a small weight.
    idf[term] = Math.log((n + 1) / (docFreq[term] + 1)) + 1;
  }
  return idf;
};

// Builds a TF-IDF vector: term frequency weighted by the supplied idf. Terms
// absent from the corpus fall back to a neutral weight of 1.
export const vectoriseTfIdf = (tokens: string[], idf: FrequencyVector): FrequencyVector => {
  const tf = vectorise(tokens);
  const vector: FrequencyVector = {};
  for (const term in tf) {
    vector[term] = tf[term] * (idf[term] ?? 1);
  }
  return vector;
};

// Example of using dotProduct:
// const vecA = { the: 2, cat: 1, sat: 1 };
// const vecB = { the: 1, cat: 2, mat: 1 };
// const result = dotProduct(vecA, vecB); // result = (2*1) + (1*2) = 4
const dotProduct = (vecA: Vector, vecB: Vector): number => {
  let sum = 0;
  for (const key in vecA) {
    if (Object.hasOwnProperty.call(vecB, key)) {
      sum += (vecA as never)[key] * (vecB as never)[key];
    }
  }
  return sum;
};

// Pseudocode for cosine similarity:
// 1. Given two vectors (frequency objects), compute their dot product.
// 2. Compute the magnitude (Euclidean norm) of each vector:
//    - For a vector, magnitude = sqrt(sum of squares of all values).
// 3. Cosine similarity = (dot product) / (magnitude of A * magnitude of B)
// 4. If denominator is 0, return 0 (avoid division by zero).
export const cosineSimilarity = (vecA: Vector, vecB: Vector): number => {
  const dp = dotProduct(vecA, vecB); // dot product between two word-frequency objects
  const magnitudeA = Math.sqrt(Object.values(vecA).reduce((sum, val) => sum + val * val, 0)); // sqrt(sum of squared frequencies for A)
  const magnitudeB = Math.sqrt(Object.values(vecB).reduce((sum, val) => sum + val * val, 0)); // sqrt(sum of squared frequencies for B)

  if (magnitudeA === 0 || magnitudeB === 0) return 0;

  return dp / (magnitudeA * magnitudeB);
};

export const classifyPage = (): PageType => {
  const totalText = document.body.innerText;
  const totalLen = totalText.length;

  // Classification for static pages
  const main = document.querySelector<HTMLElement>("main, article");
  const coreText = main ? main.innerText : "";
  const coreLen = coreText.length;

  const coreRatio = totalLen > 0 ? coreLen / totalLen : 0;

  if (coreLen >= 1200 && coreRatio >= 0.45) {
    return "STATIC_DOMINANT";
  }

  return "DYNAMIC_DOMINANT";
};

export const isNoiseNode = (element: HTMLElement): boolean => {
  // returns a boolean that specifies whether there are any "noisy" HTML elements
  // specified below
  const noiseElems = ["nav", "menu", "sidebar", "footer", "header", "ads"];
  const attrs = `${element.className} ${element.id}`.toLowerCase();

  return noiseElems.some((k) => attrs.includes(k));
};

export const extractStaticContent = (): string => {
  let container: HTMLElement | null =
    document.querySelector<HTMLElement>("article") || document.querySelector<HTMLElement>("main");

  // if container does not exist, reassign the container to the largest div element by text length
  if (!container) {
    const divs = [...document.querySelectorAll<HTMLDivElement>("div")];

    container = divs.reduce<HTMLElement | null>(
      (best, elem) => (elem.innerText.length > (best?.innerText.length || 0) ? elem : best),
      null,
    );
  }

  if (!container) return "";

  const text = [...container.querySelectorAll<HTMLElement>("*")]
    .filter((elem) => !isNoiseNode(elem))
    .map((elem) => elem.innerText)
    .join(" ");

  return text.replace(/\s+/g, " ").trim();
};

export const extractDynamicContent = (): string => {
  const viewportCenter = window.innerHeight / 2;

  const textBlocks = [...document.querySelectorAll<HTMLElement>("p, span, div")]
    .filter((elem) => {
      const rect = elem.getBoundingClientRect();
      return rect.top < viewportCenter && rect.bottom > viewportCenter;
    })
    .filter((elem) => !isNoiseNode(elem))
    .map((elem) => elem.innerText.trim())
    .filter((t) => t.length > 30);

  return textBlocks.join(" ").slice(0, 1500);
};

export const processURL = (url: string): string => {
  try {
    const u = new URL(url);
    return u.pathname
      .split("/")
      .filter(Boolean)
      .join(" ")
      .replace(/[-_]/g, " ");
  } catch {
    return "";
  }
};

// Helps identify a page that is injectable, i.e., resurface 
// can read its contents. 
export const isInjectable = (url?: string): boolean =>
  !!url &&
  /^https?:\/\//.test(url) &&
  !url.startsWith("https://chromewebstore.google.com") &&
  !url.startsWith("https://chrome.google.com/webstore");