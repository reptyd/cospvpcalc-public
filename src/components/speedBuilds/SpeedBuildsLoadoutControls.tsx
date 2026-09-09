import { useId } from "react";
import type { BuildOptions } from "../../engine/types";
import { veneration } from "../../engine/buildData";
import { BetaSelect } from "../beta/BetaSelect";
import { AscensionSelectors, ElderSelector, PlushiePickerBeta, PlushieSelectors, TraitSelectors } from "../BuildSelectors";
import { plushieCaption, SPEED_ELDER_MODIFIERS } from "../../pages/speedBuildsShared";

/** The five build fields of Manual mode. Shared so the classic control card and
 * the beta live loadout equip a creature the same way; the beta variant swaps
 * the veneration and plushie popups for the pickers the rest of a beta page
 * uses. Traits keep the control Compare and Best Builds give them. */
export function SpeedBuildsLoadoutControls({
  build,
  onBuildChange,
  variant = "classic",
}: {
  build: BuildOptions;
  onBuildChange: (value: BuildOptions) => void;
  variant?: "classic" | "beta";
}) {
  const venerationId = useId();
  const beta = variant === "beta";
  const stages = Array.from({ length: veneration.stages + 1 }, (_, stage) => String(stage));

  return (
    <>
      <div className="field">
        <label htmlFor={beta ? undefined : venerationId}>Veneration</label>
        {beta ? (
          <BetaSelect
            value={String(build.venerationStage)}
            onChange={(value) => onBuildChange({ ...build, venerationStage: Number(value) })}
            options={stages.map((stage) => ({ value: stage, label: stage }))}
            ariaLabel="Veneration"
          />
        ) : (
          <select
            id={venerationId}
            value={build.venerationStage}
            onChange={(event) => onBuildChange({ ...build, venerationStage: Number(event.target.value) })}
          >
            {stages.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="field">
        <label>Traits</label>
        <TraitSelectors build={build} onBuildChange={onBuildChange} />
        <div className="note">Only the Speed trait moves a movement channel.</div>
      </div>
      <div className="field">
        <label>Ascension</label>
        <AscensionSelectors build={build} onBuildChange={onBuildChange} />
      </div>
      <div className="field">
        <label>Plushies</label>
        {beta ? (
          <PlushiePickerBeta build={build} onBuildChange={onBuildChange} describe={plushieCaption} />
        ) : (
          <PlushieSelectors build={build} onBuildChange={onBuildChange} describe={plushieCaption} />
        )}
      </div>
      <div className="field">
        <label>Elder</label>
        {/* Delta chips rather than the summary sentence: on a live page four
            paragraphs of elder prose crowd out the numbers they are changing,
            and Compare already picks an elder this way in the beta shell. */}
        <ElderSelector
          build={build}
          onBuildChange={onBuildChange}
          showDeltaChips={beta}
          modifierKeys={SPEED_ELDER_MODIFIERS}
        />
      </div>
    </>
  );
}
