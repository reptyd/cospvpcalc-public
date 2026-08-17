import type { AbilityTimingMode, BuildOptions, CreatureRuntime, FinalStats } from "../engine";
import { RECOMMENDED_COMBAT_EVENT_ORDER, type CombatEventPhase } from "../engine/eventOrdering";
import { memoizedApplyRulesAndBuild } from "./bestBuildsOptimizations";
import type { BestBuildsMatchupSummary } from "./bestBuildsMatchupContract";
import type {
  RustComposableAbilityConfig,
  RustSimpleBreathProfile,
  RustSimpleCombatantStats,
} from "./rustMatchupBridge";
import {
  applyBbBuffsForSide,
  applyBbDefiledGroundToAbilityConfig,
  applyBbSpecialAbilitiesToFinalStats,
  applyBbTrapsTrailsToAbilityConfig,
  bbBroodwatcherStartingStatus,
  buildBreathPolicyDefaults,
  type BestBuildsExtraBuffs,
  type BestBuildsExtraCombatantStats,
  type BestBuildsExtraSpecialAbilities,
  type BestBuildsExtraTrapsTrails,
} from "./bestBuildsBattleSettingsBridge";
import {
  buildBestBuildsMatchupConfig,
  isBestBuildsBatchAvailable,
  isRustComposableBreathEligible,
  isRustComposableMeleeEligible,
  simulateBestBuildMatchupBatch,
  toBestBuildsCombatantStats,
  toRustAbilityTimingMode,
  toRustBreathProfile,
  trySimulateRustComposableBreathBestBuildMatchup,
  trySimulateRustComposableMeleeBestBuildMatchup,
} from "./rustBestBuildsRuntime";
import { isRustMatchupBridgeDisabled } from "./rustMatchupLoader";
import { toStartingStatuses } from "./rustCompareMatchupRuntime";

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

/**
 * Resolve whether a Best Builds matchup runs the breath path and what the
 * opponent's final stats look like after the stand-and-fight no-op-breath rule.
 * Extracted so the funnel's pin-capture / pinned-replay feed the composable
 * engine the SAME routed opponent stats and breath decision as the exact
 * `simulateBestBuildMatchupWithPath` fight - otherwise a captured schedule would
 * replay against different inputs than the ideal reference.
 */
export function resolveBestBuildOpponentRouting({
  sourceCreature,
  opponentCreature,
  finalA,
  finalB,
  breathOn,
}: {
  sourceCreature: CreatureRuntime;
  opponentCreature: CreatureRuntime;
  finalA: FinalStats;
  finalB: FinalStats;
  breathOn: boolean;
}): { breathFight: boolean; routedFinalB: FinalStats } {
  const hasNoOpDefenderBreath = isNoOpDefenderBreathForSourceCreature(
    sourceCreature,
    opponentCreature,
    finalA,
    finalB,
  );
  const breathFight = breathOn && (finalA.hasBreath || finalB.hasBreath) && !hasNoOpDefenderBreath;
  const routedFinalB = hasNoOpDefenderBreath ? removeBreathFromFinalStats(finalB) : finalB;
  return { breathFight, routedFinalB };
}

/**
 * The per-matchup override layer the Rust runtime path reads. Three
 * creature-dependent resolutions live here because they need both fighters:
 *  - breath firing policy: the creature-derived default (chain breaths burst
 *    off a full bar) goes in FIRST, so an explicit per-side pick coming
 *    through `extraAbilityConfig` still wins;
 *  - Traps & Trails toggles: traps=false forces the three trap booleans off
 *    (overrides BB's presence-based default), trails=true resolves
 *    per-creature trail damage values via the spec;
 *  - Defiled Ground: the pool-wide level survives only on a side that owns
 *    the ability, and the side facing an owner takes the Sickly weakness.
 */
function deriveAbilityConfigOverrides(
  sourceCreature: CreatureRuntime,
  opponentCreature: CreatureRuntime,
  extraAbilityConfig: Partial<RustComposableAbilityConfig> | undefined,
  extraTrapsTrails: BestBuildsExtraTrapsTrails | undefined,
  screenFortifyFast?: boolean,
): Partial<RustComposableAbilityConfig> {
  const applied = applyBbDefiledGroundToAbilityConfig(
    applyBbTrapsTrailsToAbilityConfig(
      extraAbilityConfig,
      sourceCreature,
      opponentCreature,
      extraTrapsTrails,
    ),
    sourceCreature,
    opponentCreature,
  );
  return {
    ...buildBreathPolicyDefaults(sourceCreature, opponentCreature),
    ...applied,
    // Screening only. Fortify's search re-plans against a forked projection of
    // the rest of the fight and dominates a Best Builds run's cost; on the
    // screen we only need the ability to fire somewhere sane, which its
    // ReallyFast gate does for free. The displayed builds are re-fought with
    // the caller's real policy afterwards.
    ...(screenFortifyFast
      ? {
          attackerAbilityPolicyOverrides: {
            ...applied?.attackerAbilityPolicyOverrides,
            Fortify: "reallyFast" as const,
          },
          defenderAbilityPolicyOverrides: {
            ...applied?.defenderAbilityPolicyOverrides,
            Fortify: "reallyFast" as const,
          },
        }
      : null),
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
  screenFortifyFast,
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
  screenFortifyFast?: boolean;
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
      const converted = toStartingStatuses(result.initialStatuses);
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
      const converted = toStartingStatuses(result.initialStatuses);
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

  const derivedExtraAbilityConfig = deriveAbilityConfigOverrides(
    sourceCreature,
    opponentCreature,
    extraAbilityConfig,
    extraTrapsTrails,
    screenFortifyFast,
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

export type BestBuildsRectangleBuild = {
  build: BuildOptions;
  finalA: FinalStats;
  activesOn: boolean;
  breathOn: boolean;
};

export type BestBuildsRectangleCell = {
  summary: BestBuildsMatchupSummary;
  path: string;
};

function pushBreathProfile(
  pool: RustSimpleBreathProfile[],
  profile: RustSimpleBreathProfile | null,
): number {
  if (!profile) return -1;
  pool.push(profile);
  return pool.length - 1;
}

/**
 * Score a whole (build x opponent) rectangle through the batched WASM entry
 * point. Rows follow `builds`, columns follow `opponentCreatures`.
 *
 * A screen-stage fight is short enough that marshalling it dominates, and the
 * rectangle is where the redundancy is: one attacker serves every column, one
 * opponent every row. So each distinct input is marshalled and crossed once and
 * the engine is handed an index stream.
 *
 * Battle-settings extras are deliberately not accepted. They are the only thing
 * that makes the ability config depend on the BUILD - weather immunity reads
 * plushie-granted Frosty off `FinalStats` - and without them the config is a
 * function of the creature pair and `activesOn`, which is what lets one config
 * serve a whole column. Callers carrying extras stay on the per-matchup path.
 *
 * Returns null when the loaded WASM bundle predates the batch export.
 */
export function simulateBestBuildMatchupRectangle({
  sourceCreature,
  builds,
  opponentCreatures,
  opponentBaselineBuild,
  maxTimeSec,
  abilityPolicy,
  combatEventOrder,
  screenFortifyFast,
}: {
  sourceCreature: CreatureRuntime;
  builds: readonly BestBuildsRectangleBuild[];
  opponentCreatures: readonly CreatureRuntime[];
  opponentBaselineBuild?: BuildOptions;
  maxTimeSec: number;
  abilityPolicy: AbilityTimingMode;
  combatEventOrder?: CombatEventPhase[];
  screenFortifyFast?: boolean;
}): BestBuildsRectangleCell[][] | null {
  if (isRustMatchupBridgeDisabled()) {
    throw new Error(
      `Best Builds requires the Rust matchup bridge but it is disabled. source=${sourceCreature.name}`,
    );
  }
  if (!isBestBuildsBatchAvailable()) return null;

  const resolvedOpponentBaselineBuild = opponentBaselineBuild ?? BEST_BUILDS_OPPONENT_BUILD;
  const resolvedCombatEventOrder = combatEventOrder ?? RECOMMENDED_COMBAT_EVENT_ORDER;

  const attackers = builds.map((entry) =>
    toBestBuildsCombatantStats(sourceCreature, entry.finalA, entry.activesOn),
  );
  const attackerBreaths: RustSimpleBreathProfile[] = [];
  const attackerBreathIndex = builds.map((entry) =>
    pushBreathProfile(attackerBreaths, toRustBreathProfile(entry.finalA)),
  );
  const opponentFinals = opponentCreatures.map((creature) =>
    buildBestBuildsOpponentFinal(creature, resolvedOpponentBaselineBuild),
  );

  const defenders: RustSimpleCombatantStats[] = [];
  const defenderBreaths: RustSimpleBreathProfile[] = [];
  const configs: RustComposableAbilityConfig[] = [];
  // One column entry per (opponent, activesOn, breath-stripped) combination -
  // everything the defender side and the config can vary by inside a rectangle.
  const columns = new Map<string, { defender: number; defenderBreath: number; config: number }>();

  const fights: number[] = [];
  const batched: { row: number; column: number; path: string }[] = [];
  const perMatchup: { row: number; column: number }[] = [];

  for (let row = 0; row < builds.length; row += 1) {
    const { finalA, activesOn, breathOn } = builds[row];
    for (let column = 0; column < opponentCreatures.length; column += 1) {
      const opponentCreature = opponentCreatures[column];
      const finalB = opponentFinals[column];
      const { breathFight, routedFinalB } = resolveBestBuildOpponentRouting({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        breathOn,
      });
      const eligible = breathFight
        ? isRustComposableBreathEligible({
            sourceCreature,
            opponentCreature,
            finalA,
            finalB: routedFinalB,
            activesOn,
            abilityPolicy,
          })
        : isRustComposableMeleeEligible({
            sourceCreature,
            opponentCreature,
            finalA,
            finalB: routedFinalB,
            abilityPolicy,
          });
      if (!eligible) {
        // Rare; let the per-matchup path own the diagnostic and the skipped summary.
        perMatchup.push({ row, column });
        continue;
      }

      const columnKey = `${column}|${activesOn ? 1 : 0}|${routedFinalB === finalB ? 0 : 1}`;
      let pooled = columns.get(columnKey);
      if (!pooled) {
        pooled = {
          defender:
            defenders.push(toBestBuildsCombatantStats(opponentCreature, routedFinalB, activesOn)) - 1,
          defenderBreath: pushBreathProfile(defenderBreaths, toRustBreathProfile(routedFinalB)),
          config:
            configs.push(
              buildBestBuildsMatchupConfig({
                sourceCreature,
                opponentCreature,
                finalA,
                finalB: routedFinalB,
                activesOn,
                combatEventOrder: resolvedCombatEventOrder,
                extraAbilityConfig: deriveAbilityConfigOverrides(
                  sourceCreature,
                  opponentCreature,
                  undefined,
                  undefined,
                  screenFortifyFast,
                ),
              }),
            ) - 1,
        };
        columns.set(columnKey, pooled);
      }

      fights.push(
        row,
        pooled.defender,
        breathFight ? attackerBreathIndex[row] : -1,
        breathFight ? pooled.defenderBreath : -1,
        pooled.config,
      );
      batched.push({ row, column, path: breathFight ? "composable_breath" : "composable_melee" });
    }
  }

  let summaries: BestBuildsMatchupSummary[] = [];
  if (fights.length > 0) {
    const returned = simulateBestBuildMatchupBatch({
      attackers,
      defenders,
      attackerBreaths,
      defenderBreaths,
      configs,
      abilityPolicy: toRustAbilityTimingMode(abilityPolicy),
      maxTimeSec,
      fights,
    });
    if (!returned || returned.length !== batched.length) return null;
    summaries = returned;
  }

  const grid: BestBuildsRectangleCell[][] = builds.map(() =>
    new Array<BestBuildsRectangleCell>(opponentCreatures.length),
  );
  for (let i = 0; i < batched.length; i += 1) {
    const { row, column, path } = batched[i];
    grid[row][column] = { summary: summaries[i], path };
  }
  for (const { row, column } of perMatchup) {
    grid[row][column] = simulateBestBuildMatchupWithPath({
      sourceCreature,
      sourceBuild: builds[row].build,
      finalA: builds[row].finalA,
      opponentCreature: opponentCreatures[column],
      opponentBaselineBuild: resolvedOpponentBaselineBuild,
      activesOn: builds[row].activesOn,
      breathOn: builds[row].breathOn,
      maxTimeSec,
      abilityPolicy,
      combatEventOrder,
      screenFortifyFast,
    });
  }
  return grid;
}
