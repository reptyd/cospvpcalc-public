import { expect, test } from "@playwright/test";

/**
 * Sandbox-page happy path: navigate to Sandbox, verify the Combat Lab
 * renders - the two fighter cards, the stepper transport, and the on-page
 * setup tools. Engine fixtures cover combat correctness - this spec only
 * guards against "Sandbox is unreachable or crashes on mount".
 */

test.describe("Sandbox flow", () => {
  test("Sandbox tab opens with both fighter cards and the combat timeline", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sandbox", exact: true }).click();
    // Page-title banner (design-level marker).
    await expect(page.getByRole("heading", { name: "Sandbox", level: 1 })).toBeVisible();
    // Per-side fighter cards expose a posture control group each.
    await expect(page.getByRole("group", { name: "Posture (Side A)" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Posture (Side B)" })).toBeVisible();
    // The combat timeline region renders (empty until the fight is stepped).
    await expect(page.getByRole("region", { name: "Combat event timeline" })).toBeVisible();
  });

  test("Apply seeds a status on Side B", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sandbox", exact: true }).click();
    // The on-page Start setup tool defaults to Side A; switch it to Side B,
    // then apply the seed status (Poison_Status is the default, but the assert
    // below stays loose on the chip so the spec survives a default change).
    const startSetup = page.getByRole("tablist", { name: "Side to configure" });
    await startSetup.getByRole("tab", { name: "Side B" }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    // Side B's fighter card should pick up the seeded status chip.
    const sideB = page.locator(".sb-fighter--b");
    await expect(sideB.locator(".sb-status").first()).toBeVisible({ timeout: 5_000 });
  });
});
