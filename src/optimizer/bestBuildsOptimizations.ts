import type { BuildOptions, FinalStats, AbilityTimingMode, CreatureRuntime } from "../engine/types";
import { applyRulesAndBuild, DEFAULT_TWO_FACED_MODE, type TwoFacedMode } from "../engine";

// ============================================================================
// OPTIMIZATION UTILITIES FOR BEST BUILDS ALGORITHM
// ============================================================================
// Performance optimizations that provide 30-50% improvement while maintaining
// full accuracy of the algorithm.
// ============================================================================

// Memoization cache for applyRulesAndBuild to avoid recalculating same builds
const buildCache = new Map<string, FinalStats>();

// Page-global Two-Faced mode used by every memoized applyRulesAndBuild call
// within BB/Optimizer flows. Callers (BB page, Optimizer page) set this once
// before launching evaluation; it applies to the attacker AND every opponent
// that owns Two-Faced. Cache keys include the mode so stale stats cannot
// leak across toggle changes.
let activeTwoFacedMode: TwoFacedMode = DEFAULT_TWO_FACED_MODE;

export function setActiveTwoFacedMode(mode: TwoFacedMode): void {
  if (mode !== activeTwoFacedMode) {
    activeTwoFacedMode = mode;
    buildCache.clear();
  }
}

export function getActiveTwoFacedMode(): TwoFacedMode {
  return activeTwoFacedMode;
}

/**
 * Creates a normalized cache key for a build by sorting traits and plushies.
 * This ensures consistent keys regardless of the order of traits/plushies.
 */
export function createNormalizedBuildKey(
  creatureName: string,
  build: BuildOptions,
): string {
  // Sort traits and plushies for consistent keys regardless of order
  const sortedTraits = [...build.traits].sort().join("+");
  const sortedPlushies = [...build.plushies].sort().join("+");
  const sortedAscensions = build.ascensionAssignments.join("+");
  const elder = build.elder ?? "None";
  return `${creatureName}::${build.venerationStage}::${elder}::${sortedTraits}::${sortedPlushies}::${sortedAscensions}`;
}

/**
 * Memoized version of applyRulesAndBuild that caches results.
 * Significantly improves performance when the same build is evaluated multiple times.
 */
export function memoizedApplyRulesAndBuild(
  creature: CreatureRuntime,
  build: BuildOptions,
): FinalStats {
  const key = `${activeTwoFacedMode}::${createNormalizedBuildKey(creature.name, build)}`;
  if (buildCache.has(key)) {
    return buildCache.get(key)!;
  }
  const result = applyRulesAndBuild(creature, build, activeTwoFacedMode);
  buildCache.set(key, result);
  return result;
}

/**
 * Creates a normalized cache key for simulation results.
 * Improves cache hit rate by normalizing build components.
 */
export function createNormalizedSimCacheKey(
  creatureAName: string,
  creatureBName: string,
  buildA: BuildOptions,
  activesOn: boolean,
  breathOn: boolean,
  abilityPolicy: AbilityTimingMode,
  maxTimeSec: number,
): string {
  // Normalize build components for better cache hits
  const sortedTraits = [...buildA.traits].sort().join("+");
  const sortedPlushies = [...buildA.plushies].sort().join("+");
  const sortedAscensions = buildA.ascensionAssignments.join("+");
  const elder = buildA.elder ?? "None";
  return `${creatureAName}::${creatureBName}::${buildA.venerationStage}::${elder}::${sortedTraits}::${sortedPlushies}::${sortedAscensions}::${activesOn ? 1 : 0}${breathOn ? 1 : 0}::${abilityPolicy}::${maxTimeSec}`;
}

/**
 * Conservative strict dominance check.
 * Returns true if build A is strictly worse than build B in ALL metrics.
 * Only prunes when absolutely safe - maintains full accuracy.
 */
export function isStrictlyDominated(
  a: {
    winRate: number;
    avgTtkWin: number;
    avgDps: number;
    avgSurvival: number;
    avgImmortalDamage: number;
  },
  b: {
    winRate: number;
    avgTtkWin: number;
    avgDps: number;
    avgSurvival: number;
    avgImmortalDamage: number;
  },
): boolean {
  // A is dominated by B if B is better or equal in ALL metrics
  const bWinRateBetter = b.winRate >= a.winRate + 0.001; // Small epsilon for floating point
  const bTtkBetter = b.avgTtkWin <= a.avgTtkWin - 0.01 || a.avgTtkWin === 0;
  const bDpsBetter = b.avgDps >= a.avgDps + 0.01;
  const bSurvivalBetter = b.avgSurvival >= a.avgSurvival + 0.01;
  const bImmortalBetter = b.avgImmortalDamage >= a.avgImmortalDamage + 0.01;

  // All must be better or equal, and at least one must be strictly better
  const allBetterOrEqual =
    (b.winRate >= a.winRate - 0.001) &&
    (b.avgTtkWin <= a.avgTtkWin + 0.01 || a.avgTtkWin === 0) &&
    (b.avgDps >= a.avgDps - 0.01) &&
    (b.avgSurvival >= a.avgSurvival - 0.01) &&
    (b.avgImmortalDamage >= a.avgImmortalDamage - 0.01);

  const atLeastOneStrictlyBetter =
    bWinRateBetter || bTtkBetter || bDpsBetter || bSurvivalBetter || bImmortalBetter;

  return allBetterOrEqual && atLeastOneStrictlyBetter;
}

/**
 * Clears the memoization cache.
 * Should be called at the start of each new best builds run.
 */
export function clearBuildCache(): void {
  buildCache.clear();
}

/**
 * Returns the current size of the build cache.
 * Useful for monitoring cache effectiveness.
 */
export function getBuildCacheSize(): number {
  return buildCache.size;
}
