/// <reference types="node" />
// Real-Compare posture-policy benchmark (ignored by default — long-running).
//
// Goal: measure how close the Rust engine's posture policy gets to the
// MATH IDEAL for a given matchup in REAL Compare UI conditions.
//
// Why TS / vitest, not Rust posture_benchmark.rs:
//   The Rust benchmark uses simplified `SimpleCombatantStats` setups
//   (just health/damage/bite_cooldown) and only wires Cause Fear +
//   Cursed Sigil. Real Compare wires 100+ fields via
//   `toRustComposableArgsFromCompare` (passives like Corrosion Attack
//   / Injury Attack, status_resist_fractions, on_hit_taken_statuses
//   for Defensive Bleed, etc.). Hand-mirroring all that on the Rust
//   side would be ENDLESS TAIL-CHASING — every new ability or perk
//   would need its mirror updated. Using the real TS bridge ensures
//   the test config IS the Compare UI config — single source of truth
//   per the policy_engine_pillars "no two paths" rule.
//
// Why the file-scoped `/// <reference types="node" />`:
//   `tsconfig.app.json` excludes node types (Compare runs in the browser),
//   so `import("node:fs")` and friends would otherwise fail typecheck.
//   The reference adds node types only for this file. Vitest runs the
//   file in Node, so the runtime imports resolve normally.
//
// Run: `npx vitest run posturePolicyRealCompareBeam --reporter=verbose`
// (default exclusion via `it.skip` keeps it out of the normal suite —
// it takes ~30-60 s.)

import { describe, expect, it } from "vitest";
import { applyRulesAndBuild, type CreatureRuntime } from "../engine";
import { creatureByName } from "../engine/creatureData";
import {
  toRustComposableArgsFromCompare,
  type CompareSidePerks,
  type PosturePolicyMode,
} from "./rustCompareMatchupRuntime";
import { stripNullsForWasm } from "./rustMatchupLoader";

// Avoid `loadRustMatchupBridge` — it imports the wasm-pack glue `.js`
// which uses `import * as wasm from "./...wasm"`. That works under
// vite (browser bundle) but blows up in vitest's Node SSR runner
// (`vite-plugin-wasm` injects a helper path Node can't resolve).
// Manual loader below bypasses the wrapper via fs + `__wbg_set_wasm`.
//
// MUST be memoized across `it()` cases. The dynamic `import(bgJsPath)`
// is module-cached by Node, so subsequent calls return the SAME `bg`
// object — but `bg` holds a module-level
// `cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer)` that
// is created lazily on first use. If we instantiate a fresh WASM
// module per `it()` and only call `__wbg_set_wasm(new_instance)`, the
// new instance has DIFFERENT memory, but `cachedUint8ArrayMemory0`
// still points at the FIRST instance's memory. All subsequent reads
// then return bytes from the wrong WASM heap — manifests as JS-side
// `TypeError: encoded data was not valid for encoding utf-8` from
// `getStringFromWasm0` when (ptr, len) returned by the new module
// reaches into garbage in the stale view. Sharing one instance across
// tests sidesteps that — the bg.js cache stays consistent.
let cachedBg: {
  simulate_composable_matchup_js: (...args: unknown[]) => unknown;
  simulate_composable_matchup_with_posture_script_js: (...args: unknown[]) => unknown;
  simulate_composable_matchup_with_bite_variant_script_js: (...args: unknown[]) => unknown;
} | null = null;
async function loadRustForNode(): Promise<{
  simulate_composable_matchup_js: (...args: unknown[]) => unknown;
  simulate_composable_matchup_with_posture_script_js: (...args: unknown[]) => unknown;
  simulate_composable_matchup_with_bite_variant_script_js: (...args: unknown[]) => unknown;
}> {
  if (cachedBg) return cachedBg;
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const wasmPath = path.resolve(here, "../rust-pkg/cos_calc_wasm_engine_bg.wasm");
  const bgJsPath = "../rust-pkg/cos_calc_wasm_engine_bg.js";
   
  const bg = (await import(bgJsPath)) as any;
  const bytes = readFileSync(wasmPath);
  const wasmModule = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(wasmModule, { "./cos_calc_wasm_engine_bg.js": bg });
  bg.__wbg_set_wasm(instance.exports);
  (instance.exports as { __wbindgen_start?: () => void }).__wbindgen_start?.();
  cachedBg = bg as never;
  return cachedBg!;
}

function creature(name: string): CreatureRuntime {
  const runtime = creatureByName[name];
  if (!runtime) throw new Error(`Missing creature fixture: ${name}`);
  return {
    ...runtime,
    passiveAbilities: [...(runtime.passiveAbilities ?? [])],
    activatedAbilities: [...(runtime.activatedAbilities ?? [])],
    breathAbilities: [...(runtime.breathAbilities ?? [])],
  };
}

function finalStats(name: string) {
  // No traits / no ascension / no plushies — closest to "raw creature
  // entering Compare with default form-build settings".
  return applyRulesAndBuild(creature(name), {
    venerationStage: 5,
    traits: [],
    ascensionAssignments: [],
    plushies: [],
  });
}

const defaultPerks: CompareSidePerks = {
  traps: false,
  trails: false,
  powerCharge: false,
  goreCharge: false,
  startingSpiteCharged: false,
  muddyBuff: false,
  hungerRule: false,
  gourmandizer: false,
  startingHungerUnits: 100,
  appetiteBaseUnits: 100,
  defiledGroundLevel: 0,
  defiledGroundWeakness: false,
  appetiteDrainMultiplier: 1,
  healingPulseEnabled: false,
  healingPulseOnce: false,
  expungeEnabled: false,
  wardenRageStartHpPct: 0,
};

const COMPARE_MAX_TIME_SEC = 900;

type PostureScriptAction = "stay" | "startSit" | "startLay" | "standUp";
type PostureScriptEntry = [number, PostureScriptAction];

interface SimRunResult {
  deathTimeA: number | null;
  deathTimeB: number | null;
  hpAAtBDeath: number;
  hpBAtADeath: number;
  finalHpA: number;
  finalHpB: number;
}

function buildCompareArgs(opts: {
  attackerName: string;
  defenderName: string;
  posturePolicyB: PosturePolicyMode;
}) {
  const sourceCreature = creature(opts.attackerName);
  const opponentCreature = creature(opts.defenderName);
  const finalA = finalStats(opts.attackerName);
  const finalB = finalStats(opts.defenderName);
  return toRustComposableArgsFromCompare({
    sourceCreature,
    opponentCreature,
    finalA,
    finalB,
    activesOn: true,
    breathOn: true,
    abilityPolicy: "ideal",
    initialStatusesA: [],
    initialStatusesB: [],
    activeCooldownMultiplierA: 1,
    activeCooldownMultiplierB: 1,
    disabledAbilitiesA: [],
    disabledAbilitiesB: [],
    perksA: defaultPerks,
    perksB: defaultPerks,
    firstTick: { mode: "off", delaySec: 1 },
    noMoveFacetank: true,
    badOmenOutcome: null,
    compareAirRuleEnabled: false,
    compareAirRuleCooldownSec: 0,
    compareBiteVariantModeA: "primaryOnly",
    compareBiteVariantModeB: "primaryOnly",
    posturePolicyA: "off",
    posturePolicyB: opts.posturePolicyB,
  });
}

function bFitness(r: SimRunResult): number {
  // Mirrors Rust `posture_benchmark::compute_fitness` from B's view —
  // both-dead case rewards outliving opp by death timestamp.
  //
  // Normalize `undefined` → `null`: the WASM bridge returns
  // `deathTimeA/B` as `undefined` when the side is alive, but the
  // original branches all checked `=== null`. Without normalization
  // the "both alive" / "only one dead" branches fell through to the
  // both-dead branch and produced NaN-driven garbage fitness (e.g.
  // returning 0 for a "me-dead, opp-alive" trajectory that should
  // score −hp_a@b_death). Discovered 2026-05-22 via the Kendyll vs
  // Goreganthus diagnostic.
  const meDeath = r.deathTimeB ?? null;
  const opDeath = r.deathTimeA ?? null;
  if (meDeath === null && opDeath === null) {
    return Math.max(r.finalHpB, 0);
  }
  if (meDeath === null && opDeath !== null) {
    return Math.max(r.finalHpB, 0) + 1;
  }
  if (meDeath !== null && opDeath === null) {
    return -Math.max(r.hpAAtBDeath, 0);
  }
  // Both dead — outlive duration in seconds + base.
  if (meDeath! > opDeath! + 1e-9) {
    return (meDeath! - opDeath!) + 1;
  } else if (opDeath! > meDeath! + 1e-9) {
    return -Math.max(r.hpAAtBDeath, 0);
  }
  return 0;
}

function fmtAction(a: PostureScriptAction): string {
  return a;
}

describe("posture policy vs math ideal at real Compare conditions", () => {
  // Marked .skip to keep out of normal CI runs. Remove `.skip` to run
  // the diagnostic locally.
  it("Opra vs Gimon — both regen-aware and regen-unaware: off / policy / beam-ideal", async () => {
    const rustMod = await loadRustForNode();
    const simBasic = rustMod.simulate_composable_matchup_js as (
      attacker: unknown, defender: unknown,
      attackerBreath: unknown, defenderBreath: unknown,
      abilityPolicy: unknown, abilityConfig: unknown,
      maxTimeSec: number,
      recordTrace?: boolean,
    ) => SimRunResult;
    const simWithScript = rustMod.simulate_composable_matchup_with_posture_script_js as (
      attacker: unknown, defender: unknown,
      attackerBreath: unknown, defenderBreath: unknown,
      abilityPolicy: unknown, abilityConfig: unknown,
      maxTimeSec: number,
      postureScript: PostureScriptEntry[],
      selfIsAttacker: boolean,
    ) => SimRunResult;

    function runWithScript(
      args: ReturnType<typeof buildCompareArgs>,
      script: PostureScriptEntry[],
    ): SimRunResult {
      return simWithScript(
        stripNullsForWasm(args.attacker), stripNullsForWasm(args.defender),
        stripNullsForWasm(args.attackerBreath ?? undefined),
        stripNullsForWasm(args.defenderBreath ?? undefined),
        args.abilityPolicy, stripNullsForWasm(args.abilityConfig),
        COMPARE_MAX_TIME_SEC,
        script,
        false, // self_is_attacker — B (defender = Gimon)
      ) as SimRunResult;
    }

    // Precompute decision moments shared across all modes.
    const decisionTimes: number[] = [];
    for (let t = 0; t <= 90; t += 5) decisionTimes.push(t);
    for (let tick = 15; tick <= 90; tick += 15) {
      decisionTimes.push(tick - 2);
      decisionTimes.push(tick + 0.001);
    }
    decisionTimes.sort((a, b) => a - b);
    const decisions: number[] = [];
    for (const t of decisionTimes) {
      if (decisions.length === 0 || Math.abs(decisions[decisions.length - 1] - t) > 0.01) {
        decisions.push(t);
      }
    }
    const candidates: PostureScriptAction[] = ["stay", "startSit", "startLay", "standUp"];

    function runBasic(args: ReturnType<typeof buildCompareArgs>): SimRunResult {
      return simBasic(
        stripNullsForWasm(args.attacker), stripNullsForWasm(args.defender),
        stripNullsForWasm(args.attackerBreath ?? undefined),
        stripNullsForWasm(args.defenderBreath ?? undefined),
        args.abilityPolicy, stripNullsForWasm(args.abilityConfig),
        COMPARE_MAX_TIME_SEC,
        false,
      ) as SimRunResult;
    }

    function fmtRun(label: string, r: SimRunResult): string {
      return `[${label}] a_death=${r.deathTimeA?.toFixed(1) ?? "alive"} b_death=${r.deathTimeB?.toFixed(1) ?? "alive"} ` +
        `hp_a@b_death=${r.hpAAtBDeath.toFixed(0)} hp_b@a_death=${r.hpBAtADeath.toFixed(0)} ` +
        `final_a=${r.finalHpA.toFixed(0)} final_b=${r.finalHpB.toFixed(0)} ` +
        `b_fit=${bFitness(r).toFixed(1)}`;
    }

    // Search both regen-aware and regen-unaware policy modes.
    for (const mode of ["regenAware", "regenUnaware"] as const) {
      console.log(`\n=== Posture policy mode: ${mode} ===`);

      const argsOff = buildCompareArgs({
        attackerName: "Opralegion", defenderName: "Gimon-Ogu",
        posturePolicyB: "off",
      });
      const rOff = runBasic(argsOff);
      console.log(fmtRun(`OFF                  `, rOff));

      const argsPolicy = buildCompareArgs({
        attackerName: "Opralegion", defenderName: "Gimon-Ogu",
        posturePolicyB: mode,
      });
      const rPolicy = runBasic(argsPolicy);
      console.log(fmtRun(`POLICY ${mode.padEnd(13)} `, rPolicy));

      // Two complementary approximations of the math-ideal, then
      // report ideal = max(approximations, policy) so the displayed
      // ideal is ≥ policy by construction (a TRUE ideal cannot be
      // worse than any achievable trajectory).
      //
      // Approximation 1: ROLLING-GREEDY with depth-D lookahead.
      //   Iterates over decision moments; at each, evaluates 4^D
      //   continuation prefixes and commits the immediate action of
      //   the best one. Strong for short-range tactical optimization;
      //   small D under-explores long-range setup.
      //
      // Approximation 2: BEAM SEARCH width K, no lookahead.
      //   Keeps K best partial scripts; at each step extends each by
      //   one of 4 actions, scores by full-fight sim, keeps top K.
      //   Captures global structure beam-greedy can't keep (a worse
      //   step at i that leads to optimum at j > i+D survives), but
      //   needs wide K to avoid the "early actions look near-equal
      //   under truncated-script sim" trap.
      //
      // Neither approximation includes the policy's 13 curated
      // closures — they evaluate pure (or near-pure) action search.
      // If policy > both, that gap is the curated-plan contribution
      // and the displayed ideal pulls up to policy (max).

      // --- Rolling-greedy depth-4 lookahead ---
      const lookaheadDepth = 4;
      const tGreedy = Date.now();
      const decidedScript: PostureScriptEntry[] = [];
      function exploreFromIdx(
        idx: number,
        depthRemaining: number,
        prefix: PostureScriptEntry[],
      ): number {
        if (depthRemaining === 0 || idx >= decisions.length) {
          const trial = [...decidedScript, ...prefix];
          return bFitness(runWithScript(argsOff, trial));
        }
        let best = -Infinity;
        const t = decisions[idx];
        for (const action of candidates) {
          const newPrefix: PostureScriptEntry[] = [...prefix, [t, action]];
          const fit = exploreFromIdx(idx + 1, depthRemaining - 1, newPrefix);
          if (fit > best) best = fit;
        }
        return best;
      }
      for (let i = 0; i < decisions.length; i++) {
        const t = decisions[i];
        let bestFit = -Infinity;
        let bestAction: PostureScriptAction = "stay";
        for (const action of candidates) {
          const prefix: PostureScriptEntry[] = [[t, action]];
          const fit = exploreFromIdx(i + 1, lookaheadDepth - 1, prefix);
          if (fit > bestFit) {
            bestFit = fit;
            bestAction = action;
          }
        }
        decidedScript.push([t, bestAction]);
      }
      const greedyFit = bFitness(runWithScript(argsOff, decidedScript));
      const greedyElapsed = (Date.now() - tGreedy) / 1000;
      const greedyNonStay = decidedScript.filter(([, a]) => a !== "stay");
      console.log(
        `[GREEDY  d=${lookaheadDepth} ] fitness=${greedyFit.toFixed(1)} ` +
        `elapsed=${greedyElapsed.toFixed(1)}s ` +
        `non-stay-actions=${greedyNonStay.length ? greedyNonStay.map(([t, a]) => `${fmtAction(a)}@${t}`).join(" ") : "(none)"}`,
      );

      // --- Beam search width K ---
      const beamWidth = 16;
      const tBeam = Date.now();
      type Beam = { script: PostureScriptEntry[]; fitness: number };
      let beams: Beam[] = [{ script: [], fitness: -Infinity }];
      for (let i = 0; i < decisions.length; i++) {
        const t = decisions[i];
        const expanded: Beam[] = [];
        for (const beam of beams) {
          for (const action of candidates) {
            const newScript: PostureScriptEntry[] = [...beam.script, [t, action]];
            const fit = bFitness(runWithScript(argsOff, newScript));
            expanded.push({ script: newScript, fitness: fit });
          }
        }
        expanded.sort((a, b) => b.fitness - a.fitness);
        beams = expanded.slice(0, beamWidth);
      }
      const beamFit = beams[0].fitness;
      const beamElapsed = (Date.now() - tBeam) / 1000;
      const beamNonStay = beams[0].script.filter(([, a]) => a !== "stay");
      console.log(
        `[BEAM    K=${beamWidth} ] fitness=${beamFit.toFixed(1)} ` +
        `elapsed=${beamElapsed.toFixed(1)}s ` +
        `non-stay-actions=${beamNonStay.length ? beamNonStay.map(([t, a]) => `${fmtAction(a)}@${t}`).join(" ") : "(none)"}`,
      );

      // --- Honest ideal = max over all approximations + policy ---
      const offFit = bFitness(rOff);
      const policyFit = bFitness(rPolicy);
      const idealFit = Math.max(greedyFit, beamFit, policyFit);
      const policyGain = policyFit - offFit;
      const idealGain = idealFit - offFit;
      const captureIdeal = Math.abs(idealGain) < 1e-9
        ? 100
        : (100 * policyGain) / idealGain;
      console.log(
        `[IDEAL = MAX         ] fitness=${idealFit.toFixed(1)} ` +
        `(greedy=${greedyFit.toFixed(1)}, beam=${beamFit.toFixed(1)}, ` +
        `policy=${policyFit.toFixed(1)})`,
      );
      console.log(
        `[CAPTURE              ] policy captures ${captureIdeal.toFixed(1)}% of ideal's gain over off ` +
        `(off=${offFit.toFixed(1)}, policy=${policyFit.toFixed(1)}, ideal=${idealFit.toFixed(1)})`,
      );

      // Diagnostic: when greedy / beam beat policy, surface the gap so
      // the next iteration knows what curated-plan or search-depth
      // bump is left on the table.
      if (greedyFit > policyFit + 1e-6) {
        console.warn(
          `Greedy d=${lookaheadDepth} (${greedyFit.toFixed(1)}) BEATS policy ` +
          `(${policyFit.toFixed(1)}) by ${(greedyFit - policyFit).toFixed(1)} ` +
          `— headroom for the stance decision exists in pure D-step lookahead space.`,
        );
      }
      if (beamFit > policyFit + 1e-6) {
        console.warn(
          `Beam K=${beamWidth} (${beamFit.toFixed(1)}) BEATS policy ` +
          `(${policyFit.toFixed(1)}) by ${(beamFit - policyFit).toFixed(1)} ` +
          `— headroom exists in pure beam-search space.`,
        );
      }

      expect(policyFit).toBeGreaterThanOrEqual(offFit - 50);
      // Ideal ≥ policy by construction (it's max of everything).
      expect(idealFit + 1e-6).toBeGreaterThanOrEqual(policyFit);
    }
  }, 1_200_000);

  // Diagnostic verification: user claim "optimal Kendyll behavior vs
  // Goreganthus is always-stand, under any policy". Runs the same
  // OFF / POLICY / GREEDY pipeline as the Opra/Gimon test but only
  // for Kendyll as the defender (B). If greedy d=4 produces a
  // trajectory with non-stay actions AND those actions improve
  // fitness over OFF, the claim is wrong. If greedy commits only
  // Stay (or non-stay actions don't improve over OFF), the claim is
  // supported.
  it("Kendyll vs Goreganthus — verify always-stand claim", async () => {
    const rustMod = await loadRustForNode();
    const simBasic = rustMod.simulate_composable_matchup_js as (
      attacker: unknown, defender: unknown,
      attackerBreath: unknown, defenderBreath: unknown,
      abilityPolicy: unknown, abilityConfig: unknown,
      maxTimeSec: number,
      recordTrace?: boolean,
    ) => SimRunResult;
    const simWithScript = rustMod.simulate_composable_matchup_with_posture_script_js as (
      attacker: unknown, defender: unknown,
      attackerBreath: unknown, defenderBreath: unknown,
      abilityPolicy: unknown, abilityConfig: unknown,
      maxTimeSec: number,
      postureScript: PostureScriptEntry[],
      selfIsAttacker: boolean,
    ) => SimRunResult;

    function runBasic(args: ReturnType<typeof buildCompareArgs>): SimRunResult {
      return simBasic(
        stripNullsForWasm(args.attacker), stripNullsForWasm(args.defender),
        stripNullsForWasm(args.attackerBreath ?? undefined),
        stripNullsForWasm(args.defenderBreath ?? undefined),
        args.abilityPolicy, stripNullsForWasm(args.abilityConfig),
        COMPARE_MAX_TIME_SEC,
        false,
      ) as SimRunResult;
    }
    function runWithScript(
      args: ReturnType<typeof buildCompareArgs>,
      script: PostureScriptEntry[],
    ): SimRunResult {
      return simWithScript(
        stripNullsForWasm(args.attacker), stripNullsForWasm(args.defender),
        stripNullsForWasm(args.attackerBreath ?? undefined),
        stripNullsForWasm(args.defenderBreath ?? undefined),
        args.abilityPolicy, stripNullsForWasm(args.abilityConfig),
        COMPARE_MAX_TIME_SEC,
        script,
        false,
      ) as SimRunResult;
    }
    function fmtRun(label: string, r: SimRunResult): string {
      return `[${label}] a_death=${r.deathTimeA?.toFixed(1) ?? "alive"} b_death=${r.deathTimeB?.toFixed(1) ?? "alive"} ` +
        `hp_a@b_death=${r.hpAAtBDeath.toFixed(0)} hp_b@a_death=${r.hpBAtADeath.toFixed(0)} ` +
        `final_a=${r.finalHpA.toFixed(0)} final_b=${r.finalHpB.toFixed(0)} ` +
        `b_fit=${bFitness(r).toFixed(1)}`;
    }

    // Decision moments — same schedule as the other matchup.
    const decisionTimes: number[] = [];
    for (let t = 0; t <= 90; t += 5) decisionTimes.push(t);
    for (let tick = 15; tick <= 90; tick += 15) {
      decisionTimes.push(tick - 2);
      decisionTimes.push(tick + 0.001);
    }
    decisionTimes.sort((a, b) => a - b);
    const decisions: number[] = [];
    for (const t of decisionTimes) {
      if (decisions.length === 0 || Math.abs(decisions[decisions.length - 1] - t) > 0.01) {
        decisions.push(t);
      }
    }
    const candidates: PostureScriptAction[] = ["stay", "startSit", "startLay", "standUp"];

    for (const mode of ["regenAware", "regenUnaware"] as const) {
      console.log(`\n--- Kendyll vs Goreganthus, mode=${mode} ---`);

      const argsOff = buildCompareArgs({
        attackerName: "Goreganthus", defenderName: "Kendyll",
        posturePolicyB: "off",
      });
      const rOff = runBasic(argsOff);
      console.log(fmtRun(`OFF             `, rOff));

      const argsPolicy = buildCompareArgs({
        attackerName: "Goreganthus", defenderName: "Kendyll",
        posturePolicyB: mode,
      });
      const rPolicy = runBasic(argsPolicy);
      console.log(fmtRun(`POLICY ${mode.padEnd(8)}`, rPolicy));

      // Greedy d=4 to find best raw-action trajectory.
      const lookaheadDepth = 4;
      const decidedScript: PostureScriptEntry[] = [];
      function exploreFromIdx(
        idx: number,
        depthRemaining: number,
        prefix: PostureScriptEntry[],
      ): number {
        if (depthRemaining === 0 || idx >= decisions.length) {
          const trial = [...decidedScript, ...prefix];
          return bFitness(runWithScript(argsOff, trial));
        }
        let best = -Infinity;
        const t = decisions[idx];
        for (const action of candidates) {
          const newPrefix: PostureScriptEntry[] = [...prefix, [t, action]];
          const fit = exploreFromIdx(idx + 1, depthRemaining - 1, newPrefix);
          if (fit > best) best = fit;
        }
        return best;
      }
      for (let i = 0; i < decisions.length; i++) {
        const t = decisions[i];
        let bestFit = -Infinity;
        let bestAction: PostureScriptAction = "stay";
        for (const action of candidates) {
          const prefix: PostureScriptEntry[] = [[t, action]];
          const fit = exploreFromIdx(i + 1, lookaheadDepth - 1, prefix);
          if (fit > bestFit) {
            bestFit = fit;
            bestAction = action;
          }
        }
        decidedScript.push([t, bestAction]);
      }
      const rGreedy = runWithScript(argsOff, decidedScript);
      const greedyFit = bFitness(rGreedy);
      const greedyNonStay = decidedScript.filter(([, a]) => a !== "stay");
      const offFit = bFitness(rOff);
      const policyFit = bFitness(rPolicy);

      console.log(fmtRun(`GREEDY-RUN      `, rGreedy));
      console.log(
        `[GREEDY d=${lookaheadDepth}     ] fitness=${greedyFit.toFixed(1)} ` +
        `vs off=${offFit.toFixed(1)} ` +
        `gain=${(greedyFit - offFit).toFixed(1)} ` +
        `non-stay-actions=${greedyNonStay.length ? greedyNonStay.map(([t, a]) => `${a}@${t}`).join(" ") : "(none — always-stand)"}`,
      );

      // Bisect the trajectory's effect: does the script-with-only-Stay
      // (no non-stay action at all) produce different results than
      // OFF? If so, the posture-policy engagement itself is doing
      // something — script-Stay ≠ OFF.
      const allStayScript: PostureScriptEntry[] = decisions.map((t) => [t, "stay"]);
      const rStayScript = runWithScript(argsOff, allStayScript);
      console.log(fmtRun(`STAY-ONLY-SCRIPT`, rStayScript));

      // Verdict.
      const policyAdded = Math.abs(policyFit - offFit) < 1e-6;
      const greedyAdded = Math.abs(greedyFit - offFit) < 1e-6;
      console.log(
        `[VERDICT          ] policy ${policyAdded ? "= " : policyFit > offFit ? "> " : "< "}off ` +
        `(${policyFit.toFixed(1)} vs ${offFit.toFixed(1)}), ` +
        `greedy ${greedyAdded ? "= " : greedyFit > offFit ? "> " : "< "}off ` +
        `(${greedyFit.toFixed(1)} vs ${offFit.toFixed(1)}) — ` +
        `always-stand claim ${greedyAdded && greedyNonStay.length === 0 ? "SUPPORTED" : "REFUTED"}`,
      );

      // Sanity: policy still respects "never worse than off" slack.
      expect(policyFit).toBeGreaterThanOrEqual(offFit - 50);
    }
  }, 600_000);

  // Natural-intuition strategy test: Opra vs Gimon, Opra fires Cause
  // Fear immediately (10 stacks Fear on Gimon, decay 1 stack per 3 s
  // natural, ×4 in settled Lay = 0.75 s per stack). The "lay to clear
  // status, then continue normally" plan a player would naturally try:
  //   - Lay down right after Cause Fear lands.
  //   - Stay laying until Fear fully decays (~8 s in Lay).
  //   - Stand up, fight normally.
  //
  // Question: does this beat OFF? How does it compare to the registered
  // policy and the depth-4 greedy?
  it("Opra vs Gimon — natural lay-to-clear-Cause-Fear strategy", async () => {
    const rustMod = await loadRustForNode();
    const simBasic = rustMod.simulate_composable_matchup_js as (
      attacker: unknown, defender: unknown,
      attackerBreath: unknown, defenderBreath: unknown,
      abilityPolicy: unknown, abilityConfig: unknown,
      maxTimeSec: number,
      recordTrace?: boolean,
    ) => SimRunResult;
    const simWithScript = rustMod.simulate_composable_matchup_with_posture_script_js as (
      attacker: unknown, defender: unknown,
      attackerBreath: unknown, defenderBreath: unknown,
      abilityPolicy: unknown, abilityConfig: unknown,
      maxTimeSec: number,
      postureScript: PostureScriptEntry[],
      selfIsAttacker: boolean,
    ) => SimRunResult;

    function runBasic(args: ReturnType<typeof buildCompareArgs>): SimRunResult {
      return simBasic(
        stripNullsForWasm(args.attacker), stripNullsForWasm(args.defender),
        stripNullsForWasm(args.attackerBreath ?? undefined),
        stripNullsForWasm(args.defenderBreath ?? undefined),
        args.abilityPolicy, stripNullsForWasm(args.abilityConfig),
        COMPARE_MAX_TIME_SEC,
        false,
      ) as SimRunResult;
    }
    function runWithScript(
      args: ReturnType<typeof buildCompareArgs>,
      script: PostureScriptEntry[],
    ): SimRunResult {
      return simWithScript(
        stripNullsForWasm(args.attacker), stripNullsForWasm(args.defender),
        stripNullsForWasm(args.attackerBreath ?? undefined),
        stripNullsForWasm(args.defenderBreath ?? undefined),
        args.abilityPolicy, stripNullsForWasm(args.abilityConfig),
        COMPARE_MAX_TIME_SEC,
        script,
        false,
      ) as SimRunResult;
    }
    function fmtRun(label: string, r: SimRunResult): string {
      return `[${label}] a_death=${r.deathTimeA?.toFixed(1) ?? "alive"} b_death=${r.deathTimeB?.toFixed(1) ?? "alive"} ` +
        `hp_a@b_death=${r.hpAAtBDeath.toFixed(0)} hp_b@a_death=${r.hpBAtADeath.toFixed(0)} ` +
        `final_a=${r.finalHpA.toFixed(0)} final_b=${r.finalHpB.toFixed(0)} ` +
        `b_fit=${bFitness(r).toFixed(1)}`;
    }

    // Same Opra vs Gimon args as the main test, defender = Gimon.
    const argsOff = buildCompareArgs({
      attackerName: "Opralegion", defenderName: "Gimon-Ogu",
      posturePolicyB: "off",
    });
    const argsPolicy = buildCompareArgs({
      attackerName: "Opralegion", defenderName: "Gimon-Ogu",
      posturePolicyB: "regenAware",
    });
    const rOff = runBasic(argsOff);
    const rPolicy = runBasic(argsPolicy);
    console.log(`\n--- Opra vs Gimon: natural lay-clear-fear strategy ---`);
    console.log(fmtRun(`OFF                       `, rOff));
    console.log(fmtRun(`POLICY regenAware         `, rPolicy));

    // Several lay-window variants. Fear has 10 stacks, ×4 decay in Lay
    // = 0.75 s per stack = 7.5 s for full clear from "10 stacks fresh".
    // Bracket around that with realistic lay-start times (depends on
    // when Cause Fear actually lands — Opralegion uses it ASAP per the
    // Reference). The Lay → Standing transition is instant; the
    // Standing → Lay transition takes 2 s, so a Lay@T script settles
    // into ×4 decay at T+2. Effective lay-decay window:
    // [T+2, standUp_time].
    // Each script is wrapped: fill all decision moments with Stay,
    // overlay the lay+stand entries. This matches the format the
    // Kendyll diagnostic uses (which works) and avoids whatever
    // sparse-script edge case caused the WASM panic when only two
    // entries were passed.
    const decisionTimes: number[] = [];
    for (let t = 0; t <= 90; t += 5) decisionTimes.push(t);
    decisionTimes.sort((a, b) => a - b);
    function denseScript(actions: Map<number, PostureScriptAction>): PostureScriptEntry[] {
      const script: PostureScriptEntry[] = [];
      for (const t of decisionTimes) {
        script.push([t, actions.get(t) ?? "stay"]);
      }
      return script;
    }
    const variants: { name: string; script: PostureScriptEntry[] }[] = [
      { name: "lay@0  stand@5 ", script: denseScript(new Map([[0, "startLay"], [5, "standUp"]])) },
      { name: "lay@0  stand@10", script: denseScript(new Map([[0, "startLay"], [10, "standUp"]])) },
      { name: "lay@0  stand@15", script: denseScript(new Map([[0, "startLay"], [15, "standUp"]])) },
      { name: "lay@5  stand@10", script: denseScript(new Map([[5, "startLay"], [10, "standUp"]])) },
      { name: "lay@5  stand@15", script: denseScript(new Map([[5, "startLay"], [15, "standUp"]])) },
      { name: "lay@5  stand@20", script: denseScript(new Map([[5, "startLay"], [20, "standUp"]])) },
    ];

    const offFit = bFitness(rOff);
    const policyFit = bFitness(rPolicy);
    let bestNaturalFit = -Infinity;
    let bestNaturalName = "";
    for (const v of variants) {
      const r = runWithScript(argsOff, v.script);
      const fit = bFitness(r);
      console.log(
        `[NATURAL ${v.name}] ` +
        `a_death=${r.deathTimeA?.toFixed(1) ?? "alive"} ` +
        `b_death=${r.deathTimeB?.toFixed(1) ?? "alive"} ` +
        `final_a=${r.finalHpA.toFixed(0)} final_b=${r.finalHpB.toFixed(0)} ` +
        `b_fit=${fit.toFixed(1)} ` +
        `vs_off=${(fit - offFit).toFixed(1)} ` +
        `vs_policy=${(fit - policyFit).toFixed(1)}`,
      );
      if (fit > bestNaturalFit) {
        bestNaturalFit = fit;
        bestNaturalName = v.name;
      }
    }
    console.log(
      `[NATURAL BEST            ] ${bestNaturalName.trim()} fitness=${bestNaturalFit.toFixed(1)} ` +
      `(off=${offFit.toFixed(1)}, policy=${policyFit.toFixed(1)})`,
    );
    if (bestNaturalFit < offFit - 1e-6) {
      console.warn(
        `Natural lay-clear-fear strategy LOSES to OFF (best=${bestNaturalFit.toFixed(1)} vs off=${offFit.toFixed(1)}). ` +
        `Pure status-clear via Lay is NOT optimal for this matchup — the settled-Lay ×1.75 incoming penalty during ` +
        `the ${"~8 s"} lay window outweighs the ×4 Fear-decay benefit.`,
      );
    } else if (bestNaturalFit < policyFit - 1e-6) {
      console.warn(
        `Natural strategy beats OFF (${bestNaturalFit.toFixed(1)} vs ${offFit.toFixed(1)}) but loses to ` +
        `the registered policy (${policyFit.toFixed(1)}). Policy's cyclic lay-stand pattern captures more ` +
        `value than a single front-loaded lay window.`,
      );
    } else {
      console.log(
        `Natural strategy is at least as good as policy (${bestNaturalFit.toFixed(1)} >= ${policyFit.toFixed(1)}).`,
      );
    }
  }, 600_000);

  // Bite-variant gap measurement. For each (attacker, defender) pair
  // we run three Compare configurations differing only in
  // `compareBiteVariantModeA`:
  //   - "primaryOnly"   — every bite uses primary (base damage +
  //                       on-hit statuses).
  //   - "secondaryOnly" — every bite uses damage2 (no statuses).
  //   - "dynamic"       — the analytic BiteVariantDecision picks
  //                       per-bite via `pick_bite_variant_now`.
  //
  // If dynamic ≥ max(primary, secondary), the analytic is doing
  // useful work and at worst matches the better static. If dynamic
  // < max(primary, secondary), the analytic is making strictly worse
  // choices than a fixed single variant — smoking gun for refactor.
  it("Bite-variant analytic vs static-mode baselines", async () => {
    const rustMod = await loadRustForNode();
    const simBasic = rustMod.simulate_composable_matchup_js as (
      attacker: unknown, defender: unknown,
      attackerBreath: unknown, defenderBreath: unknown,
      abilityPolicy: unknown, abilityConfig: unknown,
      maxTimeSec: number,
      recordTrace?: boolean,
    ) => SimRunResult;

    function buildArgsBV(opts: {
      attackerName: string;
      defenderName: string;
      modeA: "primaryOnly" | "secondaryOnly" | "dynamic";
    }) {
      const sourceCreature = creature(opts.attackerName);
      const opponentCreature = creature(opts.defenderName);
      const finalA = finalStats(opts.attackerName);
      const finalB = finalStats(opts.defenderName);
      return toRustComposableArgsFromCompare({
        sourceCreature, opponentCreature, finalA, finalB,
        activesOn: true, breathOn: true,
        abilityPolicy: "ideal",
        initialStatusesA: [], initialStatusesB: [],
        activeCooldownMultiplierA: 1, activeCooldownMultiplierB: 1,
        disabledAbilitiesA: [], disabledAbilitiesB: [],
        perksA: defaultPerks, perksB: defaultPerks,
        firstTick: { mode: "off", delaySec: 1 },
        noMoveFacetank: true,
        badOmenOutcome: null,
        compareAirRuleEnabled: false,
        compareAirRuleCooldownSec: 0,
        compareBiteVariantModeA: opts.modeA,
        compareBiteVariantModeB: "primaryOnly",
        posturePolicyA: "off",
        posturePolicyB: "off",
      });
    }
    function runArgs(args: ReturnType<typeof buildArgsBV>): SimRunResult {
      return simBasic(
        stripNullsForWasm(args.attacker), stripNullsForWasm(args.defender),
        stripNullsForWasm(args.attackerBreath ?? undefined),
        stripNullsForWasm(args.defenderBreath ?? undefined),
        args.abilityPolicy, stripNullsForWasm(args.abilityConfig),
        COMPARE_MAX_TIME_SEC,
        false,
      ) as SimRunResult;
    }

    // a-perspective fitness (attacker view of the trade).
    function aFitness(r: SimRunResult): number {
      const meDeath = r.deathTimeA ?? null;
      const opDeath = r.deathTimeB ?? null;
      if (meDeath === null && opDeath === null) return Math.max(r.finalHpA, 0);
      if (meDeath === null && opDeath !== null) return Math.max(r.finalHpA, 0) + 1;
      if (meDeath !== null && opDeath === null) return -Math.max(r.hpBAtADeath, 0);
      if (meDeath! > opDeath! + 1e-9) return (meDeath! - opDeath!) + 1;
      if (opDeath! > meDeath! + 1e-9) return -Math.max(r.hpBAtADeath, 0);
      return 0;
    }

    // Matchup picks (attacker name, defender name). Attacker has
    // damage2>0 so dynamic mode actually does something. Defender
    // mostly varies in HP / status resists to see whether the gap
    // surfaces under different opponent shapes.
    const matchups: { name: string; attacker: string; defender: string }[] = [
      { name: "Cavengauu vs Goreganthus  ", attacker: "Cavengauu",   defender: "Goreganthus" },
      { name: "Cavengauu vs Opralegion   ", attacker: "Cavengauu",   defender: "Opralegion" },
      { name: "Boskurro vs Goreganthus   ", attacker: "Boskurro",    defender: "Goreganthus" },
      { name: "Exterreri vs Goreganthus  ", attacker: "Exterreri",   defender: "Goreganthus" },
      { name: "Auraron vs Goreganthus    ", attacker: "Auraron",     defender: "Goreganthus" },
      { name: "Elarickkeir vs Goreganthus", attacker: "Elarickkeir", defender: "Goreganthus" },
    ];

    let regressions = 0;
    for (const m of matchups) {
      console.log(`\n--- ${m.name.trim()} ---`);
      const fits: Record<"primaryOnly" | "secondaryOnly" | "dynamic", number> = {
        primaryOnly: 0, secondaryOnly: 0, dynamic: 0,
      };
      for (const mode of ["primaryOnly", "secondaryOnly", "dynamic"] as const) {
        const r = runArgs(buildArgsBV({ attackerName: m.attacker, defenderName: m.defender, modeA: mode }));
        const fit = aFitness(r);
        fits[mode] = fit;
        console.log(
          `[${mode.padEnd(13)} ] a_death=${r.deathTimeA?.toFixed(1) ?? "alive"} b_death=${r.deathTimeB?.toFixed(1) ?? "alive"} ` +
          `hp_a@b_death=${r.hpAAtBDeath.toFixed(0)} hp_b@a_death=${r.hpBAtADeath.toFixed(0)} ` +
          `final_a=${r.finalHpA.toFixed(0)} final_b=${r.finalHpB.toFixed(0)} ` +
          `a_fit=${fit.toFixed(1)}`,
        );
      }
      const bestStatic = Math.max(fits.primaryOnly, fits.secondaryOnly);
      const dyn = fits.dynamic;
      const delta = dyn - bestStatic;
      const verdict = delta >= -0.5
        ? (delta > 0.5 ? "DYNAMIC BEATS BOTH STATICS" : "DYNAMIC ≈ BEST STATIC")
        : "DYNAMIC LOSES TO BEST STATIC (regression)";
      console.log(
        `[VERDICT       ] dynamic=${dyn.toFixed(1)}, best-static=${bestStatic.toFixed(1)} ` +
        `(prim=${fits.primaryOnly.toFixed(1)}, sec=${fits.secondaryOnly.toFixed(1)}), Δ=${delta.toFixed(1)} → ${verdict}`,
      );
      if (delta < -0.5) regressions += 1;
    }
    console.log(`\n[SUMMARY] ${regressions}/${matchups.length} matchups show dynamic strictly worse than best static.`);
  }, 600_000);

  // Greedy bite-variant ideal — finds the math-ideal mixed sequence by
  // committing variant-by-variant. At each bite-event time t_i:
  //   - Try [...committed, (t_i, "primary"), ...future_primary_only].
  //   - Try [...committed, (t_i, "secondary"), ...future_primary_only].
  //   - Commit whichever scores higher.
  //   - Advance to next bite event.
  //
  // The "future primary" tail means the comparison reflects "this
  // bite varies, future bites default to primary". Captures the
  // per-bite trade cleanly. Cost: 2 × N_bites simulations per matchup
  // (~60 bites for a 60 s fight = ~120 sims = ~5 s).
  //
  // Reports IDEAL = max(greedy, primary, secondary, dynamic) so we
  // never display a benchmark BELOW what's actually achievable.
  it("Bite-variant analytic vs greedy ideal (engine-replay)", async () => {
    const rustMod = await loadRustForNode();
    const simBasic = rustMod.simulate_composable_matchup_js as (
      attacker: unknown, defender: unknown,
      attackerBreath: unknown, defenderBreath: unknown,
      abilityPolicy: unknown, abilityConfig: unknown,
      maxTimeSec: number,
      recordTrace?: boolean,
    ) => SimRunResult;
    const simWithBVScript = rustMod.simulate_composable_matchup_with_bite_variant_script_js as (
      attacker: unknown, defender: unknown,
      attackerBreath: unknown, defenderBreath: unknown,
      abilityPolicy: unknown, abilityConfig: unknown,
      maxTimeSec: number,
      script: [number, string][],
      selfIsAttacker: boolean,
    ) => SimRunResult;

    function buildArgsBV(opts: {
      attackerName: string;
      defenderName: string;
      modeA: "primaryOnly" | "secondaryOnly" | "dynamic";
    }) {
      const sourceCreature = creature(opts.attackerName);
      const opponentCreature = creature(opts.defenderName);
      const finalA = finalStats(opts.attackerName);
      const finalB = finalStats(opts.defenderName);
      return toRustComposableArgsFromCompare({
        sourceCreature, opponentCreature, finalA, finalB,
        activesOn: true, breathOn: true,
        abilityPolicy: "ideal",
        initialStatusesA: [], initialStatusesB: [],
        activeCooldownMultiplierA: 1, activeCooldownMultiplierB: 1,
        disabledAbilitiesA: [], disabledAbilitiesB: [],
        perksA: defaultPerks, perksB: defaultPerks,
        firstTick: { mode: "off", delaySec: 1 },
        noMoveFacetank: true,
        badOmenOutcome: null,
        compareAirRuleEnabled: false,
        compareAirRuleCooldownSec: 0,
        compareBiteVariantModeA: opts.modeA,
        compareBiteVariantModeB: "primaryOnly",
        posturePolicyA: "off",
        posturePolicyB: "off",
      });
    }
    function runBasic(args: ReturnType<typeof buildArgsBV>): SimRunResult {
      return simBasic(
        stripNullsForWasm(args.attacker), stripNullsForWasm(args.defender),
        stripNullsForWasm(args.attackerBreath ?? undefined),
        stripNullsForWasm(args.defenderBreath ?? undefined),
        args.abilityPolicy, stripNullsForWasm(args.abilityConfig),
        COMPARE_MAX_TIME_SEC,
        false,
      ) as SimRunResult;
    }
    function runWithBVScript(
      args: ReturnType<typeof buildArgsBV>,
      script: [number, string][],
    ): SimRunResult {
      return simWithBVScript(
        stripNullsForWasm(args.attacker), stripNullsForWasm(args.defender),
        stripNullsForWasm(args.attackerBreath ?? undefined),
        stripNullsForWasm(args.defenderBreath ?? undefined),
        args.abilityPolicy, stripNullsForWasm(args.abilityConfig),
        COMPARE_MAX_TIME_SEC,
        script,
        true, // self_is_attacker — A is the attacker we're scripting
      ) as SimRunResult;
    }
    function aFitness(r: SimRunResult): number {
      const meDeath = r.deathTimeA ?? null;
      const opDeath = r.deathTimeB ?? null;
      if (meDeath === null && opDeath === null) return Math.max(r.finalHpA, 0);
      if (meDeath === null && opDeath !== null) return Math.max(r.finalHpA, 0) + 1;
      if (meDeath !== null && opDeath === null) return -Math.max(r.hpBAtADeath, 0);
      if (meDeath! > opDeath! + 1e-9) return (meDeath! - opDeath!) + 1;
      if (opDeath! > meDeath! + 1e-9) return -Math.max(r.hpBAtADeath, 0);
      return 0;
    }

    const matchups: { name: string; attacker: string; defender: string }[] = [
      { name: "Cavengauu vs Goreganthus  ", attacker: "Cavengauu",   defender: "Goreganthus" },
      { name: "Elarickkeir vs Goreganthus", attacker: "Elarickkeir", defender: "Goreganthus" },
      { name: "Boskurro vs Goreganthus   ", attacker: "Boskurro",    defender: "Goreganthus" },
    ];

    for (const m of matchups) {
      console.log(`\n--- ${m.name.trim()} ---`);
      const args = buildArgsBV({ attackerName: m.attacker, defenderName: m.defender, modeA: "dynamic" });
      const argsPrim = buildArgsBV({ attackerName: m.attacker, defenderName: m.defender, modeA: "primaryOnly" });
      const argsSec = buildArgsBV({ attackerName: m.attacker, defenderName: m.defender, modeA: "secondaryOnly" });

      const fitPrim = aFitness(runBasic(argsPrim));
      const fitSec = aFitness(runBasic(argsSec));
      const fitDyn = aFitness(runBasic(args));

      // Bite events fire at fixed cadence biteCooldown. Probe a coarse
      // grid of candidate bite times — coarse enough that adjacent
      // entries don't both land within the same bite event (1.5 s
      // spacing covers most creatures' cadences). The override
      // returns the LAST script entry whose time ≤ now, so each entry
      // governs the bite events that fall in its window.
      const sourceFinal = finalStats(m.attacker);
      const biteCd = Math.max(0.4, sourceFinal.biteCooldown);
      const decisionTimes: number[] = [];
      for (let t = 0; t < 120; t += biteCd) decisionTimes.push(t);

      // Greedy: commit one variant per decision moment, evaluate full sim
      // with rest defaulting to primary.
      const committed: [number, string][] = [];
      const t0 = Date.now();
      for (const t of decisionTimes) {
        const candP: [number, string][] = [...committed, [t, "primary"]];
        const candS: [number, string][] = [...committed, [t, "secondary"]];
        const fP = aFitness(runWithBVScript(args, candP));
        const fS = aFitness(runWithBVScript(args, candS));
        committed.push([t, fP >= fS ? "primary" : "secondary"]);
      }
      const rGreedy = runWithBVScript(args, committed);
      const fitGreedy = aFitness(rGreedy);
      const greedyElapsed = (Date.now() - t0) / 1000;
      const nonPrimary = committed.filter(([, v]) => v !== "primary");
      const ideal = Math.max(fitPrim, fitSec, fitDyn, fitGreedy);
      const capture = ideal === fitPrim || ideal === fitSec
        ? "ideal achievable via single static"
        : "ideal achievable only via mixed";

      console.log(
        `[primaryOnly  ] a_fit=${fitPrim.toFixed(1)}`,
      );
      console.log(
        `[secondaryOnly] a_fit=${fitSec.toFixed(1)}`,
      );
      console.log(
        `[dynamic      ] a_fit=${fitDyn.toFixed(1)} ` +
        `(${fitDyn === fitPrim ? "= primaryOnly" : fitDyn === fitSec ? "= secondaryOnly" : "MIXED!"})`,
      );
      console.log(
        `[greedy d=1   ] a_fit=${fitGreedy.toFixed(1)} ` +
        `elapsed=${greedyElapsed.toFixed(1)}s ` +
        `non-primary-bites=${nonPrimary.length}/${committed.length}` +
        (nonPrimary.length > 0 && nonPrimary.length <= 5 ? ` [${nonPrimary.map(([t, v]) => `${v[0]}@${t.toFixed(1)}`).join(",")}]` : ""),
      );
      console.log(
        `[IDEAL = MAX  ] ideal=${ideal.toFixed(1)} ` +
        `(${capture}). dynamic gap vs ideal = ${(ideal - fitDyn).toFixed(1)}`,
      );
    }
  }, 1_200_000);
});
