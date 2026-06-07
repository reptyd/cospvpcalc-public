import { estimateCandidateCount } from "../../optimizer/candidateGeneration";
import type { GuaranteedOptimizerStats } from "../../pages/optimizerLegacyTypes";
import { ToggleSwitch } from "../ToggleSwitch";

type OptimizerAdvancedSettingsProps = {
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
  optimizePlushies: boolean;
  guaranteedStats: GuaranteedOptimizerStats | null;
  optimizationMode: "fast" | "guaranteed";
};

export function OptimizerAdvancedSettings({
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
  optimizePlushies,
  guaranteedStats,
  optimizationMode,
}: OptimizerAdvancedSettingsProps) {
  if (!developerMode) {
    return <div className="note">Advanced sampling/debug controls are hidden. Enable Developer Mode to tune internals.</div>;
  }

  return (
    <>
      <h3>Advanced</h3>
      <ToggleSwitch
        checked={searchAllVeneration}
        onChange={setSearchAllVeneration}
        label="Search all veneration stages"
        description="Default uses stage 5 only."
      />
      <ToggleSwitch checked={searchToggles} onChange={setSearchToggles} label="Advanced: search toggles" />
      <ToggleSwitch checked={debugPreScore} onChange={setDebugPreScore} label="Debug: log preScore top20" />
      <div className="field">
        <label>Stage1 TopK</label>
        <select aria-label="Stage1 TopK preset" value={stage1TopK} onChange={(e) => setStage1TopK(Number(e.target.value))}>
          {[100, 200, 400, 800].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <input
          aria-label="Stage1 TopK custom value"
          type="number"
          min={20}
          max={5000}
          value={stage1TopK}
          onChange={(e) => setStage1TopK(Math.max(20, Math.min(5000, Number(e.target.value))))}
        />
      </div>
      <div className="field">
        <label>Stage2 Pool Cap</label>
        <select aria-label="Stage2 Pool Cap preset" value={stage2Cap} onChange={(e) => setStage2Cap(Number(e.target.value))}>
          {[60, 120, 180, 240].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <input
          aria-label="Stage2 Pool Cap custom value"
          type="number"
          min={20}
          max={500}
          value={stage2Cap}
          onChange={(e) => setStage2Cap(Math.max(20, Math.min(500, Number(e.target.value))))}
        />
      </div>
      <ToggleSwitch
        checked={diversifyPlushiePairs}
        onChange={setDiversifyPlushiePairs}
        label="Diversify by plushie pair"
      />
      <ToggleSwitch checked={useWorkers} onChange={setUseWorkers} label="Use Web Workers in Guaranteed mode" />
      <div className="note">
        Estimated candidates: {estimateCandidateCount({ searchAllVeneration, searchToggles, optimizePlushies })}
      </div>
      <div className="note">
        Estimated stage2 sims: ~{stage2Cap}
        {stage2Cap > 200 ? " (may be slow)" : ""}
      </div>
      {optimizationMode === "guaranteed" && guaranteedStats && (
        <div className="note">
          Guaranteed space: plushies {guaranteedStats.filteredPlushies}, plushiePairs {guaranteedStats.plushiePairs},
          traitPairs {guaranteedStats.traitPairs}, splits {guaranteedStats.splitsPerSkeleton} to expected{" "}
          {guaranteedStats.expectedTotalSims}, evaluated {guaranteedStats.actualEvaluated}, skeletons{" "}
          {guaranteedStats.skeletonsEvaluated}
          {guaranteedStats.workerEnabled
            ? `, workers ${guaranteedStats.workerUsed ? "used" : "not used"} (${guaranteedStats.workerCount ?? 0} x chunk ${guaranteedStats.chunkSize ?? 0})${guaranteedStats.workerFallback ? ", fallback main thread" : ""}`
            : ""}
          {guaranteedStats.workerError ? `, worker error: ${guaranteedStats.workerError}` : ""}
        </div>
      )}
    </>
  );
}
