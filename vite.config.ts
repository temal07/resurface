import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import manifest from "./manifest.json";

// @crxjs reads entry points (popup html, background, content scripts) straight
// from manifest.json and rewrites the built paths for us. Tailwind v4 compiles
// the stylesheet imported by the popup, replacing the old in-page CDN runtime.
export default defineConfig({
  plugins: [crx({ manifest }), tailwindcss()],
});
