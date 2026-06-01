import { expect, test } from "@playwright/test";

/**
 * Compare-page happy path: navigate to Compare and check the Outcome
 * panel renders something engine-driven. The suite intentionally stays
 * loose on exact numbers — engine fixtures cover parity; this spec only
 * guards against "Compare doesn't render after a UI refactor".
 */

test.describe("Compare flow", () => {
  test("Compare tab opens with Outcome + Timeline panels", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Creature A", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Creature B", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Outcome", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Timeline", exact: true })).toBeVisible();
  });
});
