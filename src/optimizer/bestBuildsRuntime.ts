import type { AbilityTimingMode, BuildOptions, CreatureRuntime, FinalStats } from "../engine";
import { RECOMMENDED_COMBAT_EVENT_ORDER, type CombatEventPhase } from "../engine/eventOrdering";
import { memoizedApplyRulesAndBuild } from "./bestBuildsOptimizations";
import type { BestBuildsMatchupSummary } from "./bestBuildsMatchupContract";
import type { RustComposableAbilityConfig } from "./rustMatchupBridge";
import {
  applyBbBuffsForSide,
  applyBbSpecialAbilitiesToFinalStats,
  applyBbTrapsTrailsToAbilityConfig,
  bbBroodwatcherStartingStatus,
  type BestBuildsExtraBuffs,
  type BestBuildsExtraCombatantStats,
  type BestBuildsExtraSpecialAbilities,
  type BestBuildsExtraTrapsTrails,
} from "./bestBuildsBattleSettingsBridge";
import {
  trySimulateRustComposableBreathBestBuildMatchup,
  trySimulateRustComposableMeleeBestBuildMatchup,
} from "./rustBestBuildsRuntime";
import { isRustMatchupBridgeDisabled } from "./rustMatchupLoader";

export const BEST_BUILDS_OPPONENT_BUILD: BuildOptions = {
  venerationStage: 5,
  traits: ["Damage", "Bite"],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
  plushies: ["Void", "Void"],
  elder: "Powerful",
};

// Stand-and-Fight: defender breaths that the Rust composable engine should
// dispatch as melee-only. Verified at fixture time that the listed defender
// breath produces no usable damage against the listed source - keeps the
// Rust melee path which is faster than the breath path.
const STAND_AND_FIGHT_NO_OP_DEFENDER_BREATH_BY_SOURCE_CREATURE = new Map<string, Set<string>>([
  [
    "Kendyll",
    new Set(["Geoptxina", "Mag'Masta", "Yohsog", "Lotremum", "Aidoneiscus", "Irizah"]),
  ],
]);

function isNoOpDefenderBreathForSourceCreature(
  sourceCreature: CreatureRuntime,
  opponentCreature: CreatureRuntime,
  finalA: FinalStats,
  finalB: FinalStats,
): boolean {
  if (finalA.hasBreath || !finalB.hasBreath) return false;
  const noOpDefenderBreaths = STAND_AND_FIGHT_NO_OP_DEFENDER_BREATH_BY_SOURCE_CREATURE.get(sourceCreature.name);
  return noOpDefenderBreaths?.has(opponentCreature.name) ?? false;
}

function removeBreathFromFinalStats(finalStats: FinalStats): FinalStats {
  return {
    ...finalStats,
    hasBreath: false,
    breathType: null,
  };
}

function buildSkippedBestBuildsSummary(maxTimeSec: number): BestBuildsMatchupSummary {
  return {
    winner: "Draw" as const,
    deathTimeA: null,
    maxTimeSec,
    dpsAtoB: 0,
    ttkAtoB: maxTimeSec,
    damageDealtA: 0,
    damageDealtAAtBDeath: 0,
    extendedDamagePotentialA: 0,
  };
}

export function buildBestBuildsOpponentFinal(
  opponentCreature: CreatureRuntime,
  opponentBaselineBuild: BuildOptions = BEST_BUILDS_OPPONENT_BUILD,
): FinalStats {
  // memoizedApplyRulesAndBuild keys by (twoFacedMode, creatureName, build), so
  // an extra WeakMap here would miss the mode dimension and serve stale stats
  // across toggles. Defer to memoized directly - it's already O(1).
  return memoizedApplyRulesAndBuild(opponentCreature, opponentBaselineBuild);
}

export function simulateBestBuildMatchup({
  sourceCreature,
  sourceBuild,
  finalA,
  opponentCreature,
  opponentBaselineBuild,
  activesOn,
  breathOn,
  maxTimeSec,
  abilityPolicy,
  combatEventOrder,
  extraAbilityConfig,
  extraCombatantStats,
  extraSpecialAbilities,
  extraBuffs,
  extraTrapsTrails,
}: {
  sourceCreature: CreatureRuntime;
  sourceBuild: BuildOptions;
  finalA: FinalStats;
  opponentCreature: CreatureRuntime;
  opponentBaselineBuild?: BuildOptions;
  activesOn: boolean;
  breathOn: boolean;
  maxTimeSec: number;
  abilityPolicy: AbilityTimingMode;
  combatEventOrder?: CombatEventPhase[];
  extraAbilityConfig?: Partial<RustComposableAbilityConfig>;
  extraCombatantStats?: BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: BestBuildsExtraSpecialAbilities;
  extraBuffs?: BestBuildsExtraBuffs;
  extraTrapsTrails?: BestBuildsExtraTrapsTrails;
}): BestBuildsMatchupSummary {
  return simulateBestBuildMatchupWithPath({
    sourceCreature,
    sourceBuild,
    finalA,
    opponentCreature,
    opponentBaselineBuild,
    activesOn,
    breathOn,
    maxTimeSec,
    abilityPolicy,
    combatEventOrder,
    extraAbilityConfig,
    extraCombatantStats,
    extraSpecialAbilities,
    extraBuffs,
    extraTrapsTrails,
  }).summary;
}

export function simulateBestBuildMatchupWithPath({
  sourceCreature,
  sourceBuild,
  finalA,
  opponentCreature,
  opponentBaselineBuild,
  activesOn,
  breathOn,
  maxTimeSec,
  abilityPolicy,
  combatEventOrder,
  extraAbilityConfig,
  extraCombatantStats,
  extraSpecialAbilities,
  extraBuffs,
  extraTrapsTrails,
}: {
  sourceCreature: CreatureRuntime;
  sourceBuild: BuildOptions;
  finalA: FinalStats;
  opponentCreature: CreatureRuntime;
  opponentBaselineBuild?: BuildOptions;
  activesOn: boolean;
  breathOn: boolean;
  maxTimeSec: number;
  abilityPolicy: AbilityTimingMode;
  combatEventOrder?: CombatEventPhase[];
  extraAbilityConfig?: Partial<RustComposableAbilityConfig>;
  extraCombatantStats?: BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: BestBuildsExtraSpecialAbilities;
  extraBuffs?: BestBuildsExtraBuffs;
  extraTrapsTrails?: BestBuildsExtraTrapsTrails;
}): {
  summary: BestBuildsMatchupSummary;
  path: string;
} {
  if (isRustMatchupBridgeDisabled()) {
    throw new Error(
      `Best Builds requires the Rust matchup bridge but it is disabled. source=${sourceCreature.name} opponent=${opponentCreature.name}`,
    );
  }

  const resolvedOpponentBaselineBuild = opponentBaselineBuild ?? BEST_BUILDS_OPPONENT_BUILD;
  const finalB = buildBestBuildsOpponentFinal(opponentCreature, resolvedOpponentBaselineBuild);
  const hasNoOpDefenderBreath = isNoOpDefenderBreathForSourceCreature(
    sourceCreature,
    opponentCreature,
    finalA,
    finalB,
  );
  const actualBreathFight =
    breathOn &&
    (finalA.hasBreath || finalB.hasBreath) &&
    !hasNoOpDefenderBreath;
  const routedFinalB = hasNoOpDefenderBreath ? removeBreathFromFinalStats(finalB) : finalB;
  const resolvedCombatEventOrder = combatEventOrder ?? RECOMMENDED_COMBAT_EVENT_ORDER;

  // Per-side Specific/Disputed: FinalStats mutations + Broodwatcher
  // starting status. Mirrors `applyCompareSpecialAbilities` +
  // `buildCompareInitialStatuses` in useCompareSimulation so BB / Compare
  // share the same per-side modifier semantics. No-op when the channel
  // is undefined.
  let mutatedFinalA = extraSpecialAbilities?.source
    ? applyBbSpecialAbilitiesToFinalStats(finalA, sourceCreature, extraSpecialAbilities.source)
    : finalA;
  let mutatedFinalB = extraSpecialAbilities?.opponent
    ? applyBbSpecialAbilitiesToFinalStats(routedFinalB, opponentCreature, extraSpecialAbilities.opponent)
    : routedFinalB;
  const sourceBroodStatus = extraSpecialAbilities?.source
    ? bbBroodwatcherStartingStatus(sourceCreature, extraSpecialAbilities.source)
    : null;
  const opponentBroodStatus = extraSpecialAbilities?.opponent
    ? bbBroodwatcherStartingStatus(opponentCreature, extraSpecialAbilities.opponent)
    : null;
  let postBroodSource = sourceBroodStatus
    ? {
        ...(extraCombatantStats?.source ?? {}),
        startingStatuses: [
          ...(extraCombatantStats?.source?.startingStatuses ?? []),
          sourceBroodStatus,
        ],
      }
    : extraCombatantStats?.source;
  let postBroodOpponent = opponentBroodStatus
    ? {
        ...(extraCombatantStats?.opponent ?? {}),
        startingStatuses: [
          ...(extraCombatantStats?.opponent?.startingStatuses ?? []),
          opponentBroodStatus,
        ],
      }
    : extraCombatantStats?.opponent;

  // Per-side Buffs + Day/Night + Moon: reuse Compare's
  // `applyCompareBuffRuntime` so BB's per-matchup FinalStats / starting
  // statuses / active-cooldown multiplier match Compare exactly. Build
  // is plumbed in for both sides (sourceBuild = build being optimized,
  // opponentBaselineBuild = opponent pool baseline) so plushie-variant
  // logic (Bear Aggressive/Scared, Land Muddy, Eclipse night) fires
  // identically to Compare.
  if (extraBuffs?.source) {
    const result = applyBbBuffsForSide(
      mutatedFinalA,
      extraBuffs.source,
      extraBuffs.dayNight,
      extraBuffs.moon,
      sourceBuild,
    );
    mutatedFinalA = result.finalStats;
    if (result.initialStatuses.length > 0) {
      const converted = result.initialStatuses.map((opt) => ({
        statusId: opt.statusId,
        stacks: Math.max(1, Math.floor(opt.remainingSec ?? 1)),
        stackValueMode: "durationOnly" as const,
        sourceAbility: opt.sourceAbilityName ?? null,
      }));
      postBroodSource = {
        ...(postBroodSource ?? {}),
        startingStatuses: [
          ...(postBroodSource?.startingStatuses ?? []),
          ...converted,
        ],
      };
    }
    if (result.activeCooldownMultiplier !== 1) {
      const current = postBroodSource?.activeCooldownMultiplier ?? 1;
      postBroodSource = {
        ...(postBroodSource ?? {}),
        activeCooldownMultiplier: current * result.activeCooldownMultiplier,
      };
    }
  }
  if (extraBuffs?.opponent) {
    const result = applyBbBuffsForSide(
      mutatedFinalB,
      extraBuffs.opponent,
      extraBuffs.dayNight,
      extraBuffs.moon,
      resolvedOpponentBaselineBuild,
    );
    mutatedFinalB = result.finalStats;
    if (result.initialStatuses.length > 0) {
      const converted = result.initialStatuses.map((opt) => ({
        statusId: opt.statusId,
        stacks: Math.max(1, Math.floor(opt.remainingSec ?? 1)),
        stackValueMode: "durationOnly" as const,
        sourceAbility: opt.sourceAbilityName ?? null,
      }));
      postBroodOpponent = {
        ...(postBroodOpponent ?? {}),
        startingStatuses: [
          ...(postBroodOpponent?.startingStatuses ?? []),
          ...converted,
        ],
      };
    }
    if (result.activeCooldownMultiplier !== 1) {
      const current = postBroodOpponent?.activeCooldownMultiplier ?? 1;
      postBroodOpponent = {
        ...(postBroodOpponent ?? {}),
        activeCooldownMultiplier: current * result.activeCooldownMultiplier,
      };
    }
  }

  const mergedExtraCombatantStats: BestBuildsExtraCombatantStats | undefined =
    postBroodSource || postBroodOpponent
      ? { source: postBroodSource, opponent: postBroodOpponent }
      : extraCombatantStats;

  // Per-side Traps & Trails toggles: traps=false forces the three
  // trap booleans off (overrides BB's presence-based default); trails
  // =true resolves per-creature trail damage values via the spec.
  // Applied as an overlay on top of `extraAbilityConfig` since the
  // Rust runtime path uses `extraAbilityConfig` as the per-matchup
  // override layer.
  const derivedExtraAbilityConfig = applyBbTrapsTrailsToAbilityConfig(
    extraAbilityConfig,
    sourceCreature,
    opponentCreature,
    extraTrapsTrails,
  );

  // Composable engine: the ONLY dispatcher for Best Builds matchups.
  // Covers all 22 activated abilities + breath + melee + status + life-leech
  // paths in a single event loop. Verified 0/26520 fallback pairs at the time
  // the legacy TS fallback was retired.
  if (actualBreathFight) {
    const rustComposableBreathSummary = trySimulateRustComposableBreathBestBuildMatchup({
      sourceCreature,
      opponentCreature,
      finalA: mutatedFinalA,
      finalB: mutatedFinalB,
      activesOn,
      maxTimeSec,
      abilityPolicy,
      combatEventOrder: resolvedCombatEventOrder,
      extraAbilityConfig: derivedExtraAbilityConfig,
      extraCombatantStats: mergedExtraCombatantStats,
    });
    if (rustComposableBreathSummary) return { summary: rustComposableBreathSummary, path: "composable_breath" };
  } else {
    const rustComposableMeleeSummary = trySimulateRustComposableMeleeBestBuildMatchup({
      sourceCreature,
      opponentCreature,
      finalA: mutatedFinalA,
      finalB: mutatedFinalB,
      activesOn,
      maxTimeSec,
      abilityPolicy,
      combatEventOrder: resolvedCombatEventOrder,
      extraAbilityConfig: derivedExtraAbilityConfig,
      extraCombatantStats: mergedExtraCombatantStats,
    });
    if (rustComposableMeleeSummary) return { summary: rustComposableMeleeSummary, path: "composable_melee" };
  }

  console.warn(
    [
      "Best Builds Rust routing is missing for this matchup.",
      `source=${sourceCreature.name}`,
      `opponent=${opponentCreature.name}`,
      `activesOn=${activesOn ? "1" : "0"}`,
      `breathOn=${breathOn ? "1" : "0"}`,
      `actualBreathFight=${actualBreathFight ? "1" : "0"}`,
    ].join(" "),
  );
  return {
    summary: buildSkippedBestBuildsSummary(maxTimeSec),
    path: "rust_missing_skipped",
  };
}
