import { useEffect, useRef } from "react";
import type { BuildOptions, TwoFacedMode } from "../engine";
import { BestBuildsControlPanel } from "../components/bestBuilds/BestBuildsControlPanel";
import { BestBuildsPoolPreview } from "../components/bestBuilds/BestBuildsPoolPreview";
import { BestBuildsResultsPanel } from "../components/bestBuilds/BestBuildsResultsPanel";
import type { CombatEventPhase } from "../engine/eventOrdering";
import { useBestBuildsPageController } from "./useBestBuildsPageController";
import { useBestBuildsBattleSettings } from "../components/bestBuilds/BestBuildsBattleSettingsContext";
import type { BestBuildsBattleSettings } from "../components/bestBuilds/bestBuildsBattleSettingsTypes";
import type { BestBuildAggregateObjective } from "../optimizer/ranking";
import type { DefaultPoolScope } from "../optimizer/poolUtils";
import { registerMatchSnapshotProvider } from "../shared/matchSnapshot";

type BestBuildsSnapshotState = {
  nameA: string;
  searchDepth: "soft" | "detailed";
  objective: BestBuildAggregateObjective;
  winRateGuardPct: number;
  // BestBuildPoolMode is a controller-local union; widen to string here.
  poolMode: string;
  poolScope: DefaultPoolScope;
  selectedPoolTiers: number[];
  customPoolText: string;
  targetConstraints: BuildOptions;
  excludedTraits: string[];
  excludedPlushies: string[];
  targetTraitLock: boolean;
  targetAscensionLock: boolean;
  targetPlushieLock: boolean;
  targetElderLock: boolean;
  showAllAscensionDistributions: boolean;
  twoFacedMode: TwoFacedMode;
  battleSettings: BestBuildsBattleSettings;
};

export type BestBuildsPageProps = {
  nameA: string;
  creatures: Array<{ name: string; stats: { tier: number } }>;
  creatureNames: string[];
  trueDeveloperMode: boolean;
  combatEventOrder: CombatEventPhase[];
  onNameAChange: (value: string) => void;
  onApplyBuildA: (value: BuildOptions) => void;
};

export default function BestBuildsPage({
  nameA,
  creatures,
  creatureNames,
  trueDeveloperMode,
  combatEventOrder,
  onNameAChange,
  onApplyBuildA,
}: BestBuildsPageProps) {
  const tierOptions = Array.from(new Set(creatures.map((creature) => creature.stats.tier))).sort((a, b) => a - b);
  const {
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
    expandedResultKey,
    currentPerOpponentRows,
    loadingPerOpponentKey,
    targetConstraints,
    setTargetConstraints,
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
  } = useBestBuildsPageController({ nameA, availableCreatures: creatures, combatEventOrder });

  const { settings: bbBattleSettings, setSettings: setBbBattleSettings } = useBestBuildsBattleSettings();

  // Share-Match snapshot provider. Refs mirror shareable setup + the
  // computed pool each render so the provider (registered once) reads
  // current values. Participants are the fixed creature + the pool it
  // is optimized against.
  const shareSnapshotRef = useRef<BestBuildsSnapshotState | null>(null);
  shareSnapshotRef.current = {
    nameA,
    searchDepth,
    objective,
    winRateGuardPct,
    poolMode,
    poolScope,
    selectedPoolTiers,
    customPoolText,
    targetConstraints,
    excludedTraits,
    excludedPlushies,
    targetTraitLock,
    targetAscensionLock,
    targetPlushieLock,
    targetElderLock,
    showAllAscensionDistributions,
    twoFacedMode,
    battleSettings: bbBattleSettings,
  };
  const activePoolRef = useRef<string[]>([]);
  activePoolRef.current = activePool;
  useEffect(() => {
    return registerMatchSnapshotProvider({
      page: "bestBuilds",
      getSnapshot: () => {
        const s = shareSnapshotRef.current!;
        return {
          pageState: { ...s } as unknown as Record<string, unknown>,
          participantCreatureNames: [s.nameA, ...activePoolRef.current].filter((n): n is string => Boolean(n)),
        };
      },
      applySnapshot: (pageState) => {
        const s = pageState as Partial<BestBuildsSnapshotState>;
        if (typeof s.nameA === "string") onNameAChange(s.nameA);
        if (s.searchDepth !== undefined) setSearchDepth(s.searchDepth);
        if (s.objective !== undefined) setObjective(s.objective);
        if (s.winRateGuardPct !== undefined) setWinRateGuardPct(s.winRateGuardPct);
        if (s.poolMode !== undefined) setPoolMode(s.poolMode as Parameters<typeof setPoolMode>[0]);
        if (s.poolScope !== undefined) setPoolScope(s.poolScope);
        if (s.selectedPoolTiers !== undefined) setSelectedPoolTiers(s.selectedPoolTiers);
        if (s.customPoolText !== undefined) setCustomPoolText(s.customPoolText);
        if (s.targetConstraints) setTargetConstraints(s.targetConstraints);
        if (s.excludedTraits !== undefined) setExcludedTraits(s.excludedTraits);
        if (s.excludedPlushies !== undefined) setExcludedPlushies(s.excludedPlushies);
        if (s.targetTraitLock !== undefined) setTargetTraitLock(s.targetTraitLock);
        if (s.targetAscensionLock !== undefined) setTargetAscensionLock(s.targetAscensionLock);
        if (s.targetPlushieLock !== undefined) setTargetPlushieLock(s.targetPlushieLock);
        if (s.targetElderLock !== undefined) setTargetElderLock(s.targetElderLock);
        if (s.showAllAscensionDistributions !== undefined) setShowAllAscensionDistributions(s.showAllAscensionDistributions);
        if (s.twoFacedMode !== undefined) setTwoFacedMode(s.twoFacedMode);
        if (s.battleSettings) setBbBattleSettings(s.battleSettings);
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- listed deps are stable useState setters (opaque through the controller hook)
  }, [onNameAChange]);

  useEffect(() => {
    if (!trueDeveloperMode || typeof window === "undefined") return;
    const devApi = {
      configure: ({
        creatureName,
        nextSearchDepth,
        nextPoolMode,
        nextPoolScope,
        nextSelectedPoolTiers,
        nextObjective,
      }: {
        creatureName?: string;
        nextSearchDepth?: "soft" | "detailed";
        nextPoolMode?:
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
        nextPoolScope?: "sameOrHigher" | "sameOrLower" | "withinOneTier" | "exactTiers";
        nextSelectedPoolTiers?: number[];
        nextObjective?: "winRate" | "survival" | "avgDps" | "avgTtk" | "immortalDamage";
      }) => {
        if (creatureName) onNameAChange(creatureName);
        if (nextSearchDepth) setSearchDepth(nextSearchDepth);
        if (nextPoolMode) setPoolMode(nextPoolMode);
        if (nextPoolScope) setPoolScope(nextPoolScope);
        if (nextSelectedPoolTiers) setSelectedPoolTiers([...nextSelectedPoolTiers].sort((a, b) => a - b));
        if (nextObjective) setObjective(nextObjective);
      },
      setCreature: onNameAChange,
      setSearchDepth,
      setPoolMode,
      setPoolScope,
      setSelectedPoolTiers,
      setObjective,
      runBestBuilds: async () => await runBestBuilds(),
      getResultsState: () => ({
        count: results.length,
        topResults: results.slice(0, 3).map((item, index) => ({
          index,
          build: item.build,
          activesOn: item.activesOn,
          breathOn: item.breathOn,
        })),
      }),
      getRunState: () => ({
        isRunning,
        runtimePathTelemetry: lastRunRuntimePathTelemetry,
      }),
      getConfigState: () => ({
        creatureName: nameA,
        activePoolLength: activePool.length,
        poolScope,
        selectedPoolTiers,
      }),
    };
    Reflect.set(window, "__bestBuildsDevApi", devApi);
    return () => {
      if (Reflect.get(window, "__bestBuildsDevApi") === devApi) {
        Reflect.deleteProperty(window, "__bestBuildsDevApi");
      }
    };
  }, [
    trueDeveloperMode,
    onNameAChange,
    setSearchDepth,
    setPoolMode,
    setPoolScope,
    setSelectedPoolTiers,
    setObjective,
    runBestBuilds,
    isRunning,
    lastRunRuntimePathTelemetry,
    nameA,
    activePool.length,
    poolScope,
    selectedPoolTiers,
    results,
  ]);

  return (
    <section className="panel">
      <div className="panel-grid">
        <BestBuildsControlPanel
          trueDeveloperMode={trueDeveloperMode}
          creatureNames={creatureNames}
          nameA={nameA}
          onNameAChange={onNameAChange}
          searchDepth={searchDepth}
          setSearchDepth={setSearchDepth}
          objective={objective}
          setObjective={setObjective}
          winRateGuardPct={winRateGuardPct}
          setWinRateGuardPct={setWinRateGuardPct}
          poolMode={poolMode}
          setPoolMode={setPoolMode}
          poolScope={poolScope}
          setPoolScope={setPoolScope}
          tierOptions={tierOptions}
          selectedPoolTiers={selectedPoolTiers}
          setSelectedPoolTiers={setSelectedPoolTiers}
          customPool={customPool}
          customPoolText={customPoolText}
          setCustomPoolText={setCustomPoolText}
          customPickerQuery={customPickerQuery}
          setCustomPickerQuery={setCustomPickerQuery}
          filteredCustomChoices={filteredCustomChoices}
          selectedCustomSet={selectedCustomSet}
          addToCustomPool={addToCustomPool}
          removeFromCustomPool={removeFromCustomPool}
          activePoolLength={activePool.length}
          targetConstraints={targetConstraints}
          setTargetConstraints={setTargetConstraints}
          excludedTraits={excludedTraits}
          toggleExcludedTrait={toggleExcludedTrait}
          traitBlacklistOptions={traitBlacklistOptions}
          excludedPlushies={excludedPlushies}
          toggleExcludedPlushie={toggleExcludedPlushie}
          plushieBlacklistOptions={plushieBlacklistOptions}
          targetTraitLock={targetTraitLock}
          setTargetTraitLock={setTargetTraitLock}
          targetAscensionLock={targetAscensionLock}
          setTargetAscensionLock={setTargetAscensionLock}
          targetPlushieLock={targetPlushieLock}
          setTargetPlushieLock={setTargetPlushieLock}
          targetElderLock={targetElderLock}
          setTargetElderLock={setTargetElderLock}
          showAllAscensionDistributions={showAllAscensionDistributions}
          setShowAllAscensionDistributions={setShowAllAscensionDistributions}
          copyPoolCode={copyPoolCode}
          runBestBuilds={runBestBuilds}
          canRun={Boolean(creature) && activePool.length > 0}
          isRunning={isRunning}
          cancelRun={cancelRun}
          progress={progress}
          lastRunMs={lastRunMs}
          lastRunTimings={lastRunTimings}
          lastRunRuntimePathTelemetry={lastRunRuntimePathTelemetry}
          runtimeRequirementError={runtimeRequirementError}
          twoFacedMode={twoFacedMode}
          setTwoFacedMode={setTwoFacedMode}
          activePool={activePool}
        />
        <BestBuildsPoolPreview activePool={activePool} />
        <BestBuildsResultsPanel
          trueDeveloperMode={trueDeveloperMode}
          results={results}
          topResultDiagnostic={topResultDiagnostic}
          expandedResultKey={expandedResultKey}
          loadingPerOpponentKey={loadingPerOpponentKey}
          currentPerOpponentRows={currentPerOpponentRows}
          onApplyBuildA={onApplyBuildA}
          onCopyBuildHeader={(item, idx) => copyBuildHeader(item, idx, nameA)}
          onTogglePerOpponent={(item, idx) => loadPerOpponentRows(item, idx, nameA)}
        />
      </div>
    </section>
  );
}


