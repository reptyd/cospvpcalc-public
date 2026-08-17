import { expect, test } from "@playwright/test";

/**
 * Smoke test: the app boots, mounts React, and renders without
 * crashing on first visit. Catches the common "broken build",
 * "missing /version.json", "main bundle 404", and "uncaught render
 * error" regressions that no unit test sees.
 */

test.describe("App boot", () => {
  test("renders without falling into the error boundary or unsupported-browser gate", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(`pageerror: ${error.message}`);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto("/");

    // Wait for React to mount: the root container should have
    // children. The fallback gate replaces innerHTML directly with
    // a single role="alert" div, so we'd see that role if the
    // feature-detect failed.
    const alerts = await page.locator('[role="alert"]').all();
    for (const alert of alerts) {
      const text = await alert.innerText();
      expect(text).not.toContain("This browser is too old");
      expect(text).not.toContain("Something broke");
    }

    // The app renders something app-shaped - the skip-link mounts at
    // the top of the page.
    await expect(page.locator(".skip-link")).toHaveCount(1);

    // Fail the test on any uncaught error or console.error during
    // boot - the loose assertion above only catches rendered
    // failures, not crashes in workers / async paths.
    expect(errors).toEqual([]);
  });

  test("skip-link gains focus and points at #main-content", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute("href") ?? null,
    );
    expect(focused).toBe("#main-content");
  });
});
