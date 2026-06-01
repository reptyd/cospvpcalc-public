// Phase 3 step 4 diagnostic: run one Compare matchup through both TS simulateFight
// and the Rust dispatch (trySimulateRustCompareMatchup) and diff the projected
// BestBuildsMatchupSummary surface (+ event-type counts from combatLog + debug).
//
// Motivation: scripts/generate_rust_compare_fixtures.ts notes a documented ~0.6-1.0s
// TTK drift on passive-only Kendyll-vs-{Korathos,Lactarim}. Classify this before
// seeding parity fixtures.
//
// Run: node --experimental-wasm-modules --import tsx scripts/diagnose_rust_compare_drift.ts

import { applyRulesAndBuild, simulateFight, type BuildOptions, type SimulationSummary } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import {
  applyCompareBuffRuntime,
  DEFAULT_COMPARE_BUFF_SELECTION,
} from "../src/engine/compareBuffRuntime";
import { DEFAULT_COMPARE_SPECIAL_ABILITIES } from "../src/components/compare/compareSpecialAbilities";
import { getCompareAppetiteEntry } from "../src/engine/compareAppetiteData";
import { DEFAULT_MAX_TIME_SEC } from "../src/engine/subsystems/timing";
import type { CompareSidePerks } from "../src/optimizer/rustCompareMatchupRuntime";
import { loadRustMatchupBridge } from "../src/optimizer/rustMatchupLoader";
import { trySimulateRustCompareMatchup } from "../src/optimizer/rustCompareDispatch";

const BUILD: BuildOptions = {
  venerationStage: 5,
  traits: ["Damage", "Weight"],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
  plushies: ["Void", "Void"],
};

type CasePair = { a: string; b: string };
const CASES: CasePair[] = [
  { a: "Kendyll", b: "Korathos" },
  { a: "Kendyll", b: "Lactarim" },
  { a: "Adharcaiin", b: "Aereis" },
];

function requireCreature(name: string) {
  const c = creatureByName[name];
  if (!c) throw new Error(`Missing creature: ${name}`);
  return c;
}

function defaultPerks(name: string): CompareSidePerks {
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
    appetiteBaseUnits: getCompareAppetiteEntry(name)?.appetite ?? 100,
    defiledGroundLevel: 0,
    defiledGroundWeakness: false,
  };
}

function biteCount(summary: SimulationSummary): { A: number; B: number } {
  let a = 0, b = 0;
  for (const e of summary.combatLog ?? []) {
    if (e.type === "bite") {
      if (e.attacker === "A") a++;
      else if (e.attacker === "B") b++;
    }
  }
  return { A: a, B: b };
}

function fmt(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(3);
}

async function runCase({ a, b }: CasePair) {
  const source = requireCreature(a);
  const opponent = requireCreature(b);
  const builtA = applyRulesAndBuild(source, BUILD);
  const builtB = applyRulesAndBuild(opponent, BUILD);
  const buffedA = applyCompareBuffRuntime(builtA, BUILD, DEFAULT_COMPARE_BUFF_SELECTION, "none", "none");
  const buffedB = applyCompareBuffRuntime(builtB, BUILD, DEFAULT_COMPARE_BUFF_SELECTION, "none", "none");

  // TS oracle — passive-only (activesOn=false, breathOn=false), semiIdeal, no overrides.
  const ts = simulateFight(buffedA.finalStats, buffedB.finalStats, {
    activesOn: false,
    breathOn: false,
    maxTimeSec: DEFAULT_MAX_TIME_SEC,
    enableCombatLog: true,
    disabledAbilitiesA: [],
    disabledAbilitiesB: [],
    initialStatusesA: buffedA.initialStatuses,
    initialStatusesB: buffedB.initialStatuses,
    activeCooldownMultiplierA: buffedA.activeCooldownMultiplier,
    activeCooldownMultiplierB: buffedB.activeCooldownMultiplier,
    badOmenOutcome: null,
    abilityPolicy: "semiIdeal",
    compareSecondaryAttackOnlyA: false,
    compareSecondaryAttackOnlyB: false,
    compareAirRuleEnabled: false,
    compareAirRuleCooldownSec: 0,
    compareNoMoveFacetank: true,
    compareFirstTickMode: "off",
    compareFirstTickDelaySec: 1.0,
    compareTrapsA: false,
    compareTrapsB: false,
    compareTrailsA: false,
    compareTrailsB: false,
    comparePowerChargeA: false,
    comparePowerChargeB: false,
    compareGoreChargeA: false,
    compareGoreChargeB: false,
    compareStartingSpiteChargedA: false,
    compareStartingSpiteChargedB: false,
    compareHungerRuleA: false,
    compareHungerRuleB: false,
    compareGourmandizerA: false,
    compareGourmandizerB: false,
    compareDefiledGroundLevelA: 0,
    compareDefiledGroundLevelB: 0,
    compareStartingHungerA: 0,
    compareStartingHungerB: 0,
    compareAppetiteBaseA: getCompareAppetiteEntry(a)?.appetite ?? 100,
    compareAppetiteBaseB: getCompareAppetiteEntry(b)?.appetite ?? 100,
  });

  await loadRustMatchupBridge();
  const rust = await trySimulateRustCompareMatchup({
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
    perksA: defaultPerks(a),
    perksB: defaultPerks(b),
    firstTick: { mode: "off", delaySec: 1.0 },
    noMoveFacetank: true,
    compareAirRuleEnabled: false,
    compareSecondaryAttackOnlyA: false,
    compareSecondaryAttackOnlyB: false,
    badOmenOutcome: null,
    maxTimeSec: DEFAULT_MAX_TIME_SEC,
  });

  console.log(`\n=== ${a} vs ${b} (passive-only, semiIdeal) ===`);
  if (!rust) {
    console.log("  Rust: ineligible or bridge failed. Skipping diff.");
    return;
  }
  const tsBites = biteCount(ts);
  const rustBites = biteCount(rust);
  const rows: Array<[string, string, string, string]> = [
    ["winner", ts.winner, rust.winner, ts.winner !== rust.winner ? "✗" : ""],
    ["ttkAtoB", fmt(ts.ttkAtoB), fmt(rust.ttkAtoB), Math.abs(ts.ttkAtoB - rust.ttkAtoB) > 0.1 ? "✗" : ""],
    ["ttkBtoA", fmt(ts.ttkBtoA), fmt(rust.ttkBtoA), Math.abs(ts.ttkBtoA - rust.ttkBtoA) > 0.1 ? "✗" : ""],
    ["deathA", fmt(ts.deathTimeA), fmt(rust.deathTimeA), ""],
    ["deathB", fmt(ts.deathTimeB), fmt(rust.deathTimeB), ""],
    ["finalHpA", fmt(ts.finalHpA), fmt(rust.finalHpA), Math.abs(ts.finalHpA - rust.finalHpA) > 1 ? "✗" : ""],
    ["finalHpB", fmt(ts.finalHpB), fmt(rust.finalHpB), Math.abs(ts.finalHpB - rust.finalHpB) > 1 ? "✗" : ""],
    ["hpAAtBDeath", fmt(ts.hpAAtBDeath), fmt(rust.hpAAtBDeath), Math.abs(ts.hpAAtBDeath - rust.hpAAtBDeath) > 1 ? "✗" : ""],
    ["hpBAtADeath", fmt(ts.hpBAtADeath), fmt(rust.hpBAtADeath), Math.abs(ts.hpBAtADeath - rust.hpBAtADeath) > 1 ? "✗" : ""],
    ["dmgA_untilB†", fmt(ts.damageDealtA_untilBDeath), fmt(rust.damageDealtA_untilBDeath), Math.abs(ts.damageDealtA_untilBDeath - rust.damageDealtA_untilBDeath) > 1 ? "✗" : ""],
    ["dmgB_untilA†", fmt(ts.damageDealtB_untilADeath), fmt(rust.damageDealtB_untilADeath), Math.abs(ts.damageDealtB_untilADeath - rust.damageDealtB_untilADeath) > 1 ? "✗" : ""],
    ["regenHealedA", fmt(ts.regenHealedA), fmt(rust.regenHealedA), ""],
    ["regenHealedB", fmt(ts.regenHealedB), fmt(rust.regenHealedB), ""],
    ["biteCount A", String(tsBites.A), String(rustBites.A), tsBites.A !== rustBites.A ? "✗" : ""],
    ["biteCount B", String(tsBites.B), String(rustBites.B), tsBites.B !== rustBites.B ? "✗" : ""],
  ];
  console.log(`  field        ts          rust        diff`);
  for (const [k, t, r, d] of rows) {
    console.log(`  ${k.padEnd(13)} ${t.padStart(11)} ${r.padStart(11)} ${d}`);
  }
}

async function main() {
  for (const pair of CASES) {
    try {
      await runCase(pair);
    } catch (err) {
      console.error(`Case ${pair.a} vs ${pair.b} failed:`, err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
