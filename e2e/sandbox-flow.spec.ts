import { expect, test } from "@playwright/test";

/**
 * Sandbox-page happy path: navigate to Sandbox, verify the 6-column
 * setup renders, and confirm the per-side state cards plus the Event
 * Log appear. Engine fixtures cover combat correctness - this spec
 * only guards against "Sandbox is unreachable or crashes on mount".
 */

test.describe("Sandbox flow", () => {
  test("Sandbox tab opens with Side A/B state cards and Event Log", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sandbox", exact: true }).click();
    // Setup row panels
    await expect(page.getByRole("heading", { name: "Sandbox Controls", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sandbox Overrides", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Start Setup A", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Start Setup B", exact: true })).toBeVisible();
    // Results row panels
    await expect(page.getByRole("heading", { name: "Side A State", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Side B State", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Event Log", exact: true })).toBeVisible();
  });

  test("Apply Status Now seeds a status on Side B", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sandbox", exact: true }).click();
    const setupB = page.locator(".panel-block", { hasText: "Start Setup B" });
    await setupB.getByRole("button", { name: "Apply Status Now" }).click();
    // The status list on Side B should pick up the seeded status. We
    // don't bind to a specific status id - Poison_Status is the default
    // but the assert stays loose on the label so the spec survives a
    // default-changed-to-Burn refactor.
    const sideB = page.locator(".panel-block", { hasText: "Side B State" });
    const statusItems = sideB.locator(".sandbox-status-item");
    await expect(statusItems.first()).toBeVisible({ timeout: 5_000 });
  });
});
