import { useEffect, useMemo, useState } from "react";
import type { BuildOptions, CreatureRuntime } from "../engine";
import { plushies, traits } from "../engine/buildData";
import { encodeCreaturePoolCode } from "../optimizer/poolUtils";
import { useBestBuildsPageController } from "../pages/useBestBuildsPageController";
import type { FriendlyBestBuildAnswers } from "./friendlyTypes";
import { buildFriendlyAirRuleIntent, buildFriendlyBestBuildEngineIntent } from "./friendlyConfig";
import { buildFriendlyOpponentPool } from "./friendlyData";

type PendingRun = {
  runId: number;
  answers: FriendlyBestBuildAnswers;
};

const DEFAULT_CONSTRAINTS: BuildOptions = {
  venerationStage: 5,
  traits: [],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [],
  elder: "None",
};

const ALLOWED_TRAITS = new Set(traits.map((trait) => trait.id));
const ALLOWED_PLUSHIES = new Set(plushies.map((plushie) => plushie.name));

export function useFriendlyBestBuildController({
  nameA,
  creatures,
}: {
  nameA: string;
  creatures: CreatureRuntime[];
}) {
  const controller = useBestBuildsPageController({ nameA, availableCreatures: creatures });
  const {
    setSearchDepth,
    setObjective,
    setWinRateGuardPct,
    setPoolMode,
    setPoolScope,
    setCustomPoolText,
    setTargetConstraints,
    setTargetTraitLock,
    setTargetAscensionLock,
    setTargetPlushieLock,
    setTargetElderLock,
    setShowAllAscensionDistributions,
    setEarlyPruning,
    runBestBuilds,
  } = controller;
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null);
  const [activeRunId, setActiveRunId] = useState<number>(0);

  const desiredConfig = useMemo(() => {
    if (!pendingRun) return null;
    const { answers } = pendingRun;
    const engineIntent = buildFriendlyBestBuildEngineIntent(answers);
    const airRuleIntent = buildFriendlyAirRuleIntent(answers);
    const sanitizedTraits = answers.preferredTraits.filter((trait) => ALLOWED_TRAITS.has(trait)).slice(0, 2);
    const sanitizedPlushies = answers.preferredPlushies.filter((plushie) => ALLOWED_PLUSHIES.has(plushie)).slice(0, 2);
    const objective =
      engineIntent.mode === "survivability"
        ? "survival"
        : answers.optimizationGoal === "fastKills"
          ? "avgTtk"
          : answers.optimizationGoal === "maxDps"
            ? "avgDps"
            : "winRate";
    const pool = buildFriendlyOpponentPool({
      creatures,
      sourceName: nameA,
      enemyProfile: answers.enemyProfile,
      customTiers: answers.customTiers,
    });
    const usesDefaultMetaPool = answers.enemyProfile === "aroundTier";
    const targetConstraints: BuildOptions = {
      ...DEFAULT_CONSTRAINTS,
      traits: sanitizedTraits,
      plushies: sanitizedPlushies,
      elder: answers.preferredElder,
    };

    return {
      engineIntent,
      airRuleIntent,
      objective,
      poolMode: usesDefaultMetaPool ? "meta80" : "custom",
      poolScope: "withinOneTier" as const,
      poolCode: usesDefaultMetaPool ? "" : encodeCreaturePoolCode(pool),
      targetConstraints,
      targetTraitLock: sanitizedTraits.length > 0,
      targetPlushieLock: sanitizedPlushies.length > 0,
      targetElderLock: answers.preferredElder !== "None",
    } as const;
  }, [creatures, nameA, pendingRun]);

  useEffect(() => {
    if (!desiredConfig) return;
    // Rust runtime is the only path.
    // - no TS fallback to toggle, so no `setUseRustMatchup*` call here.
    setSearchDepth("detailed");
    setWinRateGuardPct(2);
    setObjective(desiredConfig.objective);
    setPoolMode(desiredConfig.poolMode);
    setPoolScope(desiredConfig.poolScope);
    setCustomPoolText(desiredConfig.poolCode);
    setTargetConstraints(desiredConfig.targetConstraints);
    setTargetTraitLock(desiredConfig.targetTraitLock);
    setTargetAscensionLock(false);
    setTargetPlushieLock(desiredConfig.targetPlushieLock);
    setTargetElderLock(false);
    setShowAllAscensionDistributions(true);
    setEarlyPruning(false);
  }, [
    desiredConfig,
    setCustomPoolText,
    setEarlyPruning,
    setObjective,
    setPoolScope,
    setPoolMode,
    setSearchDepth,
    setShowAllAscensionDistributions,
    setTargetAscensionLock,
    setTargetConstraints,
    setTargetPlushieLock,
    setTargetElderLock,
    setTargetTraitLock,
    setWinRateGuardPct,
  ]);

  const isConfigReady =
    desiredConfig !== null &&
    controller.objective === desiredConfig.objective &&
    controller.poolMode === desiredConfig.poolMode &&
    controller.poolScope === desiredConfig.poolScope &&
    controller.customPoolText === desiredConfig.poolCode &&
    controller.targetTraitLock === desiredConfig.targetTraitLock &&
    controller.targetPlushieLock === desiredConfig.targetPlushieLock &&
    controller.targetElderLock === desiredConfig.targetElderLock &&
    controller.targetConstraints.traits.join("|") === desiredConfig.targetConstraints.traits.join("|") &&
    controller.targetConstraints.plushies.join("|") === desiredConfig.targetConstraints.plushies.join("|") &&
    (controller.targetConstraints.elder ?? "None") === desiredConfig.targetConstraints.elder;

  useEffect(() => {
    if (!pendingRun || !isConfigReady || controller.isRunning) return;
    setActiveRunId(pendingRun.runId);
    setPendingRun(null);
    void runBestBuilds();
  }, [controller.isRunning, isConfigReady, pendingRun, runBestBuilds]);

  const startFriendlyRun = (answers: FriendlyBestBuildAnswers) => {
    setPendingRun({
      runId: Date.now(),
      answers,
    });
  };

  return {
    ...controller,
    activeRunId,
    engineIntent: desiredConfig?.engineIntent ?? null,
    airRuleIntent: desiredConfig?.airRuleIntent ?? null,
    topResults: controller.results.slice(0, 3),
    pendingRun,
    startFriendlyRun,
  };
}
