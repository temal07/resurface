# Privacy Policy for Resurface

**Last updated:** July 29, 2026

Resurface is a Chrome extension that surfaces relevant pages from your browsing history and bookmarks. This policy explains what data the extension handles, where it goes, and what is kept.

## What Resurface accesses

- **Browsing history and bookmarks.** Resurface reads your history and bookmarks to build an index of pages you have already visited or saved, so it can surface relevant ones.
- **Page content.** For pages included in the index, Resurface extracts text content in order to generate a summary and a numerical representation (an "embedding") used to compare pages for relevance.

## Paid-tier

Resurface uses a paid Gemini API tier. Google does not use the data submitted through the paid-tier API access to train its models; retention is limited to abuse monitoring.

## Where data goes

Page text is sent to the Resurface backend service, which forwards it to Google's Gemini API to generate the summary and embedding. The result is returned to your browser. Pages are processed automatically after you've viewed them for a few seconds, so results are ready when you search, and on demand when you use the extension directly.

When you search, Resurface may also send the URLs of pages from your history and bookmarks to the backend service, which fetches those pages and forwards their text to Gemini to generate a summary and embedding. This lets Resurface search pages you visited before installing the extension. Only publicly accessible pages can be retrieved this way — pages behind a login return no content and are skipped. As with page text, nothing is stored or logged on the backend; the result is returned to your browser and cached locally.

The Resurface backend does not store, log, or retain page content. Text is held in memory only for the duration of the request and is discarded once the response is returned. There is no database and no file storage.

Google's handling of data submitted to the Gemini API is governed by Google's own terms and privacy policy: https://ai.google.dev/gemini-api/terms

## What is stored, and where

All data Resurface retains is stored locally on your own device using Chrome's `storage.local` API. This includes:

- Embeddings and cached page data, keyed by URL
- Cached results for recently viewed pages

This data never leaves your device except as described above. It is not synced to any server. Removing the extension deletes it.

## What Resurface does not do

- Resurface does not sell or transfer your data to third parties, except to Google as the service provider described above.
- Resurface does not use your data for advertising, profiling, or creditworthiness determination.
- Resurface does not use your data for any purpose unrelated to the extension's single purpose of surfacing relevant pages.

## Permissions

- **`history`** — read to build the local index of previously visited pages that Resurface searches.
- **`bookmarks`** — read to include saved pages in that same index.
- **`tabs`** — read the URL and title of open tabs so Resurface can find pages related to what you are currently viewing.
- **`storage`** — cache embeddings and results locally on your device so pages are not reprocessed.
- **`unlimitedStorage`** — the local cache grows with your history and can exceed Chrome's default storage quota.
- **`scripting`** — to inject Resurface's own content script into tabs that were already open before the extension was installed or updated. Chrome only injects content scripts into pages loaded afterward, so without this Resurface wouldn't work on those tabs until you reloaded them. No other code is injected.

## Contact

Questions about this policy: temiralimov38@gmail.com
