import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // PGlite boots a WASM Postgres per file; password hashing is deliberately slow.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
