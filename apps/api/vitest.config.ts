import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 60_000,
    testTimeout: 30_000,
    provide: {
      migrationsFolder: fileURLToPath(new URL("../../packages/db/migrations", import.meta.url)),
    },
  },
});
