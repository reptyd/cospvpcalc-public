import { useMemo, useRef, useState } from "react";
import { DEFAULT_TWO_FACED_MODE, type BuildOptions, type TwoFacedMode } from "../engine";
import { memoizedApplyRulesAndBuild, setActiveTwoFacedMode } from "../optimizer/bestBuildsOptimizations";
import { plushies, traits } from "../engine/buildData";
import { creatureByName, creatureNameMatchesQuery, getCreatureByName, resolveCreatureName } from "../engine/creatureData";
import type { BestBuildAggregateResult } from "../optimizer/bestBuildsFlow";
import {
  type BestBuildsRuntimePathTelemetry,
  type BestBuildsStageTimings,
  type BestBuildPerOpponentRow,
  formatBuildHeaderLines,
  loadPerOpponentRowsFlow,
  runBestBuildsFlow,
} from "../optimizer/bestBuildsPageFlow";
import {
  type DefaultPoolScope,
  buildDefaultMetaPool,
  encodeCreaturePoolCode,
  parseCreaturePoolCode,
} from "../optimizer/poolUtils";
import { aggregateBestBuildsMatchupSummary, type BestBuildAggregate, type BestBuildAggregateObjective } from "../optimizer/ranking";
import { buildResultKey, computeAscensionCounts } from "../shared/buildEncoding";
import { loadRustMatchupBridge } from "../optimizer/rustMatchupLoader";
import { simulateBestBuildMatchup } from "../optimizer/bestBuildsRuntime";
import { RECOMMENDED_COMBAT_EVENT_ORDER, type CombatEventPhase } from "../engine/eventOrdering";
import { useBestBuildsBattleSettings } from "../components/bestBuilds/BestBuildsBattleSettingsContext";

type BestBuildsTopResultDiagnostic = {
  workerAggregate: BestBuildAggregate;
  mainThreadAggregate: BestBuildAggregate;
  buildLabel: string;
  referenceBuildComparisons: Array<{
    label: string;
    aggregate: BestBuildAggregate;
  }>;
};

export function useBestBuildsPageController({
  nameA,
  availableCreatures,
  combatEventOrder,
}: {
  nameA: string;
  availableCreatures: Array<{ name: string; stats: { tier: number } }>;
  combatEventOrder?: CombatEventPhase[];
}) {
  const resolvedCombatEventOrder = combatEventOrder ?? RECOMMENDED_COMBAT_EVENT_ORDER;
  type BestBuildPoolMode =
    | "meta40"
    | "meta60"
    | "meta80"
    | "meta120"
    | "meta160"
    | "meta200"
    | "meta240"
    | "meta280"
    | "meta320"
    | "custom";
  const [searchDepth, setSearchDepth] = useState<"soft" | "detailed">("detailed");
  const [objective, setObjective] = useState<BestBuildAggregateObjective>("winRate");
  const [winRateGuardPct, setWinRateGuardPct] = useState(30);
  const [poolMode, setPoolMode] = useState<BestBuildPoolMode>("meta80");
  const [poolScope, setPoolScope] = useState<DefaultPoolScope>("withinOneTier");
  const [customPoolText, setCustomPoolText] = useState("");
  const [customPickerQuery, setCustomPickerQuery] = useState("");
  const [selectedPoolTiers, setSelectedPoolTiers] = useState<number[]>([]);
  const [results, setResults] = useState<BestBuildAggregateResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [lastRunMs, setLastRunMs] = useState<number | null>(null);
  const [lastRunTimings, setLastRunTimings] = useState<(BestBuildsStageTimings & { candidatePrepMs: number }) | null>(null);
  const [lastRunRuntimePathTelemetry, setLastRunRuntimePathTelemetry] = useState<BestBuildsRuntimePathTelemetry | null>(null);
  const [runtimeRequirementError, setRuntimeRequirementError] = useState<string | null>(null);
  const [topResultDiagnostic, setTopResultDiagnostic] = useState<BestBuildsTopResultDiagnostic | null>(null);
  const [earlyPruning, setEarlyPruning] = useState(false);
  const [expandedResultKey, setExpandedResultKey] = useState<string | null>(null);
  const [loadingPerOpponentKey, setLoadingPerOpponentKey] = useState<string | null>(null);
  const [currentPerOpponentRows, setCurrentPerOpponentRows] = useState<BestBuildPerOpponentRow[] | null>(null);
  const [targetConstraints, setTargetConstraints] = useState<BuildOptions>({
    venerationStage: 5,
    traits: [],
    ascensionAssignments: ["", "", "", "", ""],
    plushies: [],
    elder: "None",
  });
  const [targetTraitLock, setTargetTraitLock] = useState(false);
  const [targetAscensionLock, setTargetAscensionLock] = useState(false);
  const [targetPlushieLock, setTargetPlushieLock] = useState(false);
  const [targetElderLock, setTargetElderLock] = useState(false);
  const [excludedTraits, setExcludedTraits] = useState<string[]>([]);
  const [excludedPlushies, setExcludedPlushies] = useState<string[]>([]);
  const [showAllAscensionDistributions, setShowAllAscensionDistributions] = useState(true);
  const [twoFacedMode, setTwoFacedMode] = useState<TwoFacedMode>(DEFAULT_TWO_FACED_MODE);
  const { settings: battleSettings } = useBestBuildsBattleSettings();
  const cancelRef = useRef(false);

  const creature = getCreatureByName(nameA);
  const metaPoolSize =
    poolMode === "meta40"
      ? 40
      : poolMode === "meta60"
        ? 60
        : poolMode === "meta80"
          ? 80
          : poolMode === "meta120"
            ? 120
            : poolMode === "meta160"
              ? 160
              : poolMode === "meta200"
                ? 200
                : poolMode === "meta240"
                  ? 240
                  : poolMode === "meta280"
                    ? 280
                    : poolMode === "meta320"
                      ? 320
                      : 60;
  const defaultPool = useMemo(
    () => buildDefaultMetaPool(nameA, metaPoolSize, poolScope, selectedPoolTiers),
    [nameA, metaPoolSize, poolScope, selectedPoolTiers],
  );
  const customPool = useMemo(() => parseCreaturePoolCode(customPoolText), [customPoolText]);
  const activePool = poolMode === "custom" ? customPool : defaultPool;
  const selectedCustomSet = useMemo(() => new Set(customPool), [customPool]);
  const eligibleCustomChoices = useMemo(() => {
    if (!creature) return [] as string[];
    return availableCreatures
      .filter((entry) => entry.name !== creature.name)
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  }, [availableCreatures, creature]);
  const filteredCustomChoices = useMemo(() => {
    if (!customPickerQuery.trim()) return eligibleCustomChoices;
    return eligibleCustomChoices.filter((name) => creatureNameMatchesQuery(name, customPickerQuery));
  }, [eligibleCustomChoices, customPickerQuery]);
  const traitBlacklistOptions = useMemo(
    () =>
      traits
        .filter((trait) => ["Damage", "Bite", "Weight", "Health"].includes(trait.id))
        .map((trait) => ({ id: trait.id, label: trait.name })),
    [],
  );
  const plushieBlacklistOptions = useMemo(
    () => plushies.map((plushie) => plushie.name).sort((a, b) => a.localeCompare(b)),
    [],
  );

  const setSanitizedTargetConstraints = (value: BuildOptions) => {
    const excludedTraitSet = new Set(excludedTraits);
    const excludedPlushieSet = new Set(excludedPlushies);
    setTargetConstraints({
      ...value,
      traits: value.traits.filter((trait) => trait && !excludedTraitSet.has(trait)).slice(0, 2),
      plushies: value.plushies.filter((plushie) => plushie && !excludedPlushieSet.has(plushie)).slice(0, 2),
      ascensionAssignments: value.ascensionAssignments.map((assignment) =>
        assignment && excludedTraitSet.has(assignment) ? "" : assignment,
      ),
    });
  };

  const toggleExcludedTrait = (traitId: string) => {
    const willExclude = !excludedTraits.includes(traitId);
    setExcludedTraits(
      willExclude
        ? [...excludedTraits, traitId].sort((a, b) => a.localeCompare(b))
        : excludedTraits.filter((value) => value !== traitId),
    );
    if (!willExclude) return;
    setTargetConstraints((current) => ({
      ...current,
      traits: current.traits.filter((trait) => trait !== traitId),
      ascensionAssignments: current.ascensionAssignments.map((assignment) => (assignment === traitId ? "" : assignment)),
    }));
  };

  const toggleExcludedPlushie = (plushieName: string) => {
    const willExclude = !excludedPlushies.includes(plushieName);
    setExcludedPlushies(
      willExclude
        ? [...excludedPlushies, plushieName].sort((a, b) => a.localeCompare(b))
        : excludedPlushies.filter((value) => value !== plushieName),
    );
    if (!willExclude) return;
    setTargetConstraints((current) => ({
      ...current,
      plushies: current.plushies.filter((plushie) => plushie !== plushieName),
    }));
  };

  const addToCustomPool = (name: string) => {
    const resolvedName = resolveCreatureName(name);
    if (!resolvedName) return;
    const next = [...customPool];
    if (!next.includes(resolvedName)) next.push(resolvedName);
    setCustomPoolText(encodeCreaturePoolCode(next));
  };

  const removeFromCustomPool = (name: string) => {
    const next = customPool.filter((item) => item !== name);
    setCustomPoolText(encodeCreaturePoolCode(next));
  };

  const copyPoolCode = async () => {
    const code = encodeCreaturePoolCode(activePool);
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // ignore
    }
  };

  const cancelRun = () => {
    cancelRef.current = true;
  };

  const runBestBuilds = async () => {
    if (!creature || activePool.length === 0) return;
    setActiveTwoFacedMode(twoFacedMode);
    setIsRunning(true);
    setProgress(0);
    setResults([]);
    setExpandedResultKey(null);
    setLastRunMs(null);
    setLastRunTimings(null);
    setLastRunRuntimePathTelemetry(null);
    setRuntimeRequirementError(null);
    setTopResultDiagnostic(null);
    cancelRef.current = false;
    const bridge = await loadRustMatchupBridge().catch(() => null);
    if (!bridge) {
      setRuntimeRequirementError("Rust hot path could not be loaded, so Best Builds was not started.");
      setIsRunning(false);
      return;
    }
    const flowResult = await runBestBuildsFlow({
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
      onProgress: setProgress,
      onPartialResults: setResults,
      cancelRef,
      twoFacedMode,
      combatEventOrder: resolvedCombatEventOrder,
      battleSettings,
    });
    if (!cancelRef.current) {
      setLastRunMs(flowResult.elapsedMs);
      setLastRunTimings(flowResult.timings);
      setLastRunRuntimePathTelemetry(flowResult.runtimePathTelemetry);
      setResults(flowResult.results);
      setProgress(1);
      if (flowResult.results.length > 0) {
        const diagnostic = await buildTopResultDiagnostic({
          sourceName: creature.name,
          activePool,
          topResult: flowResult.results[0],
          combatEventOrder: resolvedCombatEventOrder,
        });
        if (!cancelRef.current) {
          setTopResultDiagnostic(diagnostic);
        }
      }
    }
    setIsRunning(false);
  };


  const copyBuildHeader = async (item: BestBuildAggregateResult, idx: number, sourceName: string) => {
    const asc = computeAscensionCounts(item.build.traits, item.build.ascensionAssignments, item.build.venerationStage);
    const lines = formatBuildHeaderLines(
      item,
      idx,
      sourceName,
      item.build.traits.map((trait, i) => `${trait}=${asc[i] ?? 0}`).join(", "),
    );
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      // ignore
    }
  };

  const loadPerOpponentRows = async (item: BestBuildAggregateResult, _idx: number, sourceName: string) => {
    setActiveTwoFacedMode(twoFacedMode);
    const resultKey = getBestBuildResultIdentity(item);
    if (expandedResultKey === resultKey) {
      setExpandedResultKey(expandedResultKey === resultKey ? null : resultKey);
      setCurrentPerOpponentRows(null);
      return;
    }
    setExpandedResultKey(resultKey);
    setLoadingPerOpponentKey(resultKey);
    setCurrentPerOpponentRows(null);
    const rows = await loadPerOpponentRowsFlow({
      sourceName,
      activePool,
      item,
      combatEventOrder: resolvedCombatEventOrder,
      battleSettings,
    });
    setCurrentPerOpponentRows(rows);
    setLoadingPerOpponentKey(null);
  };

  return {
    creature,
    searchDepth,
    setSearchDepth,
    objective,
    setObjective,
    winRateGuardPct,
    setWinRateGuardPct,
    poolMode,
    setPoolMode,
    poolScope,
    setPoolScope,
    customPool,
    customPoolText,
    setCustomPoolText,
    customPickerQuery,
    setCustomPickerQuery,
    selectedPoolTiers,
    setSelectedPoolTiers,
    results,
    progress,
    isRunning,
    lastRunMs,
    lastRunTimings,
    lastRunRuntimePathTelemetry,
    runtimeRequirementError,
    topResultDiagnostic,
    earlyPruning,
    setEarlyPruning,
    expandedResultKey,
    currentPerOpponentRows,
    loadingPerOpponentKey,
    targetConstraints,
    setTargetConstraints: setSanitizedTargetConstraints,
    excludedTraits,
    toggleExcludedTrait,
    setExcludedTraits,
    traitBlacklistOptions,
    excludedPlushies,
    toggleExcludedPlushie,
    setExcludedPlushies,
    plushieBlacklistOptions,
    targetTraitLock,
    setTargetTraitLock,
    targetAscensionLock,
    setTargetAscensionLock,
    targetPlushieLock,
    setTargetPlushieLock,
    targetElderLock,
    setTargetElderLock,
    showAllAscensionDistributions,
    setShowAllAscensionDistributions,
    twoFacedMode,
    setTwoFacedMode,
    activePool,
    selectedCustomSet,
    filteredCustomChoices,
    addToCustomPool,
    removeFromCustomPool,
    copyPoolCode,
    runBestBuilds,
    cancelRun,
    copyBuildHeader,
    loadPerOpponentRows,
  };
}

function getBestBuildResultIdentity(item: BestBuildAggregateResult): string {
  return buildResultKey(item.build, item.activesOn, item.breathOn);
}

async function buildTopResultDiagnostic({
  sourceName,
  activePool,
  topResult,
  combatEventOrder,
}: {
  sourceName: string;
  activePool: string[];
  topResult: BestBuildAggregateResult;
  combatEventOrder: CombatEventPhase[];
}): Promise<BestBuildsTopResultDiagnostic | null> {
  const sourceCreature = creatureByName[sourceName];
  if (!sourceCreature) return null;

  const finalA = memoizedApplyRulesAndBuild(sourceCreature, topResult.build);
  const buildLabel = `${topResult.build.traits.join(" + ")} | ${topResult.build.plushies.join(" + ") || "none"} | ${topResult.build.ascensionAssignments.join(",")}`;
  const workerAggregate = topResult.aggregate;

  const recompute = (finalForA: typeof finalA): BestBuildAggregate => {
    let wins = 0;
    let draws = 0;
    let sumSurvival = 0;
    let sumDps = 0;
    let sumTtkWins = 0;
    let winsCount = 0;
    let sumImmortal = 0;
    for (const opponentName of activePool) {
      const opponentCreature = creatureByName[opponentName];
      if (!opponentCreature) continue;
      const summary = simulateBestBuildMatchup({
        sourceCreature,
        sourceBuild: topResult.build,
        finalA: finalForA,
        opponentCreature,
        activesOn: topResult.activesOn,
        breathOn: topResult.breathOn,
        maxTimeSec: 180,
        abilityPolicy: "semiIdeal",
        combatEventOrder,
      });
      const agg = aggregateBestBuildsMatchupSummary(summary);
      wins += agg.win;
      draws += agg.draw;
      sumSurvival += agg.survival;
      sumDps += agg.avgDps;
      sumImmortal += agg.immortalDamage;
      if (agg.win > 0) {
        sumTtkWins += agg.ttkWin;
        winsCount += 1;
      }
    }
    const count = Math.max(1, activePool.length);
    return {
      winRate: wins / count,
      drawRate: draws / count,
      avgSurvival: sumSurvival / count,
      avgDps: sumDps / count,
      avgTtkWin: winsCount > 0 ? sumTtkWins / winsCount : 180,
      avgImmortalDamage: sumImmortal / count,
    };
  };

  await loadRustMatchupBridge().catch(() => null);
  const mainThreadAggregate = recompute(finalA);

  const referenceBuildComparisons: Array<{ label: string; aggregate: BestBuildAggregate }> = [];
  if (sourceName === "Kendyll") {
    const referenceBuilds: Array<{ label: string; build: BuildOptions }> = [
      { label: "Void+Void 0/5", build: { venerationStage: 5, traits: ["Bite", "Damage"], ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"], plushies: ["Void", "Void"] } },
      { label: "Magi+Ice 1/4", build: { venerationStage: 5, traits: ["Bite", "Damage"], ascensionAssignments: ["Bite", "Damage", "Damage", "Damage", "Damage"], plushies: ["Magichorn Prongbug", "Ice Wolf"] } },
      { label: "Magi+Void 5/0", build: { venerationStage: 5, traits: ["Bite", "Damage"], ascensionAssignments: ["Bite", "Bite", "Bite", "Bite", "Bite"], plushies: ["Magichorn Prongbug", "Void"] } },
      { label: "Ice+Void 0/5", build: { venerationStage: 5, traits: ["Bite", "Damage"], ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"], plushies: ["Ice Wolf", "Void"] } },
      { label: "Heartsnake+Void 0/5", build: { venerationStage: 5, traits: ["Bite", "Damage"], ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"], plushies: ["Heartsnake", "Void"] } },
    ];
    for (const reference of referenceBuilds) {
      const finalRef = memoizedApplyRulesAndBuild(sourceCreature, reference.build);
      referenceBuildComparisons.push({ label: reference.label, aggregate: recompute(finalRef) });
    }
  }

  return { workerAggregate, mainThreadAggregate, buildLabel, referenceBuildComparisons };
}
