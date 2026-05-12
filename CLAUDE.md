# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Resurface is a Chrome Extension (Manifest V3) that surfaces contextually relevant bookmarks and browsing history based on what the user is currently viewing. It combines local TF-IDF cosine similarity (the fallback) with Gemini-powered semantic embeddings and LLM ranking (the primary path).

## Project structure

```
/                   Chrome Extension source (loaded directly into Chrome)
  manifest.json     MV3 manifest
  background.js     Service worker – auto-embeds pages on tab load, caches to chrome.storage.local
  content.js        Injected into every page – extracts page content on request
  popup.html/js     Extension popup UI (Tailwind CSS via bundled tailwind.js)
  utils/
    constants.js    BACKEND_URL (points to Render deployment)
    helpers.js      Page classification, content extraction, TF-IDF cosine similarity
    pageData.js     Embedding API calls, cache management, rendering
    pageRelevance.js Bookmarks/history retrieval, local TF-IDF fallback compare

server/             FastAPI backend (deployed on Render)
  main.py           All API routes
  utils/helpers.py  cosine_similarity, extract_url, list_chunker
  requirements.txt
  venv/             (gitignored)
  .env              GEMINI_API_KEY (gitignored)
```

## Running the backend server

```bash
cd server
# First time: create venv and install deps
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt

# Run dev server
uvicorn main:app --reload
```

The server requires a `.env` file in `server/` with:
```
GEMINI_API_KEY=<your key>
```

## Loading the Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the repo root directory

`utils/constants.js` is gitignored — create it locally:
```js
export const BACKEND_URL = "https://resurface-si7m.onrender.com"
```
(or point to `http://localhost:8000` for local dev)

## Backend API endpoints

| Route | Purpose |
|---|---|
| `POST /process-page` | Gemini summary + embedding for the current page |
| `POST /compare-pages` | Batch-embed candidates and return top-5 by cosine similarity |
| `POST /embed-uncached` | Batch-embed bookmark/history items (chunks at 100 for Gemini limit) |
| `POST /page-reasoning` | LLM re-ranks top-20 pre-filtered candidates with explanations |
| `POST /expand-prompt` | Expands a short user query into semantic prose + embedding |

All endpoints use `gemini-2.5-flash` for text generation and `gemini-embedding-001` for embeddings. CORS is restricted to `chrome-extension://*`.

## Embedding cache design

Embeddings are cached in `chrome.storage.local` under the key `embed<url>`. The cache entry shape is:
```js
{ summary: string, embedding: float[], cachedAt: number }
```
`background.js` auto-populates the cache on every tab load. `popup.js` reads from cache first and only hits `/process-page` on a miss. Stale entries stored as raw arrays (old format) are detected and cleared on access.

## Ranking pipeline (popup.js `rankWithFallbacks`)

1. **Primary**: `/page-reasoning` — pre-filters to top-20 via local cosine similarity on cached embeddings, then asks Gemini to rank with reasons.
2. **Fallback 1**: `/compare-pages` — server-side batch embedding + cosine similarity.
3. **Fallback 2**: `comparePages()` in `pageRelevance.js` — fully local TF-IDF cosine similarity, no network required.

## Content extraction (`content.js` / `utils/helpers.js`)

Pages are classified as `STATIC_DOMINANT` (≥1200 chars in `<main>`/`<article>` with ≥45% core-to-total ratio) or `DYNAMIC_DOMINANT`. Static pages extract from the largest semantic container; dynamic pages extract visible viewport-center text blocks.

## Key constraints

- Gemini `embed_content` accepts at most **100 items per call** — `list_chunker` enforces this in `/embed-uncached`.
- `background.js` and `content.js` run in separate contexts; they communicate via `chrome.tabs.sendMessage`.
- Content scripts cannot use static ES `import`; `content.js` uses dynamic `import(chrome.runtime.getURL(...))` to load helpers.
- `task_type: "RETRIEVAL_DOCUMENT"` is used when embedding pages/bookmarks; `"RETRIEVAL_QUERY"` is used when embedding search queries (critical for vector space alignment).
