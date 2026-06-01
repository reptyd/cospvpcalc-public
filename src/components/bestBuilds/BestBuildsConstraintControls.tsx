import { useMemo, useState } from "react";
import type { BuildOptions } from "../../engine";
import { getPlushieIcon, getTraitIcon } from "../../engine/buildData";
import { formatPlushieEffectSummary } from "../../engine/plushieEffectSummary";
import { AscensionSelectors, ElderSelector, PlushieSelectors, TraitSelectors } from "../BuildSelectors";
import { IconImg } from "../IconImg";
import { ToggleSwitch } from "../ToggleSwitch";

type BestBuildsConstraintControlsProps = {
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
};

export function BestBuildsConstraintControls({
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
}: BestBuildsConstraintControlsProps) {
  return (
    <>
      <h3>Build Constraints (Optional)</h3>
      <div className="note">Lock specific traits or plushies to optimize only the remaining slots.</div>
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
        description={targetAscensionLock ? "Use entered trait point distribution." : "Ascension distribution is automatic."}
      />
      {targetTraitLock && targetAscensionLock && (
        <div className="field">
          <label>Ascension</label>
          <AscensionSelectors build={targetConstraints} onBuildChange={setTargetConstraints} />
        </div>
      )}
      {!targetTraitLock && targetAscensionLock && <div className="note">Ascension lock works only when trait lock is enabled.</div>}
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
        description={targetElderLock ? "Use selected elder only." : "Elder is automatic."}
      />
      {targetElderLock && (
        <div className="field">
          <label>Elder</label>
          <ElderSelector build={targetConstraints} onBuildChange={setTargetConstraints} />
        </div>
      )}
      <BlacklistDropdown
        label="Blacklisted traits"
        summaryLabel="Traits"
        count={excludedTraits.length}
        options={traitBlacklistOptions.map((trait) => ({
          id: trait.id,
          label: trait.label,
          selected: excludedTraits.includes(trait.id),
          icon: getTraitIcon(trait.id) ?? getTraitIcon(trait.label),
        }))}
        onToggle={toggleExcludedTrait}
      />
      <BlacklistDropdown
        label="Blacklisted plushies"
        summaryLabel="Plushies"
        count={excludedPlushies.length}
        options={plushieBlacklistOptions.map((plushie) => ({
          id: plushie,
          label: plushie,
          selected: excludedPlushies.includes(plushie),
          icon: getPlushieIcon(plushie),
          description: formatPlushieEffectSummary(plushie),
        }))}
        onToggle={toggleExcludedPlushie}
      />
      <ToggleSwitch
        checked={showAllAscensionDistributions}
        onChange={setShowAllAscensionDistributions}
        label="Final ascension recheck"
        description={
          showAllAscensionDistributions
            ? "After the first ranking pass, the current top 10 gets a full elder+ascension recheck and keeps the best final version of each build."
            : "Skip the final elder+ascension recheck and keep the earlier pick."
        }
      />
    </>
  );
}

function BlacklistDropdown({
  label,
  summaryLabel,
  count,
  options,
  onToggle,
}: {
  label: string;
  summaryLabel: string;
  count: number;
  options: Array<{ id: string; label: string; selected: boolean; icon: string | null; description?: string }>;
  onToggle: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  return (
    <div className="field">
      <label>{label}</label>
      <details className="blacklist-dropdown">
        <summary className="blacklist-summary">
          <span>{summaryLabel}</span>
          <span className="blacklist-summary-meta">{count > 0 ? `${count} selected` : "None selected"}</span>
        </summary>
        <div className="blacklist-dropdown-body">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Filter ${summaryLabel.toLowerCase()}...`}
            aria-label={`Filter ${summaryLabel.toLowerCase()}`}
          />
          <div className="blacklist-list">
            {filteredOptions.map((option, index) => (
              <label key={`${option.id}-${index}`} className={`blacklist-item ${option.selected ? "selected" : ""}`}>
                <input type="checkbox" checked={option.selected} onChange={() => onToggle(option.id)} />
                <IconImg src={option.icon} alt={option.label} size={22} />
                <span className="pool-name">{option.label}</span>
                {option.description && <span className="plushie-effect-note">{option.description}</span>}
              </label>
            ))}
          </div>
        </div>
      </details>
      <div className="note">In blacklist: {count}</div>
    </div>
  );
}
