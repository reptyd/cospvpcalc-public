import type { BuildOptions, TwoFacedMode } from "../../engine";
import { creatureByName } from "../../engine/creatureData";
import { creatureHasAbility } from "../compare/compareSpecialAbilities";
import type { GuaranteedOptimizerStats } from "../../pages/optimizerLegacyTypes";
import { OptimizerAdvancedSettings } from "./OptimizerAdvancedSettings";
import { OptimizerBasicSettings } from "./OptimizerBasicSettings";
import { BestBuildsBattleSettingsPanel } from "../bestBuilds/BestBuildsBattleSettings";

type OptimizerSettingsPanelProps = {
  quality: "fast" | "balanced" | "quality";
  setQuality: (value: "fast" | "balanced" | "quality") => void;
  optimizePlushies: boolean;
  setOptimizePlushies: (value: boolean) => void;
  optimizationMode: "fast" | "guaranteed";
  setOptimizationMode: (value: "fast" | "guaranteed") => void;
  optimizationGoal: "lexicographic" | "effectiveDamage" | "dps";
  setOptimizationGoal: (value: "lexicographic" | "effectiveDamage" | "dps") => void;
  targetVenerationMode: "auto" | "fixed";
  setTargetVenerationMode: (value: "auto" | "fixed") => void;
  targetConstraints: BuildOptions;
  setTargetConstraints: (value: BuildOptions) => void;
  resultsLimit: number;
  setResultsLimit: (value: number) => void;
  developerMode: boolean;
  searchAllVeneration: boolean;
  setSearchAllVeneration: (value: boolean) => void;
  searchToggles: boolean;
  setSearchToggles: (value: boolean) => void;
  debugPreScore: boolean;
  setDebugPreScore: (value: boolean) => void;
  stage1TopK: number;
  setStage1TopK: (value: number) => void;
  stage2Cap: number;
  setStage2Cap: (value: number) => void;
  diversifyPlushiePairs: boolean;
  setDiversifyPlushiePairs: (value: boolean) => void;
  useWorkers: boolean;
  setUseWorkers: (value: boolean) => void;
  guaranteedStats: GuaranteedOptimizerStats | null;
  twoFacedMode: TwoFacedMode;
  setTwoFacedMode: (value: TwoFacedMode) => void;
  nameA: string;
  nameB: string;
};

export function OptimizerSettingsPanel({
  quality,
  setQuality,
  optimizePlushies,
  setOptimizePlushies,
  optimizationMode,
  setOptimizationMode,
  optimizationGoal,
  setOptimizationGoal,
  targetVenerationMode,
  setTargetVenerationMode,
  targetConstraints,
  setTargetConstraints,
  resultsLimit,
  setResultsLimit,
  developerMode,
  searchAllVeneration,
  setSearchAllVeneration,
  searchToggles,
  setSearchToggles,
  debugPreScore,
  setDebugPreScore,
  stage1TopK,
  setStage1TopK,
  stage2Cap,
  setStage2Cap,
  diversifyPlushiePairs,
  setDiversifyPlushiePairs,
  useWorkers,
  setUseWorkers,
  guaranteedStats,
  twoFacedMode,
  setTwoFacedMode,
  nameA,
  nameB,
}: OptimizerSettingsPanelProps) {
  const sourceA = creatureByName[nameA];
  const sourceB = creatureByName[nameB];
  const showTwoFacedToggle =
    creatureHasAbility(sourceA, "Two-Faced") || creatureHasAbility(sourceB, "Two-Faced");
  return (
    <div className="panel-block">
      <OptimizerBasicSettings
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
      />
      <OptimizerAdvancedSettings
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
        optimizePlushies={optimizePlushies}
        guaranteedStats={guaranteedStats}
        optimizationMode={optimizationMode}
      />
      {/* In Optimizer the search is Counter-mode: Creature B's build is
          optimized against fixed Creature A. The BB engine receives
          `creature: B, activePool: [A]` (see useOptimizerPageController),
          so source = nameB and the opponent "pool" is just nameA. */}
      <BestBuildsBattleSettingsPanel
        sourceName={nameB}
        opponentNames={[nameA]}
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
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                className={twoFacedMode === m.id ? "compare-special-level-button active" : "compare-special-level-button"}
                onClick={() => setTwoFacedMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="note">
            {twoFacedMode === "madness"
              ? "Madness: ×0.625 damage, ×0.625 bite cooldown. Applies to every Two-Faced owner in this run."
              : "Tranquility: ×1.6 damage, ×1.6 bite cooldown. Applies to every Two-Faced owner in this run."}
          </span>
        </div>
      ) : null}
    </div>
  );
}
