/**
 * Walks every creature in `data/creatures.runtime.json` and prints
 * any whose presence still blocks the Rust composable Compare
 * eligibility (i.e. names not in COMPOSABLE_SUPPORTED_*, not in
 * NO_OP / NOT_MODELED / OUT_OF_MODEL filters). Each such name is a
 * concrete gap that keeps the deprecated TS engine alive.
 *
 * Usage: `npx tsx scripts/diagnose_rust_eligibility_gaps.ts`.
 */

import {
  getRustUnsupportedActivatedAbilityNamesForComposable,
  getRustUnsupportedPassiveAbilityNamesForBreath,
} from "../src/optimizer/rustBestBuildsRuntime";
import type { CreatureRuntime } from "../src/engine/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raw = readFileSync(
  resolve(process.cwd(), "data/creatures.runtime.json"),
  "utf-8",
);
const parsed = JSON.parse(raw) as { creatures?: CreatureRuntime[] };
const creatures: CreatureRuntime[] = parsed.creatures ?? [];

const passiveGaps = new Map<string, string[]>(); // ability → creatures
const activatedGaps = new Map<string, string[]>();

for (const creature of creatures) {
  for (const ability of getRustUnsupportedPassiveAbilityNamesForBreath(creature)) {
    const list = passiveGaps.get(ability) ?? [];
    list.push(creature.name);
    passiveGaps.set(ability, list);
  }
  for (const ability of getRustUnsupportedActivatedAbilityNamesForComposable(creature)) {
    const list = activatedGaps.get(ability) ?? [];
    list.push(creature.name);
    activatedGaps.set(ability, list);
  }
}

const fmt = (label: string, map: Map<string, string[]>) => {
  console.log(`\n## ${label} (${map.size} unique abilities)`);
  if (map.size === 0) {
    console.log("  (none — Rust covers every passive / activated on every creature)");
    return;
  }
  const sorted = [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [name, owners] of sorted) {
    console.log(`  - "${name}" — ${owners.length} creature(s): ${owners.slice(0, 5).join(", ")}${owners.length > 5 ? ", …" : ""}`);
  }
};

console.log(`Scanned ${creatures.length} creatures.`);
fmt("Unsupported passive (blocks breath-contour Rust eligibility)", passiveGaps);
fmt("Unsupported activated (blocks composable Compare Rust eligibility)", activatedGaps);
