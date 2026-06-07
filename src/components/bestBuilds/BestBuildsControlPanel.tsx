import type { BuildOptions, TwoFacedMode } from "../../engine";
import { creatureByName } from "../../engine/creatureData";
import { creatureHasAbility } from "../compare/compareSpecialAbilities";
import type { BestBuildsRuntimePathTelemetry, BestBuildsStageTimings } from "../../optimizer/bestBuildsPageFlow";
import type { DefaultPoolScope } from "../../optimizer/poolUtils";
import type { BestBuildAggregateObjective } from "../../optimizer/ranking";
import { BestBuildsConstraintControls } from "./BestBuildsConstraintControls";
import { BestBuildsPoolControls } from "./BestBuildsPoolControls";
import { BestBuildsBattleSettingsPanel } from "./BestBuildsBattleSettings";

type BestBuildsControlPanelProps = {
  trueDeveloperMode: boolean;
  creatureNames: string[];
  nameA: string;
  onNameAChange: (value: string) => void;
  searchDepth: "soft" | "detailed";
  setSearchDepth: (value: "soft" | "detailed") => void;
  objective: BestBuildAggregateObjective;
  setObjective: (value: BestBuildAggregateObjective) => void;
  winRateGuardPct: number;
  setWinRateGuardPct: (value: number) => void;
  poolMode:
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
  setPoolMode: (
    value:
      | "meta40"
      | "meta60"
      | "meta80"
      | "meta120"
      | "meta160"
      | "meta200"
      | "meta240"
      | "meta280"
      | "meta320"
      | "custom",
  ) => void;
  poolScope: DefaultPoolScope;
  setPoolScope: (value: DefaultPoolScope) => void;
  tierOptions: number[];
  selectedPoolTiers: number[];
  setSelectedPoolTiers: (value: number[]) => void;
  customPool: string[];
  customPoolText: string;
  setCustomPoolText: (value: string) => void;
  customPickerQuery: string;
  setCustomPickerQuery: (value: string) => void;
  filteredCustomChoices: string[];
  selectedCustomSet: Set<string>;
  addToCustomPool: (name: string) => void;
  removeFromCustomPool: (name: string) => void;
  activePoolLength: number;
  targetConstraints: BuildOptions;
  setTargetConstraints: (value: BuildOptions) => void;
  excludedTraits: string[];
  toggleExcludedTrait: (value: string) => void;
  traitBlacklistOptions: Array<{ id: string; label: string }>;
  excludedPlushies: string[];
  toggleExcludedPlushie: (value: string) => void;
  plushieBlacklistOptions: string[];
  targetTraitLock: boolean;
  setTargetTraitLock: (value: boolean) => void;
  targetAscensionLock: boolean;
  setTargetAscensionLock: (value: boolean) => void;
  targetPlushieLock: boolean;
  setTargetPlushieLock: (value: boolean) => void;
  targetElderLock: boolean;
  setTargetElderLock: (value: boolean) => void;
  showAllAscensionDistributions: boolean;
  setShowAllAscensionDistributions: (value: boolean) => void;
  copyPoolCode: () => void | Promise<void>;
  runBestBuilds: () => void | Promise<void>;
  canRun: boolean;
  isRunning: boolean;
  cancelRun: () => void;
  progress: number;
  lastRunMs: number | null;
  lastRunTimings: (BestBuildsStageTimings & { candidatePrepMs: number }) | null;
  lastRunRuntimePathTelemetry: BestBuildsRuntimePathTelemetry | null;
  runtimeRequirementError: string | null;
  twoFacedMode: TwoFacedMode;
  setTwoFacedMode: (value: TwoFacedMode) => void;
  activePool: string[];
};

export function BestBuildsControlPanel({
  trueDeveloperMode,
  creatureNames,
  nameA,
  onNameAChange,
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
  tierOptions,
  selectedPoolTiers,
  setSelectedPoolTiers,
  customPool,
  customPoolText,
  setCustomPoolText,
  customPickerQuery,
  setCustomPickerQuery,
  filteredCustomChoices,
  selectedCustomSet,
  addToCustomPool,
  removeFromCustomPool,
  activePoolLength,
  targetConstraints,
  setTargetConstraints,
  excludedTraits,
  toggleExcludedTrait,
  traitBlacklistOptions,
  excludedPlushies,
  toggleExcludedPlushie,
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
  copyPoolCode,
  runBestBuilds,
  canRun,
  isRunning,
  cancelRun,
  progress,
  lastRunMs,
  lastRunTimings,
  lastRunRuntimePathTelemetry,
  runtimeRequirementError,
  twoFacedMode,
  setTwoFacedMode,
  activePool,
}: BestBuildsControlPanelProps) {
  const sourceCreature = creatureByName[nameA];
  const showTwoFacedToggle = creatureHasAbility(sourceCreature, "Two-Faced");
  return (
    <div className="panel-block">
      <BestBuildsPoolControls
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
        activePoolLength={activePoolLength}
        copyPoolCode={copyPoolCode}
        runBestBuilds={runBestBuilds}
        canRun={canRun}
        isRunning={isRunning}
        cancelRun={cancelRun}
        progress={progress}
        lastRunMs={lastRunMs}
        lastRunTimings={lastRunTimings}
        lastRunRuntimePathTelemetry={lastRunRuntimePathTelemetry}
        runtimeRequirementError={runtimeRequirementError}
      />
      <BestBuildsBattleSettingsPanel
        sourceName={nameA}
        opponentNames={activePool}
      />
      {showTwoFacedToggle ? (
        <div className="best-builds-two-faced-mode">
          <div className="compare-buff-heading">
            <span>Two-Faced mode</span>
          </div>
          <div className="compare-special-level-grid">
            {[
              { id: "madness" as const, label: "Madness" },
              { id: "tranquility" as const, label: "Tranquility" },
            ].map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={twoFacedMode === mode.id ? "compare-special-level-button active" : "compare-special-level-button"}
                onClick={() => setTwoFacedMode(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <span className="note">
            {twoFacedMode === "madness"
              ? "Madness: ×0.625 damage, ×0.625 bite cooldown. Applies to the source creature and every opponent that owns Two-Faced."
              : "Tranquility: ×1.6 damage, ×1.6 bite cooldown. Applies to the source creature and every opponent that owns Two-Faced."}
          </span>
        </div>
      ) : null}
      <BestBuildsConstraintControls
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
      />
    </div>
  );
}
