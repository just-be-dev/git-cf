import { resolve } from "node:path";

import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { clientEntrypoints } from "./src/ui/client/entrypoints";

export default defineConfig({
  plugins: [react(), cloudflare()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    manifest: "manifest.json",
    rollupOptions: {
      input: clientEntrypoints,
    },
  },
});
