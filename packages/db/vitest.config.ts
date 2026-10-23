import { defineConfig } from "vitest/config";

// PGlite boots a WASM Postgres; give it room when turbo runs suites in parallel.
export default defineConfig({ test: { hookTimeout: 60_000, testTimeout: 30_000 } });
