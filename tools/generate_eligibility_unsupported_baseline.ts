/**
 * Generates src/optimizer/eligibilityUnsupported.baseline.json: a per-creature
 * snapshot of the ability names the Rust best-builds / contour eligibility path
 * treats as UNSUPPORTED (see eligibilitySnapshot.ts). The committed baseline
 * freezes the known set so an eligibility regression (e.g. the Zeoarex
 * "Radiation Trail" break, where a coverage-side broadening leaked into the
 * engine's isModeledOtherAbility) surfaces as an explicit diff in CI.
 *
 * Re-run ONLY when you intentionally accept an eligibility change:
 *   npx tsx tools/generate_eligibility_unsupported_baseline.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeEligibilityUnsupportedSnapshot } from "../src/optimizer/eligibilitySnapshot";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "src", "optimizer", "eligibilityUnsupported.baseline.json");

const snapshot = computeEligibilityUnsupportedSnapshot();
writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
console.log(`wrote ${OUT} (${Object.keys(snapshot).length} creatures with unsupported abilities)`);
