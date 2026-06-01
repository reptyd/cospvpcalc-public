import type { BuildOptions } from "../../engine";
import { veneration } from "../../engine/buildData";
import { ToggleSwitch } from "../ToggleSwitch";

type OptimizerBasicSettingsProps = {
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
};

export function OptimizerBasicSettings({
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
}: OptimizerBasicSettingsProps) {
  return (
    <>
      <h3>Settings</h3>
      {optimizationMode !== "guaranteed" && (
        <div className="field">
          <label>Quality vs Speed</label>
          <select aria-label="Quality vs Speed" value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>
            <option value="fast">Fast</option>
            <option value="balanced">Balanced</option>
            <option value="quality">Quality</option>
          </select>
        </div>
      )}
      <div className="field">
        <label>Optimization Mode</label>
        <select aria-label="Optimization Mode" value={optimizationMode} onChange={(e) => setOptimizationMode(e.target.value as typeof optimizationMode)}>
          <option value="fast">Fast</option>
          <option value="guaranteed">Absolute</option>
        </select>
      </div>
      <ToggleSwitch
        checked={optimizePlushies}
        onChange={setOptimizePlushies}
        label="Optimize Plushies (OFF = traits only)"
      />
      <div className="field">
        <label>Optimization Goal</label>
        <select aria-label="Optimization Goal" value={optimizationGoal} onChange={(e) => setOptimizationGoal(e.target.value as typeof optimizationGoal)}>
          <option value="lexicographic">Win Priority (Recommended)</option>
          <option value="effectiveDamage">Max effective damage</option>
          <option value="dps">Max DPS</option>
        </select>
      </div>
      <div className="field">
        <label>Optimized Side Veneration</label>
        <select aria-label="Optimized Side Veneration" value={targetVenerationMode} onChange={(e) => setTargetVenerationMode(e.target.value as "auto" | "fixed")}>
          <option value="auto">Auto (max stage)</option>
          <option value="fixed">Fixed stage</option>
        </select>
      </div>
      {targetVenerationMode === "fixed" ? (
        <div className="field">
          <label>Fixed Stage</label>
          <select
            aria-label="Fixed Stage"
            value={targetConstraints.venerationStage}
            onChange={(e) => setTargetConstraints({ ...targetConstraints, venerationStage: Number(e.target.value) })}
          >
            {Array.from({ length: veneration.stages + 1 }, (_, idx) => (
              <option key={idx} value={idx}>
                {idx}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label>Results to show</label>
        <select aria-label="Results to show" value={resultsLimit} onChange={(e) => setResultsLimit(Number(e.target.value))}>
          {[1, 10, 20, 50, 100].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
