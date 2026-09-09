import type { Dispatch, SetStateAction } from "react";
import type { BuildOptions } from "../../engine";
import { AscensionSelectors, ElderSelector, PlushieSelectors, TraitSelectors } from "../BuildSelectors";
import { ToggleSwitch } from "../ToggleSwitch";

type BuildLockControlsProps = {
  targetConstraints: BuildOptions;
  setTargetConstraints: Dispatch<SetStateAction<BuildOptions>>;
  targetTraitLock: boolean;
  setTargetTraitLock: (value: boolean) => void;
  targetAscensionLock: boolean;
  setTargetAscensionLock: (value: boolean) => void;
  targetPlushieLock: boolean;
  setTargetPlushieLock: (value: boolean) => void;
  targetElderLock: boolean;
  setTargetElderLock: (value: boolean) => void;
  introNote?: string;
};

export function BuildLockControls({
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
  introNote,
}: BuildLockControlsProps) {
  return (
    <>
      {introNote ? <div className="note">{introNote}</div> : null}
      <ToggleSwitch
        checked={targetTraitLock}
        onChange={setTargetTraitLock}
        label="Lock trait selection"
        description={targetTraitLock ? "Use selected traits only." : "Traits are fully automatic."}
      />
      {targetTraitLock && (
        <div className="field">
          <label>Traits</label>
          <TraitSelectors build={targetConstraints} onBuildChange={setTargetConstraints} />
        </div>
      )}
      <ToggleSwitch
        checked={targetAscensionLock}
        onChange={setTargetAscensionLock}
        label="Lock ascension distribution"
        description={
          targetAscensionLock
            ? "Use entered trait point distribution."
            : "Ascension distribution is automatic."
        }
      />
      {targetTraitLock && targetAscensionLock && (
        <div className="field">
          <label>Ascension</label>
          <AscensionSelectors build={targetConstraints} onBuildChange={setTargetConstraints} />
        </div>
      )}
      {!targetTraitLock && targetAscensionLock && (
        <div className="note">Ascension lock works only when trait lock is enabled.</div>
      )}
      <ToggleSwitch
        checked={targetPlushieLock}
        onChange={setTargetPlushieLock}
        label="Lock plushie selection"
        description={targetPlushieLock ? "Use selected plushies only." : "Plushies are automatic."}
      />
      {targetPlushieLock && (
        <div className="field">
          <label>Plushies</label>
          <PlushieSelectors build={targetConstraints} onBuildChange={setTargetConstraints} />
        </div>
      )}
      <ToggleSwitch
        checked={targetElderLock}
        onChange={setTargetElderLock}
        label="Lock elder selection"
        description={targetElderLock ? "Use the selected elder only." : "Elder is automatic."}
      />
      {targetElderLock && (
        <div className="field">
          <label>Elder</label>
          <ElderSelector build={targetConstraints} onBuildChange={setTargetConstraints} />
        </div>
      )}
    </>
  );
}
