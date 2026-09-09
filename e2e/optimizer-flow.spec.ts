import { expect, test } from "@playwright/test";

/**
 * Optimizer-page happy path: navigate to Optimizer and verify the
 * counter-recommendation layout renders. Doesn't actually click Run
 * (the BB engine takes a few seconds even for soft search) - the BB
 * flow itself is covered by `bestBuildsPageFlow.test.ts` in vitest.
 * The spec only guards against "Optimizer route doesn't render after
 * a refactor".
 */

test.describe("Optimizer flow", () => {
  test("Optimizer tab opens with objective picker + Run control", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Optimizer", exact: true }).click();
    // Page-title banner (design-level marker) + the objective tablist and Run
    // button that drive the counter search.
    await expect(page.getByRole("heading", { name: "Optimizer", level: 1 })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Optimization objective" })).toBeVisible();
    // Run button present and enabled before a run starts.
    await expect(page.getByRole("button", { name: "Run Optimizer" })).toBeEnabled();
  });
});
