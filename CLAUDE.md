# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Resurface is a Chrome Extension (Manifest V3) that surfaces contextually relevant bookmarks and browsing history based on what the user is currently viewing. It combines local TF-IDF cosine similarity (the fallback) with Gemini-powered semantic embeddings and LLM ranking (the primary path).

The extension is written in **TypeScript** and built with **Vite** + `@crxjs/vite-plugin`. Tailwind v4 (`@tailwindcss/vite`) compiles the popup stylesheet. The build output in `dist/` is what gets loaded into Chrome — source is no longer loaded directly.

## Project structure  

```
/                   Repo root
  manifest.json     MV3 manifest (references src/ entries; @crxjs rewrites paths at build)
  vite.config.ts    Vite + @crxjs + @tailwindcss/vite
  tsconfig.json     strict TS, types: chrome
  package.json      devDeps: vite, typescript, @crxjs/vite-plugin, tailwindcss
  src/
    types.ts        Shared interfaces (CacheEntry, PageData, API responses, Vector)
    background.ts   Service worker – auto-embeds pages on tab load, caches to chrome.storage.local
    content.ts      Injected into every page – extracts page content on request
    popup/
      index.html    Popup entry (loads main.ts + style.css)
      main.ts        Popup UI logic, ranking pipeline (was popup.js)
      style.css      `@import "tailwindcss"` – compiled by Vite
    utils/
      constants.ts  BACKEND_URL (gitignored – create locally)
      config.ts     Tunables: TOP_N result cap, CACHE_TTL_MS, isCacheFresh() guard
      helpers.ts    Page classification, content extraction, TF-IDF cosine similarity
      pageData.ts   Embedding API calls, cache management, rendering
      pageRelevance.ts Bookmarks/history retrieval, local TF-IDF fallback compare
  dist/             Vite build output – load THIS as unpacked (gitignored)

server/             FastAPI backend (deployed on Render)
  main.py           All API routes
  utils/helpers.py  cosine_similarity, extract_url, list_chunker
  requirements.txt
  venv/             (gitignored)
  .env              GEMINI_API_KEY (gitignored)
```

## Building the extension

```bash
npm install          # first time
npm run dev          # Vite dev server with HMR for the popup
npm run build        # tsc --noEmit (typecheck) then vite build -> dist/
npm run typecheck    # type-check only
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

1. `npm run build` (or `npm run dev` for HMR)
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the **`dist/`** directory

`src/utils/constants.ts` is gitignored — create it locally:
```ts
export const BACKEND_URL = "https://resurface-si7m.onrender.com";
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
```ts
{ summary: string, embedding: number[], cachedAt: number }   // CacheEntry in src/types.ts
```
`background.ts` auto-populates the cache on every tab load. `popup/main.ts` reads from cache first and only hits `/process-page` on a miss. **All writers use this one shape** — `fetchPageReasoningData` no longer stores bare embedding arrays. `isCacheFresh()` (in `config.ts`) is the single gate every reader uses: it rejects malformed/legacy entries and enforces `CACHE_TTL_MS` (7 days), so expired embeddings are cleared and regenerated on access.

## Ranking pipeline (`popup/main.ts` `rankWithFallbacks`)

Each tier falls through on a thrown error **or an empty result set** (a `200` with no pages is treated as failure), and every tier is capped at `TOP_N` (5) for a consistent result count.

1. **Primary**: `/page-reasoning` — pre-filters to top-20 via local cosine similarity on cached embeddings, then asks Gemini to rank with reasons.
2. **Fallback 1**: `/compare-pages` — server-side batch embedding + cosine similarity. NOTE: tiers 1 and 2 share the same backend, so a server outage fails both and drops to tier 3.
3. **Fallback 2**: `comparePages()` in `pageRelevance.ts` — fully local, no network required. Real **TF-IDF** (`computeIdf` + `vectoriseTfIdf` in `helpers.ts`) over candidate title+URL tokens, not raw term-frequency cosine.

## Content extraction (`content.ts` / `utils/helpers.ts`)

Pages are classified as `STATIC_DOMINANT` (≥1200 chars in `<main>`/`<article>` with ≥45% core-to-total ratio) or `DYNAMIC_DOMINANT`. Static pages extract from the largest semantic container; dynamic pages extract visible viewport-center text blocks.

## Key constraints

- Gemini `embed_content` accepts at most **100 items per call** — `list_chunker` enforces this in `/embed-uncached`.
- `background.ts` and `content.ts` run in separate contexts; they communicate via `chrome.tabs.sendMessage`.
- The bundler (@crxjs) lets `content.ts` import helpers via normal static ES `import` — the old `import(chrome.runtime.getURL(...))` hack and `web_accessible_resources` entry are gone.
- `cosineSimilarity` in `helpers.ts` is intentionally polymorphic: it accepts both TF-IDF frequency maps (`Record<string, number>`) and raw embedding arrays (`number[]`), typed as `Vector`.
- `task_type: "RETRIEVAL_DOCUMENT"` is used when embedding pages/bookmarks; `"RETRIEVAL_QUERY"` is used when embedding search queries (critical for vector space alignment).
