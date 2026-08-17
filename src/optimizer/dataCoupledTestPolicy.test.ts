/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Repo-wide guard for the "tests must not couple to live game numbers" policy
// (docs/data_refresh.md -> "Tests and data coupling"). A behavioral test that
// asserts a data-derived value must OWN its input (a synthetic fixture) or
// assert a RELATION against a live field - never read a live creature AND pin a
// raw game number, because a routine wiki sync then false-fails it. This gate
// catches the two highest-value, low-false-positive forms of re-coupling:
//   1. snapshotting live creature data (the exact pattern that broke before);
//   2. any NEW test reading live creature data without a reviewed entry below.
// Literal-number coupling that isn't a snapshot is covered by the policy doc +
// review (a regex for it would false-flag legitimate structural literals).

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SRC_ROOT, "..");
const THIS_FILE = "src/optimizer/dataCoupledTestPolicy.test.ts";

// `creaturesData` is the roster array the two lookups are built from, so a test
// can read every live creature without naming either of them - which is how a
// snapshot of live breath profiles walked past this gate.
const LIVE_DATA_RE = /\b(?:creatureByName|getCreatureByName|creaturesData)\b/;
const SNAPSHOT_RE = /\.toMatch(?:Inline)?Snapshot\s*\(/;

// Test files that intentionally read live creature data. Each asserts a
// data-INDEPENDENT property - structure, a relation (`built.x === stat * K`),
// presence, or "no errors thrown" - NOT a raw game number. Adding a file here
// is a deliberate, reviewed choice; if your test asserts a specific value,
// drive it with a synthetic fixture instead
// (src/optimizer/__fixtures__/syntheticCreature.ts).
const LIVE_DATA_ALLOWLIST = new Set<string>([
  "src/engine/buildRules.test.ts",
  "src/engine/compareCombatToggleOptions.test.ts",
  // Funnel: pipelineE2E and cellCostProbe only report wall-clock and fight
  // counts, and are opt-in.
  "src/optimizer/bbFunnel/pipelineE2E.test.ts",
  "src/optimizer/bbFunnel/cellCostProbe.test.ts",
  "src/engine/dataIntegrity.test.ts",
  "src/engine/customCreatureCatalogBridge.test.ts",
  // Takes a real carrier for each ability and asks only whether the payload
  // field moved off its idle value, never what the value is - the magnitudes are
  // roster data and a sync is free to move them.
  "src/optimizer/abilityPayloadContract.test.ts",
  "src/optimizer/bestBuildsOptimizations.test.ts",
  "src/optimizer/bestBuildsPageFlow.test.ts",
  "src/optimizer/bestBuildsRuntime.test.ts",
  "src/optimizer/engineCoverageBoundary.test.ts",
  "src/optimizer/poolUtils.test.ts",
  "src/optimizer/posturePolicyRealCompareBeam.test.ts",
  "src/optimizer/rustBestBuildsRuntime.test.ts",
  "src/optimizer/rustCompareMatchupRuntime.test.ts",
  "src/optimizer/schemaSeamStatParity.test.ts",
  // Reached by widening the regex to `creaturesData`. Each asserts a relation
  // or a structural property, never a scraped magnitude.
  // Prunes the effects catalog against the roster and counts what survives.
  "src/engine/effectsCatalogPrune.test.ts",
  // Asserts which immunity ids an ability carries, not any creature's numbers.
  "src/engine/weatherImmunity.test.ts",
  // Asks which meters each creature carries and whether the classes stay
  // non-empty. No appetite magnitude is pinned, only that one exists.
  "src/engine/compareMeters.test.ts",
  // Counts ability coverage by scope label; no magnitude is read.
  "src/optimizer/abilityCoverage.test.ts",
  // Both only ask whether the shipped WASM runs a real matchup at all.
  "src/optimizer/wasmFreshness.test.ts",
  "src/optimizer/wasmMatchupSmoke.test.ts",
]);

function relPosix(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function allTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__snapshots__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allTestFiles(full));
    else if (entry.isFile() && /\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("data-coupled test policy", () => {
  const files = allTestFiles(SRC_ROOT)
    .map(relPosix)
    .filter((f) => f !== THIS_FILE);
  const sourceOf = (f: string) => readFileSync(path.join(REPO_ROOT, f), "utf8");
  const readsLiveData = (f: string) => LIVE_DATA_RE.test(sourceOf(f));

  it("no test snapshots live creature data (own the input with a fixture instead)", () => {
    const offenders = files.filter((f) => readsLiveData(f) && SNAPSHOT_RE.test(sourceOf(f)));
    expect(
      offenders,
      "these test files both read live creatures and call toMatchSnapshot - a wiki sync will " +
        "false-fail them; drive the snapshot with a synthetic fixture instead",
    ).toEqual([]);
  });

  it("every live-data test file is on the reviewed allowlist", () => {
    const unlisted = files.filter((f) => readsLiveData(f) && !LIVE_DATA_ALLOWLIST.has(f));
    expect(
      unlisted,
      "these test files read live creature data but aren't on LIVE_DATA_ALLOWLIST - confirm they " +
        "assert data-INDEPENDENT properties (not raw game numbers) and add them, or switch to a " +
        "synthetic fixture (src/optimizer/__fixtures__/syntheticCreature.ts)",
    ).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    const present = new Set(files);
    const stale = [...LIVE_DATA_ALLOWLIST].filter((f) => !present.has(f) || !readsLiveData(f));
    expect(stale, "allowlist entries that no longer read live creature data - remove them").toEqual([]);
  });
});
