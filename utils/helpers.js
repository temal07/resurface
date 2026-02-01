// Helper functions for the extension.

export const getActiveTab = async () => {
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
}

export const getPageDescription = (tabId) => {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_DESCRIPTION" }, (res) => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError.message);
            resolve(res.description);
        });
    });
};


export const getFavIconFromPage = (url) => {
    try {
        const { hostname } = new URL(url);
        return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
    } catch {
        return null;
    }
}

// Tokenisation: Given a piece of text, it will tokenise it, meaning, it will separate the text into individual words and put it in an array.
export const tokenise = (text) => {
    // Convert to lowercase, remove punctuation, split on whitespace, filter out empty
    return (text)
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(Boolean);
}

// Vectorisation: Given a piece of tokenised array, it will create an object with a frequency map (i.e. how many times each word appears)
// and this will be used for dot product.

export const vectorise = (tokens) => {
    let vector = {};

    for (const token of tokens) {
        vector[token] = (vector[token] || 0) + 1;
    }
    return vector;
}

// Example of using dotProduct:
// const vecA = { the: 2, cat: 1, sat: 1 };
// const vecB = { the: 1, cat: 2, mat: 1 };
// const result = dotProduct(vecA, vecB); // result = (2*1) + (1*2) = 4

const dotProduct = (vecA, vecB) => {
    let sum = 0;
    for (const key in vecA) {
        if (Object.hasOwnProperty.call(vecB, key)) {
            sum += vecA[key] * vecB[key];
        }
    }
    return sum;
}

// Pseudocode for cosine similarity:
// 1. Given two vectors (frequency objects), compute their dot product.
// 2. Compute the magnitude (Euclidean norm) of each vector:
//    - For a vector, magnitude = sqrt(sum of squares of all values).
// 3. Cosine similarity = (dot product) / (magnitude of A * magnitude of B)
// 4. If denominator is 0, return 0 (avoid division by zero).

export const cosineSimilarity = (vecA, vecB) => {
    const dp = dotProduct(vecA, vecB); // dot product between two word-frequency objects
    const magnitudeA = Math.sqrt(Object.values(vecA).reduce((sum, val) => sum + val * val, 0)); // sqrt(sum of squared frequencies for A)
    const magnitudeB = Math.sqrt(Object.values(vecB).reduce((sum, val) => sum + val * val, 0)); // sqrt(sum of squared frequencies for B)
    
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    
    return (dp / (magnitudeA * magnitudeB));
}

