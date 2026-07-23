# Privacy Policy for Resurface

**Last updated:** July 23, 2026

Resurface is a Chrome extension that surfaces relevant pages from your browsing history and bookmarks. This policy explains what data the extension handles, where it goes, and what is kept.

## What Resurface accesses

- **Browsing history and bookmarks.** Resurface reads your history and bookmarks to build an index of pages you have already visited or saved, so it can surface relevant ones.
- **Page content.** For pages included in the index, Resurface extracts text content in order to generate a summary and a numerical representation (an "embedding") used to compare pages for relevance.

## Where data goes

Page text is sent to the Resurface backend service, which forwards it to Google's Gemini API to generate the summary and embedding. The result is returned to your browser.

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

## Contact

Questions about this policy: temiralimov38@gmail.com
