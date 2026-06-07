// Optimizer page controller - fixed-A-build / optimize-B 1v1 search routed
// to the Best Builds Rust engine.
//
// Solo / dummy mode is gone - it was the pre-BB, pre-Rust optimizer path
// and was superseded by Best Builds (pool search) + Compare (canonical
// matchup). Counter mode is now the only mode: user fixes Creature A's
// build, picks Creature B, and the engine searches Creature B's best
// builds against the fixed A.
//
// OLD knobs are retained as UI state for visual parity:
// - `quality` (fast/balanced/quality) + `optimizationMode` (fast/guaranteed)
//   → BB `searchDepth` (soft/detailed)
// - `optimizationGoal` (lex/effectiveDamage/dps) → BB `objective`
//   (winRate/immortalDamage/avgDps)
// - `targetConstraints` + 4 locks → BB direct
// - `twoFacedMode` → BB direct
// - Other knobs (stage1TopK / stage2Cap / useWorkers / debugPreScore /
//   searchAllVeneration / optimizerAbilityPolicy) - kept as UI-only state;
//   BB owns its own internal staging.

import { useRef, useState } from "react";
import {
  DEFAULT_TWO_FACED_MODE,
  type BuildOptions,
  type TwoFacedMode,
} from "../engine";
import { getCreatureByName } from "../engine/creatureData";
import type { CombatEventPhase } from "../engine/eventOrdering";
import type { BestBuildAggregateResult } from "../optimizer/bestBuildsEvaluation";
import type { BestBuildAggregateObjective } from "../optimizer/ranking";
import { runBestBuildsFlow } from "../optimizer/bestBuildsPageFlow";
import { loadRustMatchupBridge } from "../optimizer/rustMatchupLoader";
import { useBestBuildsBattleSettings } from "../components/bestBuilds/BestBuildsBattleSettingsContext";
import type {
  GuaranteedOptimizerStats,
  OptimizationGoal,
  OptimizationMode,
} from "./optimizerLegacyTypes";

const DEFAULT_TARGET_CONSTRAINTS: BuildOptions = {
  venerationStage: 5,
  traits: [],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [],
  elder: "None",
};

/** Exported for unit tests - see `useOptimizerPageController.test.ts`. */
export function mapGoalToObjective(goal: OptimizationGoal): BestBuildAggregateObjective {
  switch (goal) {
    case "effectiveDamage":
      return "immortalDamage";
    case "dps":
      return "avgDps";
    case "lexicographic":
    default:
      return "winRate";
  }
}

/** Exported for unit tests - see `useOptimizerPageController.test.ts`. */
export function mapQualityToSearchDepth(
  quality: "fast" | "balanced" | "quality",
  optimizationMode: OptimizationMode,
): "soft" | "detailed" {
  if (optimizationMode === "guaranteed") return "detailed";
  return quality === "quality" ? "detailed" : "soft";
}

export function useOptimizerPageController({
  nameA,
  nameB,
  buildA,
  combatEventOrder,
}: {
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  combatEventOrder?: CombatEventPhase[];
}) {
  const [quality, setQuality] = useState<"fast" | "balanced" | "quality">("quality");
  const [optimizePlushies, setOptimizePlushies] = useState(true);
  const [searchAllVeneration, setSearchAllVeneration] = useState(false);
  const [searchToggles, setSearchToggles] = useState(false);
  const [optimizationMode, setOptimizationMode] = useState<OptimizationMode>("guaranteed");
  const [optimizationGoal, setOptimizationGoal] = useState<OptimizationGoal>("lexicographic");
  const [targetVenerationMode, setTargetVenerationMode] = useState<"auto" | "fixed">("auto");
  const [targetConstraints, setTargetConstraints] = useState<BuildOptions>(DEFAULT_TARGET_CONSTRAINTS);
  const [targetTraitLock, setTargetTraitLock] = useState(false);
  const [targetAscensionLock, setTargetAscensionLock] = useState(false);
  const [targetPlushieLock, setTargetPlushieLock] = useState(false);
  const [targetElderLock, setTargetElderLock] = useState(false);
  const [debugPreScore, setDebugPreScore] = useState(false);
  const [stage1TopK, setStage1TopK] = useState(200);
  const [stage2Cap, setStage2Cap] = useState(120);
  const [diversifyPlushiePairs, setDiversifyPlushiePairs] = useState(true);
  const [resultsLimit, setResultsLimit] = useState(1);
  const [useWorkers, setUseWorkers] = useState(true);
  const [guaranteedStats] = useState<GuaranteedOptimizerStats | null>(null);
  const [progress, setProgress] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [fixedBuildA, setFixedBuildA] = useState<BuildOptions>(buildA);
  const [results, setResults] = useState<BestBuildAggregateResult[]>([]);
  const [twoFacedMode, setTwoFacedMode] = useState<TwoFacedMode>(DEFAULT_TWO_FACED_MODE);
  const { settings: battleSettings } = useBestBuildsBattleSettings();
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const runIdRef = useRef(0);

  const cancelRun = () => {
    cancelRef.current = true;
    runIdRef.current += 1;
    setIsRunning(false);
    setProgress(0);
  };

  const runOptimizer = async () => {
    const creatureA = getCreatureByName(nameA);
    const creatureB = getCreatureByName(nameB);
    if (!creatureA) {
      setError("Creature A is not selected.");
      return;
    }
    if (!creatureB) {
      setError("Creature B is not selected.");
      return;
    }
    setError(null);

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    cancelRef.current = false;
    setIsRunning(true);
    setProgress(0);
    setResults([]);

    const bridge = await loadRustMatchupBridge().catch(() => null);
    if (!bridge) {
      setError("Rust hot path could not be loaded; optimizer cannot run.");
      setIsRunning(false);
      return;
    }

    try {
      const flowResult = await runBestBuildsFlow({
        creature: creatureB,
        activePool: [creatureA.name],
        searchDepth: mapQualityToSearchDepth(quality, optimizationMode),
        objective: mapGoalToObjective(optimizationGoal),
        winRateGuardPct: 0,
        targetConstraints,
        targetTraitLock,
        targetAscensionLock,
        targetPlushieLock,
        targetElderLock,
        excludedTraits: [],
        excludedPlushies: [],
        showAllAscensionDistributions: false,
        earlyPruning: true,
        onProgress: setProgress,
        onPartialResults: setResults,
        cancelRef,
        twoFacedMode,
        combatEventOrder,
        battleSettings,
      });
      if (cancelRef.current || runIdRef.current !== runId) {
        return;
      }
      setResults(flowResult.results);
      setProgress(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (runIdRef.current === runId) {
        setIsRunning(false);
      }
    }
  };

  return {
    quality,
    setQuality,
    optimizePlushies,
    setOptimizePlushies,
    searchAllVeneration,
    setSearchAllVeneration,
    searchToggles,
    setSearchToggles,
    optimizationMode,
    setOptimizationMode,
    optimizationGoal,
    setOptimizationGoal,
    targetVenerationMode,
    setTargetVenerationMode,
    targetConstraints,
    setTargetConstraints,
    targetTraitLock,
    setTargetTraitLock,
    targetAscensionLock,
    setTargetAscensionLock,
    targetPlushieLock,
    setTargetPlushieLock,
    targetElderLock,
    setTargetElderLock,
    debugPreScore,
    setDebugPreScore,
    stage1TopK,
    setStage1TopK,
    stage2Cap,
    setStage2Cap,
    diversifyPlushiePairs,
    setDiversifyPlushiePairs,
    resultsLimit,
    setResultsLimit,
    useWorkers,
    setUseWorkers,
    guaranteedStats,
    progress,
    isRunning,
    fixedBuildA,
    setFixedBuildA,
    results,
    twoFacedMode,
    setTwoFacedMode,
    error,
    runOptimizer,
    cancelRun,
  };
}
