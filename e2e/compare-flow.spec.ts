import { expect, test } from "@playwright/test";

/**
 * Compare-page happy path: navigate to Compare and check the Fight
 * Playback layout renders. The suite intentionally stays loose on exact
 * numbers - engine fixtures cover parity; this spec only guards against
 * "Compare doesn't render after a UI refactor".
 */

test.describe("Compare flow", () => {
  test("Compare tab opens with the matchup rail and Run control", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    // Page-title banner (design-level marker) + the always-present quick-rail
    // controls: pick both creatures and kick off a simulation.
    await expect(page.getByRole("heading", { name: "Compare", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run fight" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Battle settings" })).toBeVisible();
  });
});
