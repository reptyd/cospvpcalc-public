import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility GATE. Runs axe-core (WCAG 2.0/2.1 A + AA) against the
 * landing page and each primary tab, and FAILS the test if any
 * violation has impact `critical` or `serious`. `moderate` / `minor`
 * findings are allowed through but logged so a human can triage them
 * later. This suite runs as part of `npm run test:e2e`, so it gates CI
 * automatically.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// Impact levels that must not appear. `moderate` / `minor` are tolerated
// (logged, not asserted) so the gate stays focused on real blockers.
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);

// Pages that spin up WASM workers (Best Builds / Optimizer) keep the
// network busy, so `networkidle` never fires. Each test owns its own
// browser context, so a per-test budget keeps one slow page from
// starving the rest.
test.describe.configure({ mode: "default" });

async function scanAndAssert(page: Page, label: string): Promise<void> {
  // Let lazy-loaded route chunks + first paint settle. A bounded wait,
  // never `networkidle` (worker traffic stalls it indefinitely).
  await page.waitForTimeout(1500);

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""));
  const tolerated = results.violations.filter((v) => !BLOCKING_IMPACTS.has(v.impact ?? ""));

  // Surface moderate/minor findings without failing - useful triage signal.
  if (tolerated.length > 0) {
    const summary = tolerated.map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`).join(", ");
    console.log(`A11Y_TOLERATED ${label}: ${summary}`);
  }

  const failureMessage =
    blocking.length === 0
      ? ""
      : `${label}: ${blocking.length} blocking a11y violation(s) [${blocking
          .map((v) => `${v.id} (${v.impact}, ${v.nodes.length} node(s))`)
          .join(", ")}]`;

  expect(blocking, failureMessage).toEqual([]);
}

// Wait for a tab's signal heading, but never let a missing heading
// eat the whole test budget - the scan should still run on whatever
// rendered. 8s is generous for a lazy chunk + first paint.
async function waitForHeading(page: Page, name: string): Promise<void> {
  await page
    .getByRole("heading", { name, exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => {});
}

test.describe("a11y gate", () => {
  test("landing", async ({ page }) => {
    await page.goto("/");
    await scanAndAssert(page, "Landing");
  });

  test("Compare", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await waitForHeading(page, "Outcome");
    await scanAndAssert(page, "Compare");
  });

  test("Best Builds", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page.getByRole("button", { name: "Best Builds", exact: true }).click();
    await waitForHeading(page, "Top Builds");
    await scanAndAssert(page, "Best Builds");
  });

  test("Optimizer", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page.getByRole("button", { name: "Optimizer", exact: true }).click();
    await waitForHeading(page, "Settings");
    await scanAndAssert(page, "Optimizer");
  });

  test("Sandbox", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sandbox", exact: true }).click();
    await waitForHeading(page, "Sandbox Controls");
    await scanAndAssert(page, "Sandbox");
  });

  test("Custom abilities", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Custom", exact: true }).click();
    // Custom is a sub-tabbed page; give the lazy chunk a beat to mount.
    await page.waitForTimeout(800);
    await scanAndAssert(page, "Custom");
  });
});
