import type {
  AbilityTimingMode,
  AbilityTimingOverrides,
  BadOmenOutcome,
  CompareBiteVariantMode,
  CreatureRuntime,
  FinalStats,
  SimulationSummary,
  SimulationDebug,
  UserAbilityLevelOverrides,
  UserAbilityTimingOverrides,
} from "../engine";
import type { CombatEventPhase } from "../engine/eventOrdering";
import {
  toRustComposableArgsFromCompare,
  type CompareFirstTickConfig,
  type CompareInitialStatus,
  type CompareSidePerks,
  type PosturePolicyMode,
} from "./rustCompareMatchupRuntime";
import {
  getLoadedRustMatchupBridge,
  isRustMatchupBridgeDisabled,
  loadRustMatchupBridge,
} from "./rustMatchupLoader";
import { simulateCompareInWorker } from "./compareWorkerClient";
import type {
  RustMatchupSummary,
  RustSimulationDebug,
} from "./rustMatchupBridge";
import {
  getRustUnsupportedActivatedAbilityNamesForComposable,
  getRustUnsupportedPassiveAbilityNamesForBreath,
} from "./rustBestBuildsRuntime";

// ---------------------------------------------------------------------------
// Compare → Rust dispatch (Phase 3 step 3, plan A wiring).
//
// Eligibility check returns the list of reasons (if any) that block the
// Rust path. There is no TS combat fallback — when reasons exist Compare
// leaves the result empty and the bridge-status banner in App.tsx
// surfaces the underlying problem. The reasons enum is kept so future
// Rust gaps (none today) can be reported cleanly.
// ---------------------------------------------------------------------------

export type CompareRustIneligibilityReason =
  | "bridge-disabled"
  | "bridge-not-loaded"
  | "force-disabled-flag"
  | "source-has-unsupported-passive-ability"
  | "defender-has-unsupported-passive-ability"
  | "source-has-unsupported-activated-ability"
  | "defender-has-unsupported-activated-ability";

export type CompareRustEligibilityInput = {
  sourceCreature: CreatureRuntime;
  opponentCreature: CreatureRuntime;
  abilityPolicy: AbilityTimingMode;
};

function isRustCompareForceDisabled(): boolean {
  if (typeof globalThis !== "undefined") {
    const flag = (globalThis as { __COS_CALC_DISABLE_RUST_COMPARE__?: unknown }).__COS_CALC_DISABLE_RUST_COMPARE__;
    if (flag) return true;
  }
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (processEnv?.COS_CALC_DISABLE_RUST_COMPARE === "1") return true;
  return false;
}

export function getCompareRustIneligibilityReasons(
  input: CompareRustEligibilityInput,
): CompareRustIneligibilityReason[] {
  const reasons: CompareRustIneligibilityReason[] = [];
  if (isRustMatchupBridgeDisabled()) reasons.push("bridge-disabled");
  if (isRustCompareForceDisabled()) reasons.push("force-disabled-flag");
  if (!getLoadedRustMatchupBridge()) reasons.push("bridge-not-loaded");

  if (getRustUnsupportedPassiveAbilityNamesForBreath(input.sourceCreature).length > 0) {
    reasons.push("source-has-unsupported-passive-ability");
  }
  if (getRustUnsupportedPassiveAbilityNamesForBreath(input.opponentCreature).length > 0) {
    reasons.push("defender-has-unsupported-passive-ability");
  }
  if (getRustUnsupportedActivatedAbilityNamesForComposable(input.sourceCreature).length > 0) {
    reasons.push("source-has-unsupported-activated-ability");
  }
  if (getRustUnsupportedActivatedAbilityNamesForComposable(input.opponentCreature).length > 0) {
    reasons.push("defender-has-unsupported-activated-ability");
  }
  return reasons;
}

export function isRustCompareEligible(input: CompareRustEligibilityInput): boolean {
  return getCompareRustIneligibilityReasons(input).length === 0;
}

export type TrySimulateRustCompareInput = {
  sourceCreature: CreatureRuntime;
  opponentCreature: CreatureRuntime;
  finalA: FinalStats;
  finalB: FinalStats;
  activesOn: boolean;
  breathOn: boolean;
  abilityPolicy: AbilityTimingMode;
  abilityPolicyOverridesA?: AbilityTimingOverrides;
  abilityPolicyOverridesB?: AbilityTimingOverrides;
  /** Per-user-ability runtime override (Compare-time, not on the
   * spec). Each map key is a user.<id>; values pin timing for
   * that ability for THIS matchup. */
  userAbilityOverridesA?: UserAbilityTimingOverrides;
  userAbilityOverridesB?: UserAbilityTimingOverrides;
  /** Round 42 / A11: per-fight user-ability level picks (Compare-time). */
  userAbilityLevelsA?: UserAbilityLevelOverrides;
  userAbilityLevelsB?: UserAbilityLevelOverrides;
  initialStatusesA: CompareInitialStatus[];
  initialStatusesB: CompareInitialStatus[];
  activeCooldownMultiplierA: number;
  activeCooldownMultiplierB: number;
  disabledAbilitiesA: string[];
  disabledAbilitiesB: string[];
  perksA: CompareSidePerks;
  perksB: CompareSidePerks;
  firstTick: CompareFirstTickConfig;
  noMoveFacetank: boolean;
  posturePolicyA?: PosturePolicyMode;
  posturePolicyB?: PosturePolicyMode;
  compareAirRuleEnabled: boolean;
  compareAirRuleCooldownSec: number;
  compareBiteVariantModeA: CompareBiteVariantMode;
  compareBiteVariantModeB: CompareBiteVariantMode;
  combatEventOrder?: CombatEventPhase[];
  badOmenOutcome: BadOmenOutcome | null;
  /** Round 32 / A5: compare-page day/night + moon UI knobs. Forwarded
   * verbatim to the Rust engine so user abilities can read them via
   * `env.is_day` / `env.is_night` / `env.is_blue_moon` / `env.is_blood_moon`.
   * Stats buffs from these are already applied via `applyCompareBuffRuntime`
   * earlier in the pipeline; this is the raw enum for ability gating. */
  compareDayNight?: "none" | "day" | "night";
  compareMoon?: "none" | "blueMoon" | "bloodMoon";
  /** Global weather cataclysm; immunity resolved on the TS side. */
  weather?: "none" | "heatWave" | "blizzard" | "acidRain";
  attackerWeatherImmune?: boolean;
  defenderWeatherImmune?: boolean;
  /** Storming debuff per side (already gated to terrestrial-vs-aquatic). */
  attackerStorming?: boolean;
  defenderStorming?: boolean;
  maxTimeSec: number;
};

function mapRustDebug(rust: RustSimulationDebug): SimulationDebug {
  return {
    totalDamageDealt: rust.totalDamageDealt,
    totalLifeLeechHealed: rust.totalLifeLeechHealed,
    dotDps: rust.dotDps,
    statuses: {},
    statusStacksApplied: rust.statusStacksApplied,
    statusStacksBlocked: rust.statusStacksBlocked,
    statusBlockFractions: rust.statusStackBlockFractions,
    regenTicks: rust.regenTicks,
    regenHealed: rust.regenHealed,
    attackerWeight: rust.attackerWeight,
    opponentWeight: rust.opponentWeight,
    weightRatio: rust.weightRatio,
    weightRatioCapHit: rust.weightRatioCapHit,
    wardenRageOn: rust.wardenRageOn,
    wardenRageStacks: rust.wardenRageStacks,
    wardenRageCooldownUntil: rust.wardenRageCooldownUntil,
    wardenRageTapUntil: rust.wardenRageTapUntil,
    nextRegenAt: rust.nextRegenAt ?? undefined,
    wardenResistanceActive: rust.wardenResistanceActive,
    reflectActiveUntil: rust.reflectActiveUntil > 0 ? rust.reflectActiveUntil : null,
    totemNextTickAt: rust.totemNextTickAt,
    drowsyActive: rust.drowsyActive,
    wardenRageEvents: rust.wardenRageEvents,
    abilityTimingEvents: rust.abilityTimingEvents,
    plushieOffensiveStacksApplied: rust.plushieOffensiveStacksApplied,
    plushieDefensiveStacksApplied: rust.plushieDefensiveStacksApplied,
    biteCount: rust.biteCount,
    breathTickCount: rust.breathTickCount,
    abilitiesPresent: rust.abilitiesPresent,
    abilitiesModeled: rust.abilitiesModeled,
    abilitiesApplied: rust.abilitiesApplied,
    abilitiesNotModeled: rust.abilitiesNotModeled,
    compareHunger: rust.compareHunger,
    compareStartingHunger: rust.compareStartingHunger,
    compareAppetiteBase: rust.compareAppetiteBase,
    compareHungerRuleEnabled: rust.compareHungerRuleEnabled,
  };
}

function adaptRustToSimulationSummary(rust: RustMatchupSummary): SimulationSummary {
  const debug = rust.debug ? { A: mapRustDebug(rust.debug.A), B: mapRustDebug(rust.debug.B) } : undefined;
  const summary: SimulationSummary = {
    dpsAtoB: rust.dpsAtoB,
    dpsBtoA: rust.dpsBtoA,
    ttkAtoB: rust.ttkAtoB,
    ttkBtoA: rust.ttkBtoA,
    deathTimeA: rust.deathTimeA,
    deathTimeB: rust.deathTimeB,
    maxTimeSec: rust.maxTimeSec,
    finalHpA: rust.finalHpA,
    finalHpB: rust.finalHpB,
    maxHpA: rust.maxHpA,
    maxHpB: rust.maxHpB,
    hpAAtBDeath: rust.hpAAtBDeath,
    hpBAtADeath: rust.hpBAtADeath,
    ehpA: rust.ehpA,
    ehpB: rust.ehpB,
    winner: rust.winner,
    approxNotes: [],
    damageDealtA: rust.damageDealtA,
    damageDealtB: rust.damageDealtB,
    damageDealtA_untilBDeath: rust.damageDealtA_untilBDeath,
    damageDealtB_untilADeath: rust.damageDealtB_untilADeath,
    damageDealtAAtBDeath: rust.damageDealtAAtBDeath,
    damageDealtBAtADeath: rust.damageDealtBAtADeath,
    regenHealedA: rust.regenHealedA,
    regenHealedB: rust.regenHealedB,
    regenTicksA: rust.regenTicksA,
    regenTicksB: rust.regenTicksB,
    extendedDamagePotentialA: rust.extendedDamagePotentialA,
    extendedDamagePotentialB: rust.extendedDamagePotentialB,
  };
  if (rust.badOmenOutcome) {
    summary.badOmenOutcome = {
      statusId: rust.badOmenOutcome.statusId,
      stacks: rust.badOmenOutcome.stacks,
      label: rust.badOmenOutcome.label,
    };
  }
  if (rust.combatLog) summary.combatLog = rust.combatLog;
  if (debug) summary.debug = debug;
  return summary;
}

export async function trySimulateRustCompareMatchup(
  input: TrySimulateRustCompareInput,
): Promise<SimulationSummary | null> {
  if (isRustMatchupBridgeDisabled() || isRustCompareForceDisabled()) return null;

  // Ensure bridge has a chance to load before eligibility check reads it.
  await loadRustMatchupBridge();

  const ineligibilityReasons = getCompareRustIneligibilityReasons({
    sourceCreature: input.sourceCreature,
    opponentCreature: input.opponentCreature,
    abilityPolicy: input.abilityPolicy,
  });
  if (ineligibilityReasons.length > 0) return null;

  const bridge = getLoadedRustMatchupBridge();
  if (!bridge) return null;

  const args = toRustComposableArgsFromCompare({
    sourceCreature: input.sourceCreature,
    opponentCreature: input.opponentCreature,
    finalA: input.finalA,
    finalB: input.finalB,
    activesOn: input.activesOn,
    breathOn: input.breathOn,
    abilityPolicy: input.abilityPolicy,
    initialStatusesA: input.initialStatusesA,
    initialStatusesB: input.initialStatusesB,
    activeCooldownMultiplierA: input.activeCooldownMultiplierA,
    activeCooldownMultiplierB: input.activeCooldownMultiplierB,
    disabledAbilitiesA: input.disabledAbilitiesA,
    disabledAbilitiesB: input.disabledAbilitiesB,
    perksA: input.perksA,
    perksB: input.perksB,
    firstTick: input.firstTick,
    noMoveFacetank: input.noMoveFacetank,
    posturePolicyA: input.posturePolicyA,
    posturePolicyB: input.posturePolicyB,
    badOmenOutcome: input.badOmenOutcome,
    compareAirRuleEnabled: input.compareAirRuleEnabled,
    compareAirRuleCooldownSec: input.compareAirRuleCooldownSec,
    compareBiteVariantModeA: input.compareBiteVariantModeA,
    compareBiteVariantModeB: input.compareBiteVariantModeB,
    combatEventOrder: input.combatEventOrder,
    abilityPolicyOverridesA: input.abilityPolicyOverridesA,
    abilityPolicyOverridesB: input.abilityPolicyOverridesB,
    userAbilityOverridesA: input.userAbilityOverridesA,
    userAbilityOverridesB: input.userAbilityOverridesB,
    userAbilityLevelsA: input.userAbilityLevelsA,
    userAbilityLevelsB: input.userAbilityLevelsB,
    compareDayNight: input.compareDayNight,
    compareMoon: input.compareMoon,
    weather: input.weather,
    attackerWeatherImmune: input.attackerWeatherImmune,
    defenderWeatherImmune: input.defenderWeatherImmune,
    attackerStorming: input.attackerStorming,
    defenderStorming: input.defenderStorming,
  });

  try {
    // Try the off-main-thread worker first. Posture policy makes
    // Compare sims expensive (engine-replay × 269 candidates × N
    // decisions); running the sync WASM call on the main thread
    // freezes the UI for seconds. The worker keeps the UI
    // responsive at the cost of one structured-clone round-trip
    // (~ms scale, dwarfed by the WASM sim itself).
    //
    // Falls back to a main-thread call when `Worker` is
    // unavailable (Node test env, older browser, worker
    // construction failed). Behaviour is identical, just
    // blocking, so the fallback preserves correctness.
    let rustSummary: unknown | null = null;
    try {
      rustSummary = await simulateCompareInWorker({
        attacker: args.attacker,
        defender: args.defender,
        attackerBreath: args.attackerBreath,
        defenderBreath: args.defenderBreath,
        abilityPolicy: args.abilityPolicy,
        abilityConfig: args.abilityConfig,
        maxTimeSec: input.maxTimeSec,
        recordTrace: true,
      });
    } catch (workerErr) {
       
      console.warn(
        `[rustCompareDispatch] worker sim failed (${String(workerErr)}); falling back to main-thread`,
      );
      rustSummary = null;
    }
    if (rustSummary === null) {
      rustSummary = bridge.simulateComposableMatchup(
        args.attacker,
        args.defender,
        args.attackerBreath,
        args.defenderBreath,
        args.abilityPolicy,
        args.abilityConfig,
        input.maxTimeSec,
        true,
      );
    }
    return adaptRustToSimulationSummary(rustSummary as RustMatchupSummary);
  } catch (err) {
     
    console.warn(
      `[rustCompareDispatch] simulate threw: ${err} attackerKeys=${JSON.stringify(Object.keys(args.attacker ?? {}))} attackerBreath=${typeof args.attackerBreath === "object" && args.attackerBreath ? "obj" : String(args.attackerBreath)} defenderBreath=${typeof args.defenderBreath === "object" && args.defenderBreath ? "obj" : String(args.defenderBreath)} policy=${JSON.stringify(args.abilityPolicy)}`,
    );
    return null;
  }
}
