/**
 * Generates src/pages/referenceCoverage.baseline.json from current Reference
 * draft arrays. Run once at coverage-gate bootstrap; re-run only when you
 * intentionally accept new uncovered entries.
 *
 * Run: npx tsx tools/generate_reference_coverage_baseline.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABILITY_POLICY_REFERENCE_DRAFTS,
  COMPARE_ONLY_REFERENCE_DRAFTS,
  KNOWN_APPROXIMATION_REFERENCE_DRAFTS,
  MODELED_ABILITY_REFERENCE_DRAFTS,
  PLUSHIE_REFERENCE_DRAFTS,
  STATUS_REFERENCE_DRAFTS,
} from "../src/pages/referenceContent";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "src", "pages", "referenceCoverage.baseline.json");

const all = [
  ...MODELED_ABILITY_REFERENCE_DRAFTS,
  ...STATUS_REFERENCE_DRAFTS,
  ...COMPARE_ONLY_REFERENCE_DRAFTS,
  ...KNOWN_APPROXIMATION_REFERENCE_DRAFTS,
  ...ABILITY_POLICY_REFERENCE_DRAFTS,
  ...PLUSHIE_REFERENCE_DRAFTS,
];

const uncoveredIds = all
  .filter((entry) => Array.isArray((entry as { mechanics?: string[] }).mechanics)
    && ((entry as { mechanics: string[] }).mechanics.length > 0))
  .map((entry) => entry.id)
  .sort();

writeFileSync(OUT, JSON.stringify(uncoveredIds, null, 2) + "\n", "utf8");
console.log(`wrote ${OUT} (${uncoveredIds.length} entries)`);
