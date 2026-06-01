// Phase 3 step 4 per-ability validation sweep.
//
// For each ability present in the creature roster, pick a carrier, build a
// self-vs-self matchup with that single ability enabled on side A and all
// abilities disabled on side B. Run both TS simulateFight and Rust
// trySimulateRustCompareMatchup and report any drift.
//
// Usage:
//   node --experimental-wasm-modules --import tsx scripts/sweep_rust_compare_per_ability.ts
//   node --experimental-wasm-modules --import tsx scripts/sweep_rust_compare_per_ability.ts --only "Berserk,Reflect"
//   node --experimental-wasm-modules --import tsx scripts/sweep_rust_compare_per_ability.ts --verbose

import { applyRulesAndBuild, simulateFight, type BuildOptions, type SimulationSummary } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import {
  applyCompareBuffRuntime,
  DEFAULT_COMPARE_BUFF_SELECTION,
} from "../src/engine/compareBuffRuntime";
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

type Args = { only: string[] | null; verbose: boolean };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const onlyRaw = get("--only");
  const only = onlyRaw ? onlyRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;
  return { only, verbose: argv.includes("--verbose") };
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

type Built = ReturnType<typeof applyCompareBuffRuntime>;

function build(name: string): Built {
  const runtime = creatureByName[name];
  if (!runtime) throw new Error(`Missing creature: ${name}`);
  const built = applyRulesAndBuild(runtime, BUILD);
  return applyCompareBuffRuntime(built, BUILD, DEFAULT_COMPARE_BUFF_SELECTION, "none", "none");
}

function runTs(a: string, b: string, disabledA: string[], disabledB: string[]): SimulationSummary {
  const buffedA = build(a);
  const buffedB = build(b);
  return simulateFight(buffedA.finalStats, buffedB.finalStats, {
    activesOn: false, breathOn: false,
    maxTimeSec: DEFAULT_MAX_TIME_SEC,
    enableCombatLog: true,
    disabledAbilitiesA: disabledA, disabledAbilitiesB: disabledB,
    initialStatusesA: buffedA.initialStatuses, initialStatusesB: buffedB.initialStatuses,
    activeCooldownMultiplierA: buffedA.activeCooldownMultiplier,
    activeCooldownMultiplierB: buffedB.activeCooldownMultiplier,
    badOmenOutcome: null, abilityPolicy: "semiIdeal",
    compareSecondaryAttackOnlyA: false, compareSecondaryAttackOnlyB: false,
    compareAirRuleEnabled: false, compareAirRuleCooldownSec: 0,
    compareNoMoveFacetank: true,
    compareFirstTickMode: "off", compareFirstTickDelaySec: 1.0,
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

async function runRust(
  a: string, b: string, disabledA: string[], disabledB: string[],
): Promise<SimulationSummary | null> {
  const src = creatureByName[a]!;
  const opp = creatureByName[b]!;
  const buffedA = build(a);
  const buffedB = build(b);
  return await trySimulateRustCompareMatchup({
    sourceCreature: src, opponentCreature: opp,
    finalA: buffedA.finalStats, finalB: buffedB.finalStats,
    activesOn: false, breathOn: false,
    abilityPolicy: "semiIdeal",
    initialStatusesA: buffedA.initialStatuses, initialStatusesB: buffedB.initialStatuses,
    activeCooldownMultiplierA: buffedA.activeCooldownMultiplier,
    activeCooldownMultiplierB: buffedB.activeCooldownMultiplier,
    disabledAbilitiesA: disabledA, disabledAbilitiesB: disabledB,
    perksA: defaultPerks(a), perksB: defaultPerks(b),
    firstTick: { mode: "off", delaySec: 1.0 },
    noMoveFacetank: true,
    compareAirRuleEnabled: false,
    compareSecondaryAttackOnlyA: false, compareSecondaryAttackOnlyB: false,
    badOmenOutcome: null, maxTimeSec: DEFAULT_MAX_TIME_SEC,
  });
}

type Drift = {
  field: string;
  ts: number | string;
  rust: number | string;
  diff: number | string;
};

function diffRow(field: string, ts: number, rust: number, tol: number): Drift | null {
  if (Math.abs(ts - rust) <= tol) return null;
  return { field, ts: ts.toFixed(3), rust: rust.toFixed(3), diff: (ts - rust).toFixed(3) };
}

// Tolerances rationale:
//   - ttk / finalHp / dmg_until / regen: strict (1) — these define outcome.
//   - hp{A,B}At{B,A}Death: 50 — snapshot at one-side-death is sensitive to
//     tick-ordering of same-timestamp events (dot vs ability vs bite). Reference
//     does not define intra-timestamp order; TS and Rust legitimately disagree.
//   - combatLog#: not checked — log verbosity differs between engines; gameplay
//     parity is captured by the numeric metrics above.
function collectDrift(ts: SimulationSummary, rust: SimulationSummary): Drift[] {
  const out: Drift[] = [];
  if (ts.winner !== rust.winner) out.push({ field: "winner", ts: ts.winner, rust: rust.winner, diff: "" });
  const push = (d: Drift | null) => { if (d) out.push(d); };
  push(diffRow("ttkAtoB", ts.ttkAtoB, rust.ttkAtoB, 0.1));
  push(diffRow("ttkBtoA", ts.ttkBtoA, rust.ttkBtoA, 0.1));
  push(diffRow("finalHpA", ts.finalHpA, rust.finalHpA, 1));
  push(diffRow("finalHpB", ts.finalHpB, rust.finalHpB, 1));
  push(diffRow("hpBAtADeath", ts.hpBAtADeath, rust.hpBAtADeath, 50));
  push(diffRow("hpAAtBDeath", ts.hpAAtBDeath, rust.hpAAtBDeath, 50));
  push(diffRow("dmgA_untilB†", ts.damageDealtA_untilBDeath, rust.damageDealtA_untilBDeath, 1));
  push(diffRow("dmgB_untilA†", ts.damageDealtB_untilADeath, rust.damageDealtB_untilADeath, 1));
  push(diffRow("regenHealedA", ts.regenHealedA, rust.regenHealedA, 1));
  push(diffRow("regenHealedB", ts.regenHealedB, rust.regenHealedB, 1));
  return out;
}

/**
 * Discover every ability present on any creature in the roster by running a
 * one-shot TS sim per creature (vs itself with nothing disabled) and reading
 * `debug.A.abilitiesPresent`. Returns map ability → first carrier found.
 */
function discoverAbilities(): Map<string, string> {
  const abilityToCarrier = new Map<string, string>();
  const names = Object.keys(creatureByName);
  for (const name of names) {
    let present: string[] = [];
    try {
      const summary = runTs(name, name, [], []);
      present = summary.debug?.A.abilitiesPresent ?? [];
    } catch {
      continue;
    }
    for (const ability of present) {
      if (!abilityToCarrier.has(ability)) {
        abilityToCarrier.set(ability, name);
      }
    }
  }
  return abilityToCarrier;
}

async function main() {
  const args = parseArgs();

  console.log("Discovering abilities across creature roster…");
  const abilityToCarrier = discoverAbilities();
  const allAbilities = [...abilityToCarrier.keys()].sort();
  const abilities = args.only
    ? allAbilities.filter((a) => args.only!.includes(a))
    : allAbilities;
  console.log(`  Found ${allAbilities.length} unique abilities; testing ${abilities.length}.\n`);

  await loadRustMatchupBridge();

  const driftByAbility = new Map<string, Drift[]>();
  const skipped: Array<{ ability: string; reason: string }> = [];
  let passCount = 0;

  for (const ability of abilities) {
    const carrier = abilityToCarrier.get(ability)!;
    // Self-vs-self: A has only `ability` enabled; B has everything disabled.
    const presentOnCarrier = (runTs(carrier, carrier, [], []).debug?.A.abilitiesPresent) ?? [];
    const disabledA = presentOnCarrier.filter((a) => a !== ability);
    const disabledB = presentOnCarrier;

    const ts = runTs(carrier, carrier, disabledA, disabledB);
    const rust = await runRust(carrier, carrier, disabledA, disabledB);
    if (!rust) {
      skipped.push({ ability, reason: "rust ineligible" });
      continue;
    }

    const drift = collectDrift(ts, rust);
    if (drift.length === 0) {
      passCount++;
      if (args.verbose) console.log(`  ✓ ${ability.padEnd(28)} (carrier=${carrier})`);
    } else {
      driftByAbility.set(ability, drift);
      console.log(`  ✗ ${ability.padEnd(28)} (carrier=${carrier})`);
      for (const d of drift) {
        console.log(`      ${d.field.padEnd(14)} ts=${String(d.ts).padStart(11)} rust=${String(d.rust).padStart(11)} Δ=${d.diff}`);
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  tested:  ${abilities.length}`);
  console.log(`  passed:  ${passCount}`);
  console.log(`  drift:   ${driftByAbility.size}`);
  console.log(`  skipped: ${skipped.length}`);
  if (driftByAbility.size > 0) {
    console.log(`\n  drift abilities: ${[...driftByAbility.keys()].join(", ")}`);
  }
  if (skipped.length > 0) {
    console.log(`\n  skipped:`);
    for (const s of skipped) console.log(`    ${s.ability} — ${s.reason}`);
  }

  process.exit(driftByAbility.size > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
