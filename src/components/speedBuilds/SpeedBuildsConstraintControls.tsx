import { useId, useMemo } from "react";
import type { BuildOptions } from "../../engine/types";
import { getPlushieIcon, plushieByName, veneration } from "../../engine/buildData";
import { DEFAULT_MANUAL_BUILD, plushieCaption, SPEED_ELDER_MODIFIERS } from "../../pages/speedBuildsShared";
import type { SpeedBuildsController } from "../../pages/useSpeedBuildsPageController";
import { SPEED_RELEVANT_PLUSHIES } from "../../speed/speedSearch";
import { BetaSelect } from "../beta/BetaSelect";
import { BlacklistDropdown } from "../BlacklistDropdown";
import { AscensionSelectors, ElderSelector, PlushiePickerBeta, PlushieSelectors, TraitSelectors } from "../BuildSelectors";
import { ToggleSwitch } from "../ToggleSwitch";

/** The five things Optimize will take as given: how far up the tree the reader
 * is, an elder or a trait loadout he has already spent, a plushie he always
 * carries and the ones he does not own. Everything here narrows the sweep, so
 * the ranking answers his question instead of the ideal one.
 *
 * Grouped and revealed the way Best Builds does it: a lock switch states the
 * default in words and only shows the picker once it is thrown. Shared so the
 * classic card and the beta popover offer the same five; the beta variant swaps
 * the veneration and plushie popups for the pickers the rest of a beta page
 * uses. Traits keep the control Compare and Best Builds give them. */
export function SpeedBuildsConstraintControls({
  controller,
  variant = "classic",
}: {
  controller: SpeedBuildsController;
  variant?: "classic" | "beta";
}) {
  const venerationId = useId();
  const { constraints, setConstraints, fixedChoice } = controller;
  const beta = variant === "beta";

  // Only the plushies that can move a movement channel. The other 69 would make
  // a picker of 83 in which 69 entries are guaranteed to change nothing.
  const roster = useMemo(
    () =>
      SPEED_RELEVANT_PLUSHIES.filter((name) => plushieByName[name] !== undefined).sort((a, b) => a.localeCompare(b)),
    [],
  );

  // The lock pickers speak BuildOptions, which is also what they hand back.
  const locked: BuildOptions = {
    ...DEFAULT_MANUAL_BUILD,
    venerationStage: constraints.venerationStage,
    traits: constraints.traits ?? [],
    ascensionAssignments: constraints.ascensionAssignments,
    elder: constraints.elder ?? "None",
  };

  const stages = Array.from({ length: veneration.stages + 1 }, (_, stage) => String(stage));

  // The picker speaks BuildOptions, and its two slots are the two a build has.
  const required: BuildOptions = { ...DEFAULT_MANUAL_BUILD, plushies: constraints.requiredPlushies };

  // A plushie cannot be both carried always and not owned, so setting either
  // side of that pair releases the other.
  const setRequired = (next: BuildOptions) => {
    const requiredPlushies = next.plushies.filter(Boolean);
    setConstraints({
      ...constraints,
      requiredPlushies,
      excludedPlushies: constraints.excludedPlushies.filter((entry) => !requiredPlushies.includes(entry)),
    });
  };

  const toggleExcluded = (name: string) => {
    const excludedPlushies = constraints.excludedPlushies.includes(name)
      ? constraints.excludedPlushies.filter((entry) => entry !== name)
      : [...constraints.excludedPlushies, name];
    setConstraints({
      ...constraints,
      excludedPlushies,
      requiredPlushies: constraints.requiredPlushies.filter((entry) => !excludedPlushies.includes(entry)),
    });
  };

  return (
    <>
      <p className="muted">What the ranking has to work around. Everything set here is stated above the ranking.</p>

      <div className="field">
        <label htmlFor={beta ? undefined : venerationId}>Veneration</label>
        {beta ? (
          <BetaSelect
            value={String(constraints.venerationStage)}
            onChange={(value) => setConstraints({ ...constraints, venerationStage: Number(value) })}
            options={stages.map((stage) => ({ value: stage, label: stage }))}
            ariaLabel="Veneration stage"
          />
        ) : (
          <select
            id={venerationId}
            value={constraints.venerationStage}
            onChange={(event) => setConstraints({ ...constraints, venerationStage: Number(event.target.value) })}
          >
            {stages.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        )}
        <div className="note">How far up the tree you are. The Speed trait pays more at every stage.</div>
      </div>

      <ToggleSwitch
        checked={constraints.traits !== null}
        onChange={(on) => setConstraints({ ...constraints, traits: on ? [...(fixedChoice?.traits ?? [])] : null })}
        label="Lock traits"
        description={
          constraints.traits !== null
            ? "Every build carries these, fastest or not."
            : "The sweep slots the trait that measures fastest."
        }
      />
      {constraints.traits !== null ? (
        <div className="field">
          <label>Traits</label>
          <TraitSelectors build={locked} onBuildChange={(next) => setConstraints({ ...constraints, traits: next.traits })} />
          <div className="note">Only the Speed trait moves a movement channel.</div>
        </div>
      ) : null}

      {/* One slotted trait takes the whole stage budget on its own. Two split
          it, and until the reader says how, the ranking has no Speed ascension
          to price - which is the same number it would show at stage 0. */}
      {constraints.traits !== null && constraints.traits.length > 1 ? (
        <div className="field">
          <label>Ascension</label>
          <AscensionSelectors
            build={locked}
            onBuildChange={(next) => setConstraints({ ...constraints, ascensionAssignments: next.ascensionAssignments })}
          />
          <div className="note">How the {constraints.venerationStage} stages split between the two.</div>
        </div>
      ) : null}

      <ToggleSwitch
        checked={constraints.elder !== null}
        onChange={(on) => setConstraints({ ...constraints, elder: on ? (fixedChoice?.elder ?? "None") : null })}
        label="Lock elder"
        description={
          constraints.elder !== null
            ? "Every build wears this one, fastest or not."
            : "The sweep picks the elder that measures fastest."
        }
      />
      {constraints.elder !== null ? (
        <div className="field">
          <label>Elder</label>
          <ElderSelector
            build={locked}
            onBuildChange={(next) => setConstraints({ ...constraints, elder: next.elder ?? "None" })}
            showDeltaChips={beta}
            modifierKeys={SPEED_ELDER_MODIFIERS}
          />
        </div>
      ) : null}

      <div className="field">
        <label>Always carry</label>
        {beta ? (
          <PlushiePickerBeta build={required} onBuildChange={setRequired} describe={plushieCaption} only={roster} />
        ) : (
          <PlushieSelectors build={required} onBuildChange={setRequired} describe={plushieCaption} only={roster} />
        )}
        <div className="note">Ranks only the builds holding these. A slot left empty stays open.</div>
      </div>

      <BlacklistDropdown
        label="Plushies you do not own"
        summaryLabel="Plushies"
        count={constraints.excludedPlushies.length}
        options={roster.map((name) => ({
          id: name,
          label: name,
          selected: constraints.excludedPlushies.includes(name),
          icon: getPlushieIcon(name),
          description: plushieCaption(name),
        }))}
        onToggle={toggleExcluded}
      />
    </>
  );
}
