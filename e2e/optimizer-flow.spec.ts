import { expect, test } from "@playwright/test";

/**
 * Optimizer-page happy path: navigate to Optimizer and verify the
 * fix-A-build / optimize-B layout renders. Doesn't actually click Run
 * (the BB engine takes a few seconds even for soft search) — the BB
 * flow itself is covered by `bestBuildsPageFlow.test.ts` in vitest.
 * The spec only guards against "Optimizer route doesn't render after
 * a refactor".
 */

test.describe("Optimizer flow", () => {
  test("Optimizer tab opens with Settings + fixed Build A + optimized Creature B", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Optimizer", exact: true }).click();
    // Sub-panel headings — single-mode layout (counter only) after the
    // 2026-05-12 solo-mode purge.
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Creature A (fixed build)", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Creature B (optimized)", exact: true })).toBeVisible();
    // Run button present and enabled before a run starts.
    await expect(page.getByRole("button", { name: "Run Optimizer" })).toBeEnabled();
    // Top Builds panel renders empty (no run yet).
    await expect(page.getByRole("heading", { level: 3 }).filter({ hasText: "Top Builds" })).toBeVisible();
  });
});
