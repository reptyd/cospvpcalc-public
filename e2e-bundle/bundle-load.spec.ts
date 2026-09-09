import { test, expect, type Page } from "@playwright/test";

// The production crash was a non-deterministic cross-chunk init-order TDZ, so a
// few samples prove nothing - cold-load the app many independent times. Override
// with BUNDLE_RELOADS (CI dials it up).
const RELOADS = Number(process.env.BUNDLE_RELOADS ?? 40);

function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

async function expectBooted(page: Page, errors: string[], label: string): Promise<void> {
  // The error boundary also renders into #root, so a mounted #root is not enough;
  // assert no thrown/console error AND that the fallback copy is absent.
  await page.waitForSelector("#root *", { state: "attached", timeout: 20_000 });
  const broken = await page.evaluate(() =>
    /something broke|unexpected error|went wrong/i.test(document.body.innerText || ""),
  );
  expect(broken, `${label}: error boundary fallback rendered`).toBe(false);
  expect(errors, `${label}: page/console errors during load`).toEqual([]);
}

// Cold-load the REAL entry path - bare "/". The init-order TDZ this gate exists
// for fires only on the unparameterised load; a "?x=N" cache-buster masked it
// during the 2026-06 incident, so each cold load must hit "/" with no query.
for (let i = 0; i < RELOADS; i++) {
  test(`bundle cold-loads clean #${i}`, async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectBooted(page, errors, `load #${i}`);
  });
}

test("Compare fight runs on the built bundle (main-thread WASM)", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await expectBooted(page, errors, "compare");
  await page.getByRole("button", { name: /run fight/i }).first().click();
  // A result renders without tripping the error boundary.
  await expect
    .poll(() => page.evaluate(() => /something broke|unexpected error|went wrong/i.test(document.body.innerText || "")), {
      timeout: 20_000,
    })
    .toBe(false);
  expect(errors, "errors during compare fight").toEqual([]);
});

test("Best Builds worker boots on the built bundle (worker WASM)", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await expectBooted(page, errors, "best-builds");
  await page.getByText("Best Builds", { exact: true }).first().click();
  await page.getByRole("button", { name: /^calculate$/i }).first().click();
  // The optimizer worker loads its own bundle, inits WASM, and starts the search.
  // Assert it STARTS (progress) or finishes - not specifically the full 80-opponent
  // result - so this stays a worker-bundle boot check (the chunk-init concern) and
  // does not flake on a CPU-bound wait on slow CI cores. Engine correctness is
  // covered by vitest + cargo.
  await expect(
    page.getByText(/running|searching|computing|ranked by win rate|computed in/i).first(),
  ).toBeVisible({ timeout: 45_000 });
  const broken = await page.evaluate(() =>
    /something broke|unexpected error|went wrong/i.test(document.body.innerText || ""),
  );
  expect(broken, "best-builds: error boundary after Calculate").toBe(false);
  expect(errors, "errors during best-builds worker start").toEqual([]);
});
