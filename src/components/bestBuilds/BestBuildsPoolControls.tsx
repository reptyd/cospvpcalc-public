import { useId } from "react";
import { creatureByName, getCreatureIcon } from "../../engine/creatureData";
import type { BestBuildsRuntimePathTelemetry, BestBuildsStageTimings } from "../../optimizer/bestBuildsPageFlow";
import type { DefaultPoolScope } from "../../optimizer/poolUtils";
import type { BestBuildAggregateObjective } from "../../optimizer/ranking";
import { formatRoundedPercent, formatRoundedSeconds } from "../../shared/displayFormat";
import { IconImg } from "../IconImg";
import { CreatureNameInput } from "../CreatureNameInput";

type BestBuildsPoolControlsProps = {
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
};

export function BestBuildsPoolControls({
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
}: BestBuildsPoolControlsProps) {
  const buildHash = (import.meta.env.VITE_BUILD_HASH ?? "local").toString();
  const rustWasmVersion = (import.meta.env.VITE_RUST_WASM_VERSION ?? "unknown").toString();
  // Stable per-mount ids so each <label htmlFor> reaches the right
  // control. `useId` is the React 18+ SSR-safe primitive.
  const creatureId = useId();
  const searchDepthId = useId();
  const objectiveId = useId();
  const winRateGuardId = useId();
  const poolSizeId = useId();
  const tierRangeId = useId();
  const customPickerId = useId();
  const customPoolCodeId = useId();

  const formatPathCounts = (counts: Record<string, number>) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([path, count]) => `${path} ${count}`)
      .join(", ");
  const togglePoolTier = (tier: number) => {
    setSelectedPoolTiers(
      selectedPoolTiers.includes(tier)
        ? selectedPoolTiers.filter((value) => value !== tier)
        : [...selectedPoolTiers, tier].sort((a, b) => a - b),
    );
  };

  return (
    <>
      <h3>Best Builds (aggregate)</h3>
      <div className="field">
        <label htmlFor={creatureId}>Creature</label>
        <CreatureNameInput id={creatureId} value={nameA} onChange={onNameAChange} creatureNames={creatureNames} />
      </div>
      <div className="field">
        <label htmlFor={searchDepthId}>Search depth</label>
        <select id={searchDepthId} value={searchDepth} onChange={(e) => setSearchDepth(e.target.value as typeof searchDepth)}>
          <option value="soft">Soft</option>
          <option value="detailed">Detailed</option>
        </select>
        <div className="note">Both modes use 2 phases: fast shortlist, then full pass on shortlisted builds.</div>
      </div>
      {trueDeveloperMode ? (
        <div className="field">
          <div className="note">Build: {buildHash} | Rust wasm: {rustWasmVersion}</div>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={objectiveId}>Objective</label>
        <select id={objectiveId} value={objective} onChange={(e) => setObjective(e.target.value as BestBuildAggregateObjective)}>
          <option value="winRate">Win rate first</option>
          <option value="survival">Survival time first</option>
          <option value="avgDps">Average DPS</option>
          <option value="avgTtk">Avg TTK (lower better)</option>
          <option value="immortalDamage">Average effective damage</option>
        </select>
      </div>
      {trueDeveloperMode ? (
        <div className="field">
          <label htmlFor={winRateGuardId}>Win-rate guard (%)</label>
          <input
            id={winRateGuardId}
            type="number"
            min={0}
            max={30}
            step={1}
            value={winRateGuardPct}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              setWinRateGuardPct(Math.max(0, Math.min(30, next)));
            }}
          />
          <div className="note">Keep candidates within this % from best win-rate before objective sorting.</div>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={poolSizeId}>Pool size</label>
        <select id={poolSizeId} value={poolMode} onChange={(e) => setPoolMode(e.target.value as typeof poolMode)}>
          <option value="meta40">Meta-40</option>
          <option value="meta60">Meta-60</option>
          <option value="meta80">Meta-80</option>
          <option value="meta120">Meta-120</option>
          <option value="meta160">Meta-160</option>
          <option value="meta200">Meta-200</option>
          <option value="meta240">Meta-240</option>
          <option value="meta280">Meta-280</option>
          <option value="meta320">Meta-320</option>
          <option value="custom">Custom list</option>
        </select>
        <div className="note">Choose how many opponents to include in the automatic meta pool.</div>
      </div>
      {poolMode !== "custom" ? (
        <div className="field">
          <label htmlFor={tierRangeId}>Tier range</label>
          <select id={tierRangeId} value={poolScope} onChange={(e) => setPoolScope(e.target.value as DefaultPoolScope)}>
            <option value="sameOrHigher">Your tier and above</option>
            <option value="sameOrLower">Your tier and below</option>
            <option value="withinOneTier">Within 1 tier of yours</option>
            <option value="exactTiers">Exact tiers</option>
          </select>
          <div className="note">
            {poolScope === "exactTiers"
              ? "Pick one or more exact tiers for the automatic pool."
              : "Filters by tier first. Inside that range, the auto pool still tries to stay varied instead of clustering around one kind of creature."}
          </div>
          {poolScope === "exactTiers" ? (
            <>
              <div className="custom-pool-list">
                {tierOptions.map((tier) => {
                  const selected = selectedPoolTiers.includes(tier);
                  return (
                    <button
                      key={`tier-${tier}`}
                      type="button"
                      className={`custom-pool-item ${selected ? "selected" : ""}`}
                      onClick={() => togglePoolTier(tier)}
                    >
                      <span className="pool-name">T{tier}</span>
                    </button>
                  );
                })}
              </div>
              <div className="note">
                {selectedPoolTiers.length > 0
                  ? `Selected exact tiers: ${selectedPoolTiers.map((tier) => `T${tier}`).join(", ")}`
                  : "No exact tiers selected yet."}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {poolMode === "custom" ? (
        <>
          <div className="field">
            <label>Selected in custom pool ({customPool.length})</label>
            {customPool.length === 0 ? (
              <div className="muted">No creatures selected yet.</div>
            ) : (
              <div className="custom-pool-list selected-list">
                {customPool.map((name) => {
                  const row = creatureByName[name];
                  return (
                    <button
                      key={`selected-${name}`}
                      type="button"
                      className="custom-pool-item selected"
                      onClick={() => removeFromCustomPool(name)}
                      title="Click to remove"
                    >
                      <IconImg src={getCreatureIcon(name)} alt={name} size={22} />
                      <span className="pool-name">{name}</span>
                      <span className="pool-tier">T{row?.stats.tier ?? "?"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor={customPickerId}>Custom pool picker</label>
            <input
              id={customPickerId}
              placeholder="Search creature..."
              value={customPickerQuery}
              onChange={(e) => setCustomPickerQuery(e.target.value)}
            />
            <div className="custom-pool-list">
              {filteredCustomChoices.map((name) => {
                const selected = selectedCustomSet.has(name);
                const row = creatureByName[name];
                return (
                  <button
                    key={name}
                    type="button"
                    className={`custom-pool-item ${selected ? "selected" : ""}`}
                    onClick={() => (selected ? removeFromCustomPool(name) : addToCustomPool(name))}
                  >
                    <IconImg src={getCreatureIcon(name)} alt={name} size={22} />
                    <span className="pool-name">{name}</span>
                    <span className="pool-tier">T{row?.stats.tier ?? "?"}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="field">
            <label htmlFor={customPoolCodeId}>Custom pool code (names split by comma/newline/|)</label>
            <textarea
              id={customPoolCodeId}
              value={customPoolText}
              onChange={(e) => setCustomPoolText(e.target.value)}
              rows={4}
            />
          </div>
        </>
      ) : null}
      <div className="note">Current pool size: {activePoolLength}</div>
      <div className="note">
        Temporary baseline for pool enemies: Veneration 5, Traits Damage+Bite (Damage ascension max), Plushies Void+Void.
      </div>
      <div className="row-actions">
        <button className="secondary" type="button" onClick={() => void copyPoolCode()}>
          Copy Pool Code
        </button>
        <button className="primary" type="button" onClick={() => void runBestBuilds()} disabled={!canRun || isRunning}>
          Calculate
        </button>
        {isRunning ? (
          <button className="secondary" type="button" onClick={cancelRun}>
            Cancel
          </button>
        ) : null}
      </div>
      {isRunning ? <div className="note">Progress: {formatRoundedPercent(progress * 100)}</div> : null}
      {lastRunMs != null ? <div className="note">Calculation time: {formatRoundedSeconds(lastRunMs / 1000)}</div> : null}
      {runtimeRequirementError ? <div className="note" style={{ color: "#ffb4a7" }}>{runtimeRequirementError}</div> : null}
      {trueDeveloperMode && lastRunTimings ? (
        <div className="note">
          Stage timings: candidate {formatRoundedSeconds(lastRunTimings.candidatePrepMs / 1000)}, stage1{" "}
          {formatRoundedSeconds(lastRunTimings.stage1Ms / 1000)}, shortlist {formatRoundedSeconds(lastRunTimings.shortlistMs / 1000)}, stage2{" "}
          {formatRoundedSeconds(lastRunTimings.stage2Ms / 1000)}, refinement {formatRoundedSeconds(lastRunTimings.refinementMs / 1000)},
          finalize {formatRoundedSeconds(lastRunTimings.finalizeMs / 1000)}
        </div>
      ) : null}
      {trueDeveloperMode && lastRunRuntimePathTelemetry ? (
        <div className="note">
          Runtime paths: stage1 {formatPathCounts(lastRunRuntimePathTelemetry.stage1) || "none"}, stage2{" "}
          {formatPathCounts(lastRunRuntimePathTelemetry.stage2) || "none"}
        </div>
      ) : null}
    </>
  );
}
