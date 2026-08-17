/// <reference types="node" />
// Shared Node-side real-WASM matchup runner. Loads the engine bundle
// (src/rust-pkg/*.wasm) once per process via the proven loader and runs a
// representative Compare matchup, returning the full summary. Used by the
// real-WASM smoke test (wasmMatchupSmoke.test.ts) and the committed-vs-fresh
// freshness gate (wasmFreshness.test.ts) so the loader lives in one place.
//
// `tsconfig.app.json` excludes node types; the file-scoped reference adds them
// for these Node-run tests only.
import { applyRulesAndBuild, type CreatureRuntime } from "../engine";
import { creatureByName } from "../engine/creatureData";
import { BAD_OMEN_DEFAULT_OUTCOME } from "../engine/subsystems/statuses";
import {
  toRustComposableArgsFromCompare,
  type CompareSidePerks,
  type PosturePolicyMode,
} from "./rustCompareMatchupRuntime";
import type { InitialStatusOption } from "../engine/types";
import type { RustMatchupSummary } from "./rustMatchupBridge";
import { stripNullsForWasm } from "./rustMatchupLoader";

// One memoized WASM instance per process (a 2nd instance corrupts the bg.js
// memory view - see posturePolicyRealCompareBeam.test.ts for the full why).
let cachedBg:
  | {
      simulate_composable_matchup_js: (...args: unknown[]) => unknown;
      simulate_composable_matchup_batch_js: (...args: unknown[]) => unknown;
      capture_defensive_pin_schedule_js: (...args: unknown[]) => unknown;
      simulate_composable_matchup_pinned_js: (...args: unknown[]) => unknown;
      // The binary's own wire-contract digest, compared against
      // `contractSchemaHash.generated.ts` to catch a stale `.wasm`.
      rust_matchup_contract_version: () => string;
    }
  | null = null;

export async function loadRustForNode() {
  if (cachedBg) return cachedBg;
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const wasmPath = path.resolve(here, "../rust-pkg/cos_calc_wasm_engine_bg.wasm");
  const bg = (await import("../rust-pkg/cos_calc_wasm_engine_bg.js")) as any;
  const wasmModule = await WebAssembly.compile(readFileSync(wasmPath));
  const instance = await WebAssembly.instantiate(wasmModule, { "./cos_calc_wasm_engine_bg.js": bg });
  bg.__wbg_set_wasm(instance.exports);
  (instance.exports as { __wbindgen_start?: () => void }).__wbindgen_start?.();
  cachedBg = bg as never;
  return cachedBg!;
}

export function creature(name: string): CreatureRuntime {
  const runtime = creatureByName[name];
  if (!runtime) throw new Error(`Missing creature fixture: ${name}`);
  return {
    ...runtime,
    passiveAbilities: [...(runtime.passiveAbilities ?? [])],
    activatedAbilities: [...(runtime.activatedAbilities ?? [])],
    breathAbilities: [...(runtime.breathAbilities ?? [])],
  };
}

const finalStats = (name: string) =>
  applyRulesAndBuild(creature(name), { venerationStage: 5, traits: [], ascensionAssignments: [], plushies: [] });

const PERKS: CompareSidePerks = {
  traps: false, trails: false, powerCharge: false, goreCharge: false, startingSpiteCharged: false,
  muddyBuff: false, hungerRule: false, gourmandizer: false, startingHungerUnits: 100, appetiteBaseUnits: 100,
  defiledGroundLevel: 0, defiledGroundWeakness: false, hasDarkstar: false, appetiteDrainMultiplier: 1,
  healingPulseEnabled: false, healingPulseOnce: false, expungeEnabled: false, wardenRageStartHpPct: 0,
  headStartSec: 0,
};

/** Run `a` vs `b` through the loaded engine and return the full matchup summary. */
export function runMatchupSummary(
  rustMod: Awaited<ReturnType<typeof loadRustForNode>>,
  a: string,
  b: string,
): RustMatchupSummary {
  return runMatchupSummaryWithPerks(rustMod, a, b, PERKS, PERKS);
}

/** As `runMatchupSummary`, with the Compare knobs set per side. The roster
 *  sweep leaves them all off; the side-routing guard needs them asymmetric,
 *  because a config field copied onto the wrong side in `setup.rs` is only
 *  visible once the two sides differ. */
export function runMatchupSummaryWithPerks(
  rustMod: Awaited<ReturnType<typeof loadRustForNode>>,
  a: string,
  b: string,
  perksA: CompareSidePerks,
  perksB: CompareSidePerks,
  /** Some knobs only bite under conditions the default run does not create -
   *  Darkstar multiplies ailment recovery, and only while the side is sitting
   *  or laying, so a standing fight with no ailments never shows it. */
  scene: {
    initialStatusesA?: InitialStatusOption[];
    initialStatusesB?: InitialStatusOption[];
    posturePolicy?: PosturePolicyMode;
  } = {},
): RustMatchupSummary {
  const args = toRustComposableArgsFromCompare({
    sourceCreature: creature(a), opponentCreature: creature(b),
    finalA: finalStats(a), finalB: finalStats(b),
    activesOn: true, breathOn: true, abilityPolicy: "ideal",
    initialStatusesA: scene.initialStatusesA ?? [], initialStatusesB: scene.initialStatusesB ?? [],
    activeCooldownMultiplierA: 1, activeCooldownMultiplierB: 1,
    disabledAbilitiesA: [], disabledAbilitiesB: [],
    perksA, perksB,
    firstTick: { mode: "off", delaySec: 1 }, noMoveFacetank: true,
    // Pinned, not rolled: Bad Omen`s follow-up is random by nature, and this
    // runner feeds the freshness gate, which diffs two processes. Left to roll,
    // any Cursed Sigil carrier reports a fresh number every run and the gate
    // calls a healthy bundle stale.
    badOmenOutcome: BAD_OMEN_DEFAULT_OUTCOME,
    compareAirRuleEnabled: false, compareAirRuleCooldownSec: 0,
    compareBiteVariantModeA: "primaryOnly", compareBiteVariantModeB: "primaryOnly",
    posturePolicyA: scene.posturePolicy ?? "off", posturePolicyB: scene.posturePolicy ?? "off",
  });
  const sim = rustMod.simulate_composable_matchup_js as (...a: unknown[]) => RustMatchupSummary;
  return sim(
    stripNullsForWasm(args.attacker), stripNullsForWasm(args.defender),
    stripNullsForWasm(args.attackerBreath ?? undefined), stripNullsForWasm(args.defenderBreath ?? undefined),
    args.abilityPolicy, stripNullsForWasm(args.abilityConfig), 900, false,
  );
}
