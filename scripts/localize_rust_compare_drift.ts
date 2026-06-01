// Phase 3 step 4 localization tool: binary-search drift root cause.
//
// Usage:
//   npx tsx scripts/localize_rust_compare_drift.ts --a Kendyll --b Korathos
//   npx tsx scripts/localize_rust_compare_drift.ts --a Kendyll --b Korathos --disable-a all --disable-b all
//   npx tsx scripts/localize_rust_compare_drift.ts --a Kendyll --b Korathos --disable-a "Berserk" --event-diff
//
// Layers:
//   Layer 0 (both disabled all): pure engine — bite cadence, HP, regen.
//   Layer 1 (toggle individual abilities): binary-search the triggering passive.
//   Layer 2 (--event-diff): dump first divergent combatLog event + ±5 context.

import { applyRulesAndBuild, simulateFight, type BuildOptions, type SimulationSummary, type CombatLogEntry } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import {
  applyCompareBuffRuntime,
  DEFAULT_COMPARE_BUFF_SELECTION,
} from "../src/engine/compareBuffRuntime";
import { getCompareAppetiteEntry } from "../src/engine/compareAppetiteData";
import { DEFAULT_MAX_TIME_SEC } from "../src/engine/subsystems/timing";
import type { CompareSidePerks } from "../src/optimizer/rustCompareMatchupRuntime";
import { loadRustMatchupBridge } from "../src/optimizer/rustMatchupLoader";
import { trySimulateRustCompareMatchup, getCompareRustIneligibilityReasons } from "../src/optimizer/rustCompareDispatch";

const BUILD: BuildOptions = {
  venerationStage: 5,
  traits: ["Damage", "Weight"],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
  plushies: ["Void", "Void"],
};

type Args = {
  a: string;
  b: string;
  disableA: string[] | "all" | null;
  disableB: string[] | "all" | null;
  eventDiff: boolean;
  context: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const parseDisable = (raw: string | undefined): string[] | "all" | null => {
    if (raw == null) return null;
    if (raw === "all") return "all";
    if (raw.trim() === "") return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  };
  const a = get("--a");
  const b = get("--b");
  if (!a || !b) throw new Error("Missing required --a <Name> --b <Name>");
  return {
    a, b,
    disableA: parseDisable(get("--disable-a")),
    disableB: parseDisable(get("--disable-b")),
    eventDiff: argv.includes("--event-diff"),
    context: Number(get("--context") ?? 5),
  };
}

function requireCreature(name: string) {
  const c = creatureByName[name];
  if (!c) throw new Error(`Missing creature: ${name}`);
  return c;
}

function defaultPerks(name: string): CompareSidePerks {
  return {
    traps: false, trails: false, powerCharge: false, goreCharge: false,
    startingSpiteCharged: false, muddyBuff: false, hungerRule: false, gourmandizer: false,
    startingHungerUnits: 0,
    appetiteBaseUnits: getCompareAppetiteEntry(name)?.appetite ?? 100,
    defiledGroundLevel: 0, defiledGroundWeakness: false,
  };
}

function fmt(v: number | null | undefined, digits = 3): string {
  if (v == null) return "—";
  return v.toFixed(digits);
}

type Built = ReturnType<typeof applyCompareBuffRuntime>;

function buildSides(a: string, b: string): { buffedA: Built; buffedB: Built } {
  const builtA = applyRulesAndBuild(requireCreature(a), BUILD);
  const builtB = applyRulesAndBuild(requireCreature(b), BUILD);
  const buffedA = applyCompareBuffRuntime(builtA, BUILD, DEFAULT_COMPARE_BUFF_SELECTION, "none", "none");
  const buffedB = applyCompareBuffRuntime(builtB, BUILD, DEFAULT_COMPARE_BUFF_SELECTION, "none", "none");
  return { buffedA, buffedB };
}

function runTs(a: string, b: string, disabledA: string[], disabledB: string[]): SimulationSummary {
  const { buffedA, buffedB } = buildSides(a, b);
  return simulateFight(buffedA.finalStats, buffedB.finalStats, {
    activesOn: false,
    breathOn: false,
    maxTimeSec: DEFAULT_MAX_TIME_SEC,
    enableCombatLog: true,
    disabledAbilitiesA: disabledA,
    disabledAbilitiesB: disabledB,
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
    compareTrapsA: false, compareTrapsB: false,
    compareTrailsA: false, compareTrailsB: false,
    comparePowerChargeA: false, comparePowerChargeB: false,
    compareGoreChargeA: false, compareGoreChargeB: false,
    compareStartingSpiteChargedA: false, compareStartingSpiteChargedB: false,
    compareHungerRuleA: false, compareHungerRuleB: false,
    compareGourmandizerA: false, compareGourmandizerB: false,
    compareDefiledGroundLevelA: 0, compareDefiledGroundLevelB: 0,
    compareStartingHungerA: 0, compareStartingHungerB: 0,
    compareAppetiteBaseA: getCompareAppetiteEntry(a)?.appetite ?? 100,
    compareAppetiteBaseB: getCompareAppetiteEntry(b)?.appetite ?? 100,
  });
}

async function runRust(a: string, b: string, disabledA: string[], disabledB: string[]): Promise<SimulationSummary | null> {
  const source = requireCreature(a);
  const opponent = requireCreature(b);
  const { buffedA, buffedB } = buildSides(a, b);
  return await trySimulateRustCompareMatchup({
    sourceCreature: source, opponentCreature: opponent,
    finalA: buffedA.finalStats, finalB: buffedB.finalStats,
    activesOn: false, breathOn: false,
    abilityPolicy: "semiIdeal",
    initialStatusesA: buffedA.initialStatuses,
    initialStatusesB: buffedB.initialStatuses,
    activeCooldownMultiplierA: buffedA.activeCooldownMultiplier,
    activeCooldownMultiplierB: buffedB.activeCooldownMultiplier,
    disabledAbilitiesA: disabledA,
    disabledAbilitiesB: disabledB,
    perksA: defaultPerks(a), perksB: defaultPerks(b),
    firstTick: { mode: "off", delaySec: 1.0 },
    noMoveFacetank: true,
    compareAirRuleEnabled: false,
    compareSecondaryAttackOnlyA: false, compareSecondaryAttackOnlyB: false,
    badOmenOutcome: null,
    maxTimeSec: DEFAULT_MAX_TIME_SEC,
  });
}

function resolveDisable(raw: string[] | "all" | null, discoveredPresent: string[]): string[] {
  if (raw === "all") return discoveredPresent;
  if (raw == null) return [];
  return raw;
}

type EventKey = Pick<CombatLogEntry, "time" | "type" | "attacker" | "damage" | "hpSide" | "hpAfter">;

function eventsEqual(a: CombatLogEntry, b: CombatLogEntry): boolean {
  if (Math.abs(a.time - b.time) > 0.01) return false;
  if (a.type !== b.type) return false;
  if (a.attacker !== b.attacker) return false;
  if (a.hpSide !== b.hpSide) return false;
  if (Math.abs(a.damage - b.damage) > 0.5) return false;
  if (Math.abs(a.hpAfter - b.hpAfter) > 0.5) return false;
  return true;
}

function formatEvent(e: CombatLogEntry | undefined): string {
  if (!e) return "(none)";
  const sid = e.statusId ? ` status=${e.statusId}` : "";
  return `t=${e.time.toFixed(3)} ${e.type} by ${e.attacker} dmg=${e.damage.toFixed(2)} → hp${e.hpSide}=${e.hpAfter.toFixed(2)}${sid}`;
}

function printEventDiff(tsLog: CombatLogEntry[], rustLog: CombatLogEntry[], context: number): void {
  const max = Math.max(tsLog.length, rustLog.length);
  let firstDivergence = -1;
  for (let i = 0; i < max; i++) {
    const ts = tsLog[i];
    const rs = rustLog[i];
    if (!ts || !rs || !eventsEqual(ts, rs)) {
      firstDivergence = i;
      break;
    }
  }
  if (firstDivergence < 0) {
    console.log("  combatLog: no divergence within shared prefix.");
    return;
  }
  console.log(`\n  FIRST DIVERGENCE at index ${firstDivergence}:`);
  const lo = Math.max(0, firstDivergence - context);
  const hi = Math.min(max, firstDivergence + context + 1);
  console.log(`  idx  TS                                              Rust`);
  for (let i = lo; i < hi; i++) {
    const mark = i === firstDivergence ? "▶" : " ";
    const ts = formatEvent(tsLog[i]);
    const rs = formatEvent(rustLog[i]);
    console.log(`  ${mark}${String(i).padStart(3)}  ${ts.padEnd(46)}  ${rs}`);
  }
}

async function main() {
  const args = parseArgs();

  // Discovery pass: need ability names for "all" resolution. Run TS once with nothing disabled.
  const discoveryTs = runTs(args.a, args.b, [], []);
  const presentA = discoveryTs.debug?.A.abilitiesPresent ?? [];
  const presentB = discoveryTs.debug?.B.abilitiesPresent ?? [];
  const disabledA = resolveDisable(args.disableA, presentA);
  const disabledB = resolveDisable(args.disableB, presentB);

  console.log(`=== ${args.a} vs ${args.b} (passive-only, semiIdeal) ===`);
  console.log(`  presentA: [${presentA.join(", ")}]`);
  console.log(`  presentB: [${presentB.join(", ")}]`);
  console.log(`  disabledA: [${disabledA.join(", ") || "—"}]`);
  console.log(`  disabledB: [${disabledB.join(", ") || "—"}]`);

  await loadRustMatchupBridge();
  const reasons = getCompareRustIneligibilityReasons({
    sourceCreature: requireCreature(args.a),
    opponentCreature: requireCreature(args.b),
    abilityPolicy: "semiIdeal",
    compareAirRuleEnabled: false,
    compareSecondaryAttackOnlyA: false,
    compareSecondaryAttackOnlyB: false,
    badOmenOutcome: null,
  });
  console.log(`  ineligibility: [${reasons.join(", ") || "none"}]`);

  const [ts, rust] = await Promise.all([
    Promise.resolve(runTs(args.a, args.b, disabledA, disabledB)),
    runRust(args.a, args.b, disabledA, disabledB),
  ]);

  if (!rust) {
    console.log("  Rust: ineligible or bridge failed.");
    return;
  }

  const rows: Array<[string, string, string, string]> = [
    ["winner", ts.winner, rust.winner, ts.winner !== rust.winner ? "✗" : ""],
    ["ttkAtoB", fmt(ts.ttkAtoB), fmt(rust.ttkAtoB), Math.abs(ts.ttkAtoB - rust.ttkAtoB) > 0.1 ? "✗" : ""],
    ["ttkBtoA", fmt(ts.ttkBtoA), fmt(rust.ttkBtoA), Math.abs(ts.ttkBtoA - rust.ttkBtoA) > 0.1 ? "✗" : ""],
    ["deathA", fmt(ts.deathTimeA), fmt(rust.deathTimeA), ""],
    ["deathB", fmt(ts.deathTimeB), fmt(rust.deathTimeB), ""],
    ["finalHpA", fmt(ts.finalHpA), fmt(rust.finalHpA), Math.abs(ts.finalHpA - rust.finalHpA) > 1 ? "✗" : ""],
    ["finalHpB", fmt(ts.finalHpB), fmt(rust.finalHpB), Math.abs(ts.finalHpB - rust.finalHpB) > 1 ? "✗" : ""],
    ["hpBAtADeath", fmt(ts.hpBAtADeath), fmt(rust.hpBAtADeath), Math.abs(ts.hpBAtADeath - rust.hpBAtADeath) > 1 ? "✗" : ""],
    ["hpAAtBDeath", fmt(ts.hpAAtBDeath), fmt(rust.hpAAtBDeath), Math.abs(ts.hpAAtBDeath - rust.hpAAtBDeath) > 1 ? "✗" : ""],
    ["dmgA_untilB†", fmt(ts.damageDealtA_untilBDeath), fmt(rust.damageDealtA_untilBDeath), Math.abs(ts.damageDealtA_untilBDeath - rust.damageDealtA_untilBDeath) > 1 ? "✗" : ""],
    ["dmgB_untilA†", fmt(ts.damageDealtB_untilADeath), fmt(rust.damageDealtB_untilADeath), Math.abs(ts.damageDealtB_untilADeath - rust.damageDealtB_untilADeath) > 1 ? "✗" : ""],
    ["regenHealedA", fmt(ts.regenHealedA), fmt(rust.regenHealedA), Math.abs(ts.regenHealedA - rust.regenHealedA) > 1 ? "✗" : ""],
    ["regenHealedB", fmt(ts.regenHealedB), fmt(rust.regenHealedB), Math.abs(ts.regenHealedB - rust.regenHealedB) > 1 ? "✗" : ""],
    ["combatLog#", String(ts.combatLog?.length ?? 0), String(rust.combatLog?.length ?? 0), ""],
  ];
  console.log(`  field        ts          rust        diff`);
  for (const [k, t, r, d] of rows) {
    console.log(`  ${k.padEnd(13)} ${t.padStart(11)} ${r.padStart(11)} ${d}`);
  }

  if (args.eventDiff) {
    printEventDiff(ts.combatLog ?? [], rust.combatLog ?? [], args.context);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
