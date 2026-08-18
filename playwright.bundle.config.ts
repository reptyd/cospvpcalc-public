import { defineConfig, devices } from "@playwright/test";

/**
 * Production-bundle load gate. The happy-path e2e suite (playwright.config.ts)
 * boots the Vite DEV server, so it structurally cannot see chunk-init behavior:
 * dev serves unbundled ESM with no manualChunks and no cross-chunk init order.
 *
 * This config boots `vite preview` over the built `dist/` and cold-loads the app
 * many times to surface non-deterministic cross-chunk module-init races - the
 * class that crashed production in 2026-06 (a feature chunk read a sibling
 * chunk's top-level lookup table before it initialized). Build + vitest + the
 * dev e2e all passed while that shipped; only loading the built bundle catches it.
 *
 * retries:0 on purpose - a retry would mask exactly the flaky race we hunt for.
 * Requires `npm run build` first (vite preview serves dist/).
 */
export default defineConfig({
  testDir: "./e2e-bundle",
  timeout: 60_000,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
