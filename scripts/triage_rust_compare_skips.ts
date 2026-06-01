// Phase 3 step 4 triage: for each ability that the per-ability sweep reports
// as "rust ineligible", show the carrier creature, the Rust-unsupported
// passives and activateds on that carrier, and classify the block reason.
//
// Usage:
//   node --experimental-wasm-modules --import tsx scripts/triage_rust_compare_skips.ts

import { applyRulesAndBuild, simulateFight, type BuildOptions } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import {
  applyCompareBuffRuntime,
  DEFAULT_COMPARE_BUFF_SELECTION,
} from "../src/engine/compareBuffRuntime";
import { DEFAULT_MAX_TIME_SEC } from "../src/engine/subsystems/timing";
import {
  getRustUnsupportedPassiveAbilityNamesForBreath,
  getRustUnsupportedActivatedAbilityNamesForComposable,
} from "../src/optimizer/rustBestBuildsRuntime";

const BUILD: BuildOptions = {
  venerationStage: 5,
  traits: ["Damage", "Weight"],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
  plushies: ["Void", "Void"],
};

const SKIPPED_ABILITIES = [
  "Aura (Disease)",
  "Block Disease",
  "Charge Power",
  "Defensive Corrosion",
  "DefiledGround",
  "Divination",
  "Energy Breath",
  "Ligament Tear",
  "Plague Trail",
  "Poison Area",
  "Raider",
  "Self-Destruct",
  "Totem",
  "Toxic Trap",
  "Toxin Breath",
  "Yolk Bomb",
];

function discoverCarrier(ability: string): string | null {
  for (const name of Object.keys(creatureByName)) {
    try {
      const runtime = creatureByName[name]!;
      const built = applyRulesAndBuild(runtime, BUILD);
      const buffed = applyCompareBuffRuntime(built, BUILD, DEFAULT_COMPARE_BUFF_SELECTION, "none", "none");
      const summary = simulateFight(buffed.finalStats, buffed.finalStats, {
        activesOn: false,
        breathOn: false,
        maxTimeSec: DEFAULT_MAX_TIME_SEC,
        enableCombatLog: false,
      });
      if ((summary.debug?.A.abilitiesPresent ?? []).includes(ability)) return name;
    } catch {
      continue;
    }
  }
  return null;
}

function main() {
  console.log("Triage of Compare-ineligible skipped abilities:\n");
  for (const ability of SKIPPED_ABILITIES) {
    const carrier = discoverCarrier(ability);
    if (!carrier) {
      console.log(`  ${ability.padEnd(20)} — no carrier found`);
      continue;
    }
    const runtime = creatureByName[carrier]!;
    const unsupportedPassives = getRustUnsupportedPassiveAbilityNamesForBreath(runtime);
    const unsupportedActivateds = getRustUnsupportedActivatedAbilityNamesForComposable(runtime);
    console.log(`  ${ability}`);
    console.log(`    carrier: ${carrier}`);
    console.log(`    unsupported passives:   [${unsupportedPassives.join(", ")}]`);
    console.log(`    unsupported activateds: [${unsupportedActivateds.join(", ")}]`);
    console.log("");
  }
}

main();
