/**
 * Rewrites src/pages/referenceCoverage.baseline.json to the entries that
 * nothing verifies. Run when an entry drops out of coverage and you have
 * decided to accept that rather than write the check.
 *
 * The baseline maps each id to a reason. Existing reasons are preserved and
 * ids that became verified are dropped; a newly uncovered id lands with an
 * empty reason, which the gate rejects until it says which layer holds the
 * mechanic and what a check would have to read. Nothing here can write that
 * sentence for you.
 *
 * Run: npx tsx tools/generate_reference_coverage_baseline.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { uncoveredEntryIds } from "../src/pages/referenceCoverage";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(REPO_ROOT, "src", "pages", "referenceCoverage.baseline.json");

const existing = JSON.parse(readFileSync(OUT, "utf8")) as Record<string, string>;
const uncovered = uncoveredEntryIds(REPO_ROOT);

const next: Record<string, string> = {};
for (const id of uncovered) next[id] = existing[id] ?? "";

writeFileSync(OUT, JSON.stringify(next, null, 2) + "\n", "utf8");

const missing = uncovered.filter((id) => !next[id]);
console.log(`wrote ${OUT} (${uncovered.length} entries)`);
if (missing.length) {
  console.log(`\nNo reason yet for:\n${missing.map((id) => `  ${id}`).join("\n")}`);
  console.log("\nEach one needs the layer the mechanic runs in and what a check would read.");
  process.exitCode = 1;
}
