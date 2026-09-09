import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright happy-path E2E config. Boots the Vite dev server and
 * runs a small smoke suite under `e2e/`. The intent is *not* to
 * reproduce engine fixture parity (vitest + cargo cover that) - it
 * is to catch regressions a unit test can't see: the app fails to
 * boot, the WASM bridge banner shows when it shouldn't, top-level
 * navigation is broken, etc.
 *
 * Run locally: `npx playwright test`. CI runs this suite in the `e2e`
 * job (`.github/workflows/ci.yml`), which installs the chromium browser
 * on demand (cached across runs) - the ~250 MB cost is paid once per
 * cache key, not per run.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  // Absorb transient CI flake (dev-server boot timing, first-paint
  // races) without masking real failures locally.
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Mobile viewport added once a happy-path mobile flow exists;
    // for now keeping the config tight so the suite runs quickly.
  ],
});
