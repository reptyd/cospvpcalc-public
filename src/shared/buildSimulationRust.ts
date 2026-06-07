import { applyRulesAndBuild } from "../engine";
import type {
  AbilityTimingMode,
  BuildOptions,
  CreatureRuntime,
  FinalStats,
  SimulationSummary,
} from "../engine";
import { trySimulateRustCompareMatchup } from "../optimizer/rustCompareDispatch";
import type { CompareSidePerks } from "../optimizer/rustCompareMatchupRuntime";
import { RECOMMENDED_COMBAT_EVENT_ORDER, type CombatEventPhase } from "../engine/eventOrdering";

// Async Rust-backed matchup helper used by Best Builds pre-stage scoring
// (optimizerContext + plushie baseline/impact) and Compare BuildDetails
// "Explain Math" analysis. Wraps trySimulateRustCompareMatchup with neutral
// CompareSidePerks and a synth dummy CreatureRuntime when only finalB is
// provided. Returns null when Rust declines (unsupported abilities) - each
// caller decides whether to throw, fall back, or skip.

const NEUTRAL_PERKS: CompareSidePerks = {
  traps: false,
  trails: false,
  powerCharge: false,
  goreCharge: false,
  startingSpiteCharged: false,
  muddyBuff: false,
  hungerRule: false,
  gourmandizer: false,
  startingHungerUnits: 0,
  appetiteBaseUnits: 100,
  defiledGroundLevel: 0,
  defiledGroundWeakness: false,
  appetiteDrainMultiplier: 1,
  healingPulseEnabled: false,
  healingPulseOnce: false,
  expungeEnabled: false,
  wardenRageStartHpPct: 0,
};

// Synthetic stub used when only finalB is provided (dummy opponent). Rust
// dispatch reads creature.passive/activatedAbilities (empty) and
// effectsCatalog[creature.name] (no entry → {}), so a stub with empty
// ability lists runs a stat-only fight.
const SYNTH_OPPONENT_CREATURE: CreatureRuntime = {
  name: "__buildSimulationRustDummy__",
  stats: { tier: 1, health: 1, weight: 1, damage: 1, biteCooldown: 1 },
  passiveAbilities: [],
  activatedAbilities: [],
  breathAbilities: [],
};

const DEFAULT_MAX_TIME_SEC = 900;

export type SimulateBuildMatchupRustOptions = {
  activesOn?: boolean;
  breathOn?: boolean;
  maxTimeSec?: number;
  abilityPolicy?: AbilityTimingMode;
  disabledAbilitiesA?: string[];
  disabledAbilitiesB?: string[];
  combatEventOrder?: CombatEventPhase[];
};

export async function simulateBuildMatchupViaRust({
  creatureA,
  buildA,
  creatureB,
  buildB,
  finalB,
  options,
}: {
  creatureA: CreatureRuntime;
  buildA: BuildOptions;
  creatureB?: CreatureRuntime;
  buildB?: BuildOptions;
  finalB?: FinalStats;
  options?: SimulateBuildMatchupRustOptions;
}): Promise<{ finalA: FinalStats; finalB: FinalStats; summary: SimulationSummary } | null> {
  const resolvedFinalA = applyRulesAndBuild(creatureA, buildA);
  const resolvedFinalB =
    finalB ??
    (creatureB && buildB
      ? applyRulesAndBuild(creatureB, buildB)
      : (() => {
          throw new Error("simulateBuildMatchupViaRust requires either finalB or creatureB/buildB");
        })());

  const opponentCreature = creatureB ?? SYNTH_OPPONENT_CREATURE;
  const summary = await trySimulateRustCompareMatchup({
    sourceCreature: creatureA,
    opponentCreature,
    finalA: resolvedFinalA,
    finalB: resolvedFinalB,
    activesOn: options?.activesOn ?? true,
    breathOn: options?.breathOn ?? true,
    abilityPolicy: options?.abilityPolicy ?? "ideal",
    initialStatusesA: [],
    initialStatusesB: [],
    activeCooldownMultiplierA: 1,
    activeCooldownMultiplierB: 1,
    disabledAbilitiesA: options?.disabledAbilitiesA ?? [],
    disabledAbilitiesB: options?.disabledAbilitiesB ?? [],
    perksA: NEUTRAL_PERKS,
    perksB: NEUTRAL_PERKS,
    firstTick: { mode: "off", delaySec: 0 },
    noMoveFacetank: true,
    compareAirRuleEnabled: false,
    compareAirRuleCooldownSec: 0,
    compareBiteVariantModeA: "primaryOnly",
    compareBiteVariantModeB: "primaryOnly",
    badOmenOutcome: null,
    maxTimeSec: options?.maxTimeSec ?? DEFAULT_MAX_TIME_SEC,
    combatEventOrder: options?.combatEventOrder ?? RECOMMENDED_COMBAT_EVENT_ORDER,
  });

  if (!summary) return null;
  return { finalA: resolvedFinalA, finalB: resolvedFinalB, summary };
}
