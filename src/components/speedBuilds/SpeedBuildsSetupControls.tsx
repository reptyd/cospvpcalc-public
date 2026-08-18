import { useId } from "react";
import { CreatureNameInput } from "../CreatureNameInput";
import { IconImg } from "../IconImg";
import type { SpeedBuildsController } from "../../pages/useSpeedBuildsPageController";
import { channelLabel, isLowerBetter, RANK_BY_LABELS, type SpeedRankBy } from "../../pages/speedBuildsShared";
import { SpeedBuildsLoadoutControls } from "./SpeedBuildsLoadoutControls";

type SpeedBuildsSetupControlsProps = {
  controller: SpeedBuildsController;
  nameA: string;
  creatureNames: string[];
  onNameAChange: (value: string) => void;
  getCreatureIcon: (name: string) => string | null;
};

export function SpeedBuildsSetupControls({
  controller,
  nameA,
  creatureNames,
  onNameAChange,
  getCreatureIcon,
}: SpeedBuildsSetupControlsProps) {
  const creatureId = useId();
  const targetId = useId();
  const rankById = useId();
  const { mode, setMode, target, setTarget, targets, manualBuild, setManualBuild } = controller;

  return (
    <>
      <h3>Speed Builds</h3>
      <p className="muted">
        Movement speed, not combat. Only effects you can put on yourself are counted - anything an opponent
        applies to you is out of scope.
      </p>
      <div className="field">
        <label>Mode</label>
        <div
          className="compare-special-level-grid compare-special-level-grid--pair"
          role="tablist"
          aria-label="Speed Builds mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "optimize"}
            className={mode === "optimize" ? "compare-special-level-button active" : "compare-special-level-button"}
            onClick={() => setMode("optimize")}
          >
            Optimize
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "manual"}
            className={mode === "manual" ? "compare-special-level-button active" : "compare-special-level-button"}
            onClick={() => setMode("manual")}
          >
            Manual
          </button>
        </div>
        <div className="note">
          {mode === "optimize"
            ? "Ranks every reachable build on one channel."
            : "Equip a build and read the speed it produces."}
        </div>
      </div>
      <div className="field">
        <label htmlFor={creatureId}>Creature</label>
        <div className="icon-input">
          <IconImg src={getCreatureIcon(nameA)} alt={nameA} size={36} />
          <CreatureNameInput
            id={creatureId}
            value={nameA}
            onChange={onNameAChange}
            creatureNames={creatureNames}
            placeholder="Search creature..."
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={targetId}>{mode === "optimize" ? "Rank by" : "Focus"}</label>
        <select
          id={targetId}
          value={target}
          disabled={targets.length === 0}
          onChange={(event) => setTarget(event.target.value as typeof target)}
        >
          {targets.length === 0 ? <option value={target}>{channelLabel(target)}</option> : null}
          {targets.map((channel) => (
            <option key={channel} value={channel}>
              {channelLabel(channel)}
              {isLowerBetter(channel) ? " (lower is better)" : ""}
            </option>
          ))}
        </select>
        <div className="note">
          Only the channels this creature has and something can move.
          {mode === "manual" ? " Marks one row in the table below." : ""}
        </div>
      </div>
      {/* Only a held effect makes the two orders differ; with nothing held there
          is one ranking and a switch between two names for it. */}
      {mode === "optimize" && controller.holding ? (
        <div className="field">
          <label htmlFor={rankById}>Rank on</label>
          <select
            id={rankById}
            value={controller.rankBy}
            onChange={(event) => controller.setRankBy(event.target.value as SpeedRankBy)}
          >
            {(Object.keys(RANK_BY_LABELS) as SpeedRankBy[]).map((option) => (
              <option key={option} value={option}>
                {RANK_BY_LABELS[option]}
              </option>
            ))}
          </select>
          <div className="note">Peak counts what you hold, sustained does not.</div>
        </div>
      ) : null}
      {mode === "manual" ? <SpeedBuildsLoadoutControls build={manualBuild} onBuildChange={setManualBuild} /> : null}
    </>
  );
}
