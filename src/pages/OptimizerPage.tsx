// Optimizer page — fixed-A-build / optimize-B 1v1 search, routed to the
// Best Builds Rust engine. Solo / dummy mode was dropped in the 2026-05
// cleanup (pre-BB pre-Rust era).
//
// Layout: panel-grid with Settings panel + Creature A card (fixed build)
// + Creature B card (selector + Swap + locks + run). Results below.

import { useEffect, useRef } from "react";
import type { BuildOptions, TwoFacedMode } from "../engine";
import type { CombatEventPhase } from "../engine/eventOrdering";
import { getCreatureIcon } from "../engine/creatureData";
import { veneration } from "../engine/buildData";
import { IconImg } from "../components/IconImg";
import { CreatureNameInput } from "../components/CreatureNameInput";
import { AscensionSelectors, ElderSelector, PlushieSelectors, TraitSelectors } from "../components/BuildSelectors";
import { BuildLockControls } from "../components/optimizer/BuildLockControls";
import { OptimizerResultsPanel } from "../components/optimizer/OptimizerResultsPanel";
import { OptimizerRunControls } from "../components/optimizer/OptimizerRunControls";
import { OptimizerSettingsPanel } from "../components/optimizer/OptimizerSettingsPanel";
import { useOptimizerPageController } from "./useOptimizerPageController";
import { useBestBuildsBattleSettings } from "../components/bestBuilds/BestBuildsBattleSettingsContext";
import type { BestBuildsBattleSettings } from "../components/bestBuilds/bestBuildsBattleSettingsTypes";
import type { OptimizationGoal, OptimizationMode } from "./optimizerLegacyTypes";
import { registerMatchSnapshotProvider } from "../shared/matchSnapshot";

type OptimizerSnapshotState = {
  nameA: string;
  nameB: string;
  fixedBuildA: BuildOptions;
  quality: "fast" | "balanced" | "quality";
  optimizePlushies: boolean;
  searchAllVeneration: boolean;
  searchToggles: boolean;
  optimizationMode: OptimizationMode;
  optimizationGoal: OptimizationGoal;
  targetVenerationMode: "auto" | "fixed";
  targetConstraints: BuildOptions;
  targetTraitLock: boolean;
  targetAscensionLock: boolean;
  targetPlushieLock: boolean;
  targetElderLock: boolean;
  debugPreScore: boolean;
  stage1TopK: number;
  stage2Cap: number;
  diversifyPlushiePairs: boolean;
  resultsLimit: number;
  useWorkers: boolean;
  twoFacedMode: TwoFacedMode;
  battleSettings: BestBuildsBattleSettings;
};

export type OptimizerPageProps = {
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  creatureNames: string[];
  developerMode: boolean;
  combatEventOrder: CombatEventPhase[];
  onNameAChange: (value: string) => void;
  onNameBChange: (value: string) => void;
  onApplyBuildB: (build: BuildOptions) => void;
};

export default function OptimizerPage({
  nameA,
  nameB,
  buildA,
  creatureNames,
  developerMode,
  combatEventOrder,
  onNameAChange,
  onNameBChange,
  onApplyBuildB,
}: OptimizerPageProps) {
  const {
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
  } = useOptimizerPageController({ nameA, nameB, buildA, combatEventOrder });

  const { settings: bbBattleSettings, setSettings: setBbBattleSettings } = useBestBuildsBattleSettings();

  // Share-Match snapshot provider. A ref mirrors shareable setup each
  // render so the provider (registered once) reads current values.
  // Participants are the fixed + optimized creatures.
  const shareSnapshotRef = useRef<OptimizerSnapshotState | null>(null);
  shareSnapshotRef.current = {
    nameA,
    nameB,
    fixedBuildA,
    quality,
    optimizePlushies,
    searchAllVeneration,
    searchToggles,
    optimizationMode,
    optimizationGoal,
    targetVenerationMode,
    targetConstraints,
    targetTraitLock,
    targetAscensionLock,
    targetPlushieLock,
    targetElderLock,
    debugPreScore,
    stage1TopK,
    stage2Cap,
    diversifyPlushiePairs,
    resultsLimit,
    useWorkers,
    twoFacedMode,
    battleSettings: bbBattleSettings,
  };
  useEffect(() => {
    return registerMatchSnapshotProvider({
      page: "optimizer",
      getSnapshot: () => {
        const s = shareSnapshotRef.current!;
        return {
          pageState: { ...s } as unknown as Record<string, unknown>,
          participantCreatureNames: [s.nameA, s.nameB].filter((n): n is string => Boolean(n)),
        };
      },
      applySnapshot: (pageState) => {
        const s = pageState as Partial<OptimizerSnapshotState>;
        if (typeof s.nameA === "string") onNameAChange(s.nameA);
        if (typeof s.nameB === "string") onNameBChange(s.nameB);
        if (s.fixedBuildA) setFixedBuildA(s.fixedBuildA);
        if (s.quality !== undefined) setQuality(s.quality);
        if (s.optimizePlushies !== undefined) setOptimizePlushies(s.optimizePlushies);
        if (s.searchAllVeneration !== undefined) setSearchAllVeneration(s.searchAllVeneration);
        if (s.searchToggles !== undefined) setSearchToggles(s.searchToggles);
        if (s.optimizationMode !== undefined) setOptimizationMode(s.optimizationMode);
        if (s.optimizationGoal !== undefined) setOptimizationGoal(s.optimizationGoal);
        if (s.targetVenerationMode !== undefined) setTargetVenerationMode(s.targetVenerationMode);
        if (s.targetConstraints) setTargetConstraints(s.targetConstraints);
        if (s.targetTraitLock !== undefined) setTargetTraitLock(s.targetTraitLock);
        if (s.targetAscensionLock !== undefined) setTargetAscensionLock(s.targetAscensionLock);
        if (s.targetPlushieLock !== undefined) setTargetPlushieLock(s.targetPlushieLock);
        if (s.targetElderLock !== undefined) setTargetElderLock(s.targetElderLock);
        if (s.debugPreScore !== undefined) setDebugPreScore(s.debugPreScore);
        if (s.stage1TopK !== undefined) setStage1TopK(s.stage1TopK);
        if (s.stage2Cap !== undefined) setStage2Cap(s.stage2Cap);
        if (s.diversifyPlushiePairs !== undefined) setDiversifyPlushiePairs(s.diversifyPlushiePairs);
        if (s.resultsLimit !== undefined) setResultsLimit(s.resultsLimit);
        if (s.useWorkers !== undefined) setUseWorkers(s.useWorkers);
        if (s.twoFacedMode !== undefined) setTwoFacedMode(s.twoFacedMode);
        if (s.battleSettings) setBbBattleSettings(s.battleSettings);
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- listed deps are stable useState setters (opaque through the controller hook)
  }, [onNameAChange, onNameBChange]);

  return (
    <section className="panel">
      <div className="panel-grid">
        <OptimizerSettingsPanel
          quality={quality}
          setQuality={setQuality}
          optimizePlushies={optimizePlushies}
          setOptimizePlushies={setOptimizePlushies}
          optimizationMode={optimizationMode}
          setOptimizationMode={setOptimizationMode}
          optimizationGoal={optimizationGoal}
          setOptimizationGoal={setOptimizationGoal}
          targetVenerationMode={targetVenerationMode}
          setTargetVenerationMode={setTargetVenerationMode}
          targetConstraints={targetConstraints}
          setTargetConstraints={setTargetConstraints}
          resultsLimit={resultsLimit}
          setResultsLimit={setResultsLimit}
          developerMode={developerMode}
          searchAllVeneration={searchAllVeneration}
          setSearchAllVeneration={setSearchAllVeneration}
          searchToggles={searchToggles}
          setSearchToggles={setSearchToggles}
          debugPreScore={debugPreScore}
          setDebugPreScore={setDebugPreScore}
          stage1TopK={stage1TopK}
          setStage1TopK={setStage1TopK}
          stage2Cap={stage2Cap}
          setStage2Cap={setStage2Cap}
          diversifyPlushiePairs={diversifyPlushiePairs}
          setDiversifyPlushiePairs={setDiversifyPlushiePairs}
          useWorkers={useWorkers}
          setUseWorkers={setUseWorkers}
          guaranteedStats={guaranteedStats}
          twoFacedMode={twoFacedMode}
          setTwoFacedMode={setTwoFacedMode}
          nameA={nameA}
          nameB={nameB}
        />
        <div className="panel-block">
          <h3>Creature A (fixed build)</h3>
          <div className="icon-input">
            <IconImg src={getCreatureIcon(nameA)} alt={nameA} size={36} />
            <CreatureNameInput ariaLabel="Creature A (fixed build)" value={nameA} onChange={onNameAChange} creatureNames={creatureNames} />
          </div>
          <div className="field">
            <label>Fixed A Veneration</label>
            <select
              aria-label="Fixed A Veneration"
              value={fixedBuildA.venerationStage}
              onChange={(e) => setFixedBuildA({ ...fixedBuildA, venerationStage: Number(e.target.value) })}
            >
              {Array.from({ length: veneration.stages + 1 }, (_, idx) => (
                <option key={idx} value={idx}>
                  {idx}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Traits</label>
            <TraitSelectors build={fixedBuildA} onBuildChange={setFixedBuildA} />
          </div>
          <div className="field">
            <label>Ascension</label>
            <AscensionSelectors build={fixedBuildA} onBuildChange={setFixedBuildA} />
          </div>
          <div className="field">
            <label>Plushies</label>
            <PlushieSelectors build={fixedBuildA} onBuildChange={setFixedBuildA} />
          </div>
          <div className="field">
            <label>Elder</label>
            <ElderSelector build={fixedBuildA} onBuildChange={setFixedBuildA} />
          </div>
        </div>
        <div className="panel-block">
          <h3>Creature B (optimized)</h3>
          <div className="icon-input">
            <IconImg src={getCreatureIcon(nameB)} alt={nameB} size={36} />
            <CreatureNameInput ariaLabel="Creature B (optimized)" value={nameB} onChange={onNameBChange} creatureNames={creatureNames} />
          </div>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              const nextNameA = nameB;
              const nextNameB = nameA;
              onNameAChange(nextNameA);
              onNameBChange(nextNameB);
              setFixedBuildA(buildA);
            }}
          >
            Swap A/B
          </button>
          <BuildLockControls
            targetConstraints={targetConstraints}
            setTargetConstraints={setTargetConstraints}
            targetTraitLock={targetTraitLock}
            setTargetTraitLock={setTargetTraitLock}
            targetAscensionLock={targetAscensionLock}
            setTargetAscensionLock={setTargetAscensionLock}
            targetPlushieLock={targetPlushieLock}
            setTargetPlushieLock={setTargetPlushieLock}
            targetElderLock={targetElderLock}
            setTargetElderLock={setTargetElderLock}
            introNote="Optional locks for optimized Build B (leave empty for full search)."
          />
          <OptimizerRunControls isRunning={isRunning} progress={progress} onRun={runOptimizer} onCancel={cancelRun} />
          {error ? <div className="note">{error}</div> : null}
        </div>
      </div>

      <OptimizerResultsPanel
        results={results}
        resultsLimit={resultsLimit}
        nameA={nameA}
        nameB={nameB}
        onApplyBuildA={onApplyBuildB}
      />
    </section>
  );
}
