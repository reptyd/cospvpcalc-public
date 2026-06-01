#!/usr/bin/env tsx
/**
 * scripts/check_doc_freshness.ts
 *
 * Permanent guard against doc drift. Greps top-level contributor docs
 * for known-now-false phrases that have appeared and been fixed in
 * past audits. Exits non-zero on a hit so CI can block the regression.
 *
 * Usage: `npx tsx scripts/check_doc_freshness.ts`
 *
 * To add a new check, append to `STALE_PATTERNS` below with:
 *   - `pattern`: case-insensitive substring or regex
 *   - `files`: which docs to scan (relative to repo root)
 *   - `reason`: one-line explanation of why this phrase is stale.
 *     The reason is printed when CI fails so contributors don't
 *     have to dig through audit history to understand the failure.
 *
 * Audit references for the seeded patterns:
 *   - audit #20: stale "falls back to a JavaScript engine" + "slated
 *     for deletion" lines after the TS engine deletion.
 *   - audit #21: stale "9.5/10 threshold" after the 9.5 → 9.8 raise.
 *   - audit #19: stale "Playwright is installed but not wired up"
 *     after Playwright e2e went live.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface StalePattern {
  pattern: string | RegExp;
  files: string[];
  reason: string;
}

const REPO_ROOT = resolve(import.meta.dirname ?? __dirname, "..");

const STALE_PATTERNS: StalePattern[] = [
  {
    pattern: /falls back to a Java[Ss]cript engine/i,
    files: ["README.md", "CONTRIBUTING.md"],
    reason:
      "TS engine was deleted in audit #19/#20. Site shows a 'WASM unavailable' banner; there is no JS fallback path.",
  },
  {
    pattern: /slated for deletion/i,
    files: ["README.md", "CONTRIBUTING.md"],
    reason:
      "TS engine IS deleted (audit #19/#20). Update the line to past tense or strike it.",
  },
  {
    pattern: /9\.5\/10 threshold/i,
    files: ["README.md", "CONTRIBUTING.md"],
    reason:
      "Threshold was raised to 9.8/10 in audit #21 (final-polish phase). Update to 9.8/10.",
  },
  {
    pattern: /Playwright is installed but not wired up/i,
    files: ["README.md", "CONTRIBUTING.md"],
    reason:
      "Playwright e2e went live in audit #19 (e2e/app-boot.spec.ts, playwright.config.ts).",
  },
];

let failures = 0;

for (const check of STALE_PATTERNS) {
  for (const relPath of check.files) {
    const absPath = resolve(REPO_ROOT, relPath);
    if (!existsSync(absPath)) continue;
    const content = readFileSync(absPath, "utf8");
    const matches = check.pattern instanceof RegExp
      ? content.match(check.pattern)
      : content.toLowerCase().includes(check.pattern.toLowerCase()) ? [check.pattern] : null;
    if (matches) {
      const lineIdx = content.split(/\r?\n/).findIndex((line) =>
        check.pattern instanceof RegExp ? check.pattern.test(line) : line.toLowerCase().includes((check.pattern as string).toLowerCase())
      );
      const lineHint = lineIdx >= 0 ? `:${lineIdx + 1}` : "";
       
      console.error(
        `[stale doc] ${relPath}${lineHint} contains "${matches[0]}"\n  reason: ${check.reason}\n`,
      );
      failures += 1;
    }
  }
}

if (failures > 0) {
   
  console.error(`check_doc_freshness: ${failures} stale doc reference(s). Fix them or remove the pattern from STALE_PATTERNS once obsolete.`);
  process.exit(1);
}

 
console.log(`check_doc_freshness: ${STALE_PATTERNS.length} pattern(s) checked across top-level docs — all clean.`);
