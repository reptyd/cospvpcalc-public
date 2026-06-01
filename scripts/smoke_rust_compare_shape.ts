// Off-UI smoke test for Phase 3 step 3: validates that the Rust WASM
// composable engine returns a `RustMatchupSummary` whose shape satisfies
// Compare UI consumers. Not a parity test — only checks presence and type
// of the new fields added in steps (a)-(g).
//
// Run: npx tsx scripts/smoke_rust_compare_shape.ts

import { applyRulesAndBuild, type BuildOptions } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import {
  applyCompareBuffRuntime,
  DEFAULT_COMPARE_BUFF_SELECTION,
} from "../src/engine/compareBuffRuntime";
import { DEFAULT_COMPARE_SPECIAL_ABILITIES } from "../src/components/compare/compareSpecialAbilities";
import { getCompareAppetiteEntry } from "../src/engine/compareAppetiteData";
import {
  toRustComposableArgsFromCompare,
  type CompareSidePerks,
  type CompareFirstTickConfig,
} from "../src/optimizer/rustCompareMatchupRuntime";
import {
  loadRustMatchupBridge,
  getLoadedRustMatchupBridge,
} from "../src/optimizer/rustMatchupLoader";
import type { RustMatchupSummary } from "../src/optimizer/rustMatchupBridge";

const SOURCE_NAME = "Adharcaiin";
const OPPONENT_NAME = "Aereis";
const BUILD: BuildOptions = {
  venerationStage: 5,
  traits: ["Damage", "Weight"],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
  plushies: ["Void", "Void"],
};

function requireCreature(name: string) {
  const creature = creatureByName[name];
  if (!creature) throw new Error(`Missing creature: ${name}`);
  return creature;
}

function defaultPerks(name: string): CompareSidePerks {
  const appetite = getCompareAppetiteEntry(name)?.appetite ?? 100;
  return {
    traps: false,
    trails: false,
    powerCharge: false,
    goreCharge: false,
    startingSpiteCharged: false,
    muddyBuff: false,
    hungerRule: false,
    gourmandizer: false,
    startingHungerUnits: 0,
    appetiteBaseUnits: appetite,
    defiledGroundLevel: 0,
    defiledGroundWeakness: false,
  };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

async function main() {
  const source = requireCreature(SOURCE_NAME);
  const opponent = requireCreature(OPPONENT_NAME);

  const builtA = applyRulesAndBuild(source, BUILD);
  const builtB = applyRulesAndBuild(opponent, BUILD);
  const buffedA = applyCompareBuffRuntime(builtA, BUILD, DEFAULT_COMPARE_BUFF_SELECTION, "none", "none");
  const buffedB = applyCompareBuffRuntime(builtB, BUILD, DEFAULT_COMPARE_BUFF_SELECTION, "none", "none");

  const firstTick: CompareFirstTickConfig = { mode: "off", delaySec: 1.0 };

  const rustArgs = toRustComposableArgsFromCompare({
    sourceCreature: source,
    opponentCreature: opponent,
    finalA: buffedA.finalStats,
    finalB: buffedB.finalStats,
    activesOn: false,
    breathOn: false,
    abilityPolicy: "semiIdeal",
    initialStatusesA: buffedA.initialStatuses,
    initialStatusesB: buffedB.initialStatuses,
    activeCooldownMultiplierA: buffedA.activeCooldownMultiplier,
    activeCooldownMultiplierB: buffedB.activeCooldownMultiplier,
    disabledAbilitiesA: [],
    disabledAbilitiesB: [],
    perksA: defaultPerks(SOURCE_NAME),
    perksB: defaultPerks(OPPONENT_NAME),
    firstTick,
    noMoveFacetank: true,
  });

  const _specialAbilities = DEFAULT_COMPARE_SPECIAL_ABILITIES; // unused, referenced only to pin import.
  void _specialAbilities;

  await loadRustMatchupBridge();
  const bridge = getLoadedRustMatchupBridge();
  assert(bridge, "Rust bridge did not load");

  const summary = bridge.simulateComposableMatchup(
    rustArgs.attacker,
    rustArgs.defender,
    rustArgs.attackerBreath,
    rustArgs.defenderBreath,
    rustArgs.abilityPolicy,
    rustArgs.abilityConfig,
    60,
    true, // recordTrace -> combatLog + debug
  ) as RustMatchupSummary;

  console.log(`smoke: ${SOURCE_NAME} vs ${OPPONENT_NAME}, winner=${summary.winner}, ttkA=${summary.ttkAtoB.toFixed(2)}, deathA=${summary.deathTimeA}, deathB=${summary.deathTimeB}`);

  // --- Top-level ----------------------------------------------------------
  assert(["A", "B", "Draw"].includes(summary.winner), `winner must be enum string, got ${summary.winner}`);
  assert(typeof summary.maxTimeSec === "number", "maxTimeSec");
  assert(typeof summary.dpsAtoB === "number", "dpsAtoB");
  assert(typeof summary.ttkAtoB === "number", "ttkAtoB");
  assert(typeof summary.damageDealtA === "number", "damageDealtA");

  // Step (a) regen counters
  assert(typeof summary.regenHealedA === "number", "regenHealedA");
  assert(typeof summary.regenHealedB === "number", "regenHealedB");
  assert(typeof summary.regenTicksA === "number", "regenTicksA");
  assert(typeof summary.regenTicksB === "number", "regenTicksB");

  // Trace fields (recordTrace=true)
  assert(Array.isArray(summary.combatLog), "combatLog must be array when recordTrace=true");
  assert(summary.combatLog!.length > 0, "combatLog should have at least one entry for a real fight");
  const entry = summary.combatLog![0];
  assert(typeof entry.time === "number", "combatLog[0].time");
  assert(typeof entry.actorHpAfter === "number", `combatLog[0].actorHpAfter (camelCase fix) — got ${JSON.stringify(entry)}`);
  assert(typeof entry.hpSide === "string", "combatLog[0].hpSide (camelCase fix)");
  assert(typeof entry.hpAfter === "number", "combatLog[0].hpAfter (camelCase fix)");

  assert(summary.debug, "debug must be present when recordTrace=true");
  const a = summary.debug!.A;
  assert(a, "debug.A");

  // Step (c) warden_rage_events: Vec<String>
  assert(Array.isArray(a.wardenRageEvents), "debug.A.wardenRageEvents must be array (step c)");
  a.wardenRageEvents.forEach((e, i) => {
    assert(typeof e === "string", `debug.A.wardenRageEvents[${i}] not string`);
  });

  // Step (d) abilityTimingEvents
  assert(Array.isArray(a.abilityTimingEvents), "debug.A.abilityTimingEvents must be array (step d)");
  a.abilityTimingEvents.forEach((e, i) => {
    assert(typeof e === "string", `debug.A.abilityTimingEvents[${i}] not string`);
  });
  assert(a.abilityTimingEvents.length <= 200, `debug.A.abilityTimingEvents cap 200 — got ${a.abilityTimingEvents.length}`);

  // Step (e) compare-hunger fields
  assert(typeof a.compareHunger === "number", "debug.A.compareHunger (step e)");
  assert(typeof a.compareStartingHunger === "number", "debug.A.compareStartingHunger (step e)");
  assert(typeof a.compareAppetiteBase === "number", "debug.A.compareAppetiteBase (step e)");
  assert(typeof a.compareHungerRuleEnabled === "boolean", "debug.A.compareHungerRuleEnabled (step e)");

  // Other debug fields Compare consumers read
  assert(Array.isArray(a.abilitiesPresent), "debug.A.abilitiesPresent");
  assert(Array.isArray(a.abilitiesModeled), "debug.A.abilitiesModeled");
  assert(Array.isArray(a.abilitiesNotModeled), "debug.A.abilitiesNotModeled");
  assert(typeof a.statusStacksApplied === "object", "debug.A.statusStacksApplied");

  console.log("smoke: all shape checks passed");
  console.log(`  combatLog entries: ${summary.combatLog!.length}`);
  console.log(`  debug.A.abilityTimingEvents: ${a.abilityTimingEvents.length} entries`);
  console.log(`  debug.A.wardenRageEvents: ${a.wardenRageEvents.length} entries`);
  console.log(`  debug.A.compareHunger=${a.compareHunger}, hungerRuleEnabled=${a.compareHungerRuleEnabled}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
