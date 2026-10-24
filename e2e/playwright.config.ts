import { defineConfig, devices } from "@playwright/test";

/**
 * Full-stack tests against the local stack (see e2e/README.md):
 * Postgres (pnpm db:up), the built SPA + Worker on :8787 (wrangler dev serves
 * apps/web/dist with its _headers, so the CSP is enforced), queues and the
 * extract container. Not part of `pnpm check`.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8787",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
