import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Same-origin /api in development, matching production (one Worker serves both).
  // ws: true carries the /api/v1/sync/live WebSocket through the proxy.
  server: { proxy: { "/api": { target: "http://127.0.0.1:8787", ws: true } } },
  preview: { proxy: { "/api": { target: "http://127.0.0.1:8787", ws: true } } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // Full-app renders (router + guards + queries) run beside the API's PGlite
    // suites under turbo; 5s is too tight there.
    testTimeout: 20_000,
  },
});
