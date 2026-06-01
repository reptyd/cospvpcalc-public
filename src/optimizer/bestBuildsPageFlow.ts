import type { AbilityTimingMode, BuildOptions, CreatureRuntime, TwoFacedMode } from "../engine";
import type { BestBuildsBattleSettings } from "../components/bestBuilds/bestBuildsBattleSettingsTypes";
import {
  buildBestBuildsExtraAbilityConfig,
  buildBestBuildsExtraBuffs,
  buildBestBuildsExtraCombatantStats,
  buildBestBuildsExtraSpecialAbilities,
  buildBestBuildsExtraTrapsTrails,
  buildBestBuildsOpponentBaselineBuild,
} from "./bestBuildsBattleSettingsBridge";
import { clearBuildCache, setActiveTwoFacedMode } from "./bestBuildsOptimizations";
import { enumerateAssignmentsCounts } from "./candidateGeneration";
import { applyConstraintLocks, sanitizeBuildForExclusions } from "./constraintBuilds";
import {
  type BestBuildAggregateResult,
  buildSkeletonsFromCandidates,
} from "./bestBuildsFlow";
import { executeBestBuildsSearch, type BestBuildsRuntimePathTelemetry, type BestBuildsStageTimings } from "./bestBuildsPageExecution";
import { loadPerOpponentRows, type BestBuildPerOpponentRow } from "./bestBuildsPerOpponentRows";
import { BEST_BUILDS_OPPONENT_BUILD } from "./bestBuildsRuntime";
import { createOptimizerCandidates } from "./optimizerFacade";
import { buildAdaptiveQuickOpponents } from "./poolUtils";
import type { BestBuildAggregateObjective } from "./ranking";
import type { CombatEventPhase } from "../engine/eventOrdering";

export const bestBuildsOpponentBuild: BuildOptions = BEST_BUILDS_OPPONENT_BUILD;
export type { BestBuildPerOpponentRow } from "./bestBuildsPerOpponentRows";
export type { BestBuildsStageTimings } from "./bestBuildsPageExecution";
export type { BestBuildsRuntimePathTelemetry } from "./bestBuildsPageExecution";

export function formatBuildHeaderLines(item: BestBuildAggregateResult, idx: number, nameA: string, ascensionSummary: string): string[] {
  const plushieLine = item.build.plushies.join("/") || "No plushie";
  const ascensionLine = ascensionSummary
    .split(",")
    .map((part) => formatAscensionToken(part))
    .join("/");
  return [
    nameA,
    `#${idx + 1}/${formatTopLine(item)}`,
    item.build.elder && item.build.elder !== "None" ? item.build.elder : "No elder",
    plushieLine,
    ascensionLine,
    "provided by Sonaria Stat Lab",
  ];
}

function formatTopLine(item: BestBuildAggregateResult): string {
  const aggregate = item.aggregate;
  return `${(aggregate.winRate * 100).toFixed(1)}%WR/${aggregate.avgDps.toFixed(0)}DPS`;
}

function formatAscensionToken(part: string): string {
  const [rawTrait, rawCount] = part.trim().split("=");
  const count = rawCount?.trim() ?? "0";
  const trait = rawTrait?.trim() ?? "";
  return `${compactTraitLabel(trait)}${count}`;
}

function compactTraitLabel(trait: string): string {
  const words = trait
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) {
    const word = words[0];
    return word.length <= 4 ? word : word.slice(0, 3);
  }
  return words.map((word) => word[0]?.toUpperCase() ?? "").join("");
}

export async function runBestBuildsFlow({
  creature,
  activePool,
  searchDepth,
  objective,
  winRateGuardPct,
  targetConstraints,
  targetTraitLock,
  targetAscensionLock,
  targetPlushieLock,
  targetElderLock,
  excludedTraits,
  excludedPlushies,
  showAllAscensionDistributions,
  earlyPruning,
  onProgress,
  onPartialResults,
  cancelRef,
  twoFacedMode,
  combatEventOrder,
  battleSettings,
}: {
  creature: CreatureRuntime;
  activePool: string[];
  searchDepth: "soft" | "detailed";
  objective: BestBuildAggregateObjective;
  winRateGuardPct: number;
  targetConstraints: BuildOptions;
  targetTraitLock: boolean;
  targetAscensionLock: boolean;
  targetPlushieLock: boolean;
  targetElderLock?: boolean;
  excludedTraits: string[];
  excludedPlushies: string[];
  showAllAscensionDistributions: boolean;
  earlyPruning: boolean;
  onProgress: (value: number) => void;
  onPartialResults: (results: BestBuildAggregateResult[]) => void;
  cancelRef: { current: boolean };
  twoFacedMode?: TwoFacedMode;
  combatEventOrder?: CombatEventPhase[];
  battleSettings?: BestBuildsBattleSettings;
}): Promise<{ results: BestBuildAggregateResult[]; elapsedMs: number; timings: BestBuildsStageTimings & { candidatePrepMs: number }; runtimePathTelemetry: BestBuildsRuntimePathTelemetry }> {
  if (twoFacedMode) setActiveTwoFacedMode(twoFacedMode);
  clearBuildCache();
  const startedAt = performance.now();
  const quickPool = buildAdaptiveQuickOpponents(activePool, Math.min(searchDepth === "soft" ? 16 : 26, activePool.length));
  const quality = searchDepth === "soft" ? "balanced" : "quality";
  const stage1TopK = searchDepth === "soft" ? 140 : 260;
  const stage2Cap = searchDepth === "soft" ? 60 : 110;
  const stage1InputCap = searchDepth === "soft" ? 140 : 260;
  const quickAbilityPolicy: AbilityTimingMode = "fast";
  const stage2AbilityPolicy: AbilityTimingMode = "ideal";
  const refinementAbilityPolicy: AbilityTimingMode = battleSettings?.global.abilityTimingMode ?? "ideal";
  const extraAbilityConfig = buildBestBuildsExtraAbilityConfig(battleSettings);
  const extraCombatantStats = buildBestBuildsExtraCombatantStats(battleSettings);
  const extraSpecialAbilities = buildBestBuildsExtraSpecialAbilities(battleSettings);
  const extraBuffs = buildBestBuildsExtraBuffs(battleSettings);
  const extraTrapsTrails = buildBestBuildsExtraTrapsTrails(battleSettings);
  const opponentBaselineBuild = buildBestBuildsOpponentBaselineBuild(battleSettings);

  const normalizedTargetConstraints = sanitizeBuildForExclusions(
    applyConstraintLocks({
      targetConstraints,
      targetTraitLock,
      targetAscensionLock,
      targetPlushieLock,
      targetElderLock,
    }),
    excludedTraits,
    excludedPlushies,
  );

  const candidatePrepStartedAt = performance.now();
  const candidates = await createOptimizerCandidates({
    creatureA: creature,
    creatureB: creature,
    mode: "solo",
    soloMode: "dummy",
    quality,
    optimizePlushies: true,
    searchAllVeneration: false,
    fixedVenerationStage: 5,
    searchToggles: false,
    goal: "lexicographic",
    constraints: normalizedTargetConstraints,
    excludedTraits,
    excludedPlushies,
    lockElder: targetElderLock,
  });
  const uniqueSkeletons = buildSkeletonsFromCandidates(candidates);
  const candidatePrepMs = performance.now() - candidatePrepStartedAt;

  const searchResult = await executeBestBuildsSearch({
    creature,
    activePool,
    quickPool,
    uniqueSkeletons,
    objective,
    winRateGuardPct,
    targetAscensionLock,
    targetElderLock,
    targetConstraints: normalizedTargetConstraints,
    showAllAscensionDistributions,
    earlyPruning,
    stage1TopK,
    stage2Cap,
    quickAbilityPolicy,
    stage2AbilityPolicy,
    refinementAbilityPolicy,
    enumerateAssignmentsCounts,
    onProgress,
    onPartialResults,
    cancelRef,
    twoFacedMode,
    stage1InputCap,
    combatEventOrder,
    extraAbilityConfig,
    extraCombatantStats,
    extraSpecialAbilities,
    extraBuffs,
    extraTrapsTrails,
    opponentBaselineBuild,
  });

  if (!cancelRef.current) {
    return {
      results: searchResult.results,
      elapsedMs: performance.now() - startedAt,
      timings: {
        candidatePrepMs,
        ...searchResult.timings,
      },
      runtimePathTelemetry: searchResult.runtimePathTelemetry,
    };
  }

  return {
    results: [],
    elapsedMs: performance.now() - startedAt,
    timings: {
      candidatePrepMs,
      ...searchResult.timings,
    },
    runtimePathTelemetry: searchResult.runtimePathTelemetry,
  };
}

export async function loadPerOpponentRowsFlow({
  sourceName,
  activePool,
  item,
  combatEventOrder,
  battleSettings,
}: {
  sourceName: string;
  activePool: string[];
  item: BestBuildAggregateResult;
  combatEventOrder?: CombatEventPhase[];
  battleSettings?: BestBuildsBattleSettings;
}): Promise<BestBuildPerOpponentRow[]> {
  return loadPerOpponentRows({
    sourceName,
    activePool,
    item,
    combatEventOrder,
    extraAbilityConfig: buildBestBuildsExtraAbilityConfig(battleSettings),
    extraCombatantStats: buildBestBuildsExtraCombatantStats(battleSettings),
    extraSpecialAbilities: buildBestBuildsExtraSpecialAbilities(battleSettings),
    extraBuffs: buildBestBuildsExtraBuffs(battleSettings),
    extraTrapsTrails: buildBestBuildsExtraTrapsTrails(battleSettings),
    opponentBaselineBuild: buildBestBuildsOpponentBaselineBuild(battleSettings),
  });
}
