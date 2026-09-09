import type { AbilityTimingMode, CreatureRuntime } from "../../engine";
import {
  ABILITY_TIMING_MODE_LABELS,
  ABILITY_TIMING_MODE_OPTIONS,
  COMPARE_DEFAULT_ABILITY_TIMING_OVERRIDES,
  countCompareCustomAbilityTimingOverrides,
  countCompareEffectiveAbilityTimingOverrides,
  getCompareAbilityTimingEffectiveMode,
  getCompareAbilityTimingOverrideSource,
  getCompareAvailableAbilityTimingNames,
  type CompareAbilityTimingOverrideDraft,
} from "./compareAbilityTimingPolicy";

function buildSelectValue(
  abilityName: ReturnType<typeof getCompareAvailableAbilityTimingNames>[number],
  draft: CompareAbilityTimingOverrideDraft,
): string {
  const choice = draft[abilityName];
  if (choice === null) return "global";
  if (choice) return choice;
  return COMPARE_DEFAULT_ABILITY_TIMING_OVERRIDES[abilityName] ? "compareDefault" : "global";
}

function sortAbilityNames(
  abilityNames: ReturnType<typeof getCompareAvailableAbilityTimingNames>,
  draft: CompareAbilityTimingOverrideDraft,
): ReturnType<typeof getCompareAvailableAbilityTimingNames> {
  return [...abilityNames].sort((left, right) => {
    const sourceRank = { custom: 0, compareDefault: 1, global: 2 } as const;
    const leftSource = getCompareAbilityTimingOverrideSource(left, draft);
    const rightSource = getCompareAbilityTimingOverrideSource(right, draft);
    if (sourceRank[leftSource] !== sourceRank[rightSource]) {
      return sourceRank[leftSource] - sourceRank[rightSource];
    }
    return left.localeCompare(right);
  });
}

function AbilityTimingOverrideColumn({
  title,
  creature,
  globalMode,
  draft,
  onChange,
}: {
  title: string;
  creature: CreatureRuntime | undefined;
  globalMode: AbilityTimingMode;
  draft: CompareAbilityTimingOverrideDraft;
  onChange: (next: CompareAbilityTimingOverrideDraft) => void;
}) {
  const abilityNames = sortAbilityNames(getCompareAvailableAbilityTimingNames(creature), draft);
  const activeCount = countCompareEffectiveAbilityTimingOverrides(creature, draft);
  const customCount = countCompareCustomAbilityTimingOverrides(creature, draft);

  const updateChoice = (abilityName: (typeof abilityNames)[number], rawValue: string) => {
    const next: CompareAbilityTimingOverrideDraft = { ...draft };
    if (rawValue === "compareDefault") {
      delete next[abilityName];
    } else if (rawValue === "global") {
      next[abilityName] = null;
    } else {
      next[abilityName] = rawValue as AbilityTimingMode;
    }
    onChange(next);
  };

  const resetSide = () => onChange({});

  return (
    <section className="compare-policy-column">
      <div className="compare-policy-column-header">
        <div>
          <strong>{title}</strong>
          <span>
            {abilityNames.length === 0
              ? "No timing-sensitive abilities on this creature."
              : `${activeCount} active override${activeCount === 1 ? "" : "s"}${customCount > 0 ? `, ${customCount} custom` : ""}`}
          </span>
        </div>
        <button type="button" className="secondary compare-policy-reset" onClick={resetSide} disabled={abilityNames.length === 0}>
          Reset Side
        </button>
      </div>
      {abilityNames.length === 0 ? (
        <div className="compare-policy-empty">Select a creature with timed abilities to tune per ability.</div>
      ) : (
        <div className="compare-policy-list">
          {abilityNames.map((abilityName) => {
            const source = getCompareAbilityTimingOverrideSource(abilityName, draft);
            const effectiveMode = getCompareAbilityTimingEffectiveMode(abilityName, globalMode, draft);
            const defaultMode = COMPARE_DEFAULT_ABILITY_TIMING_OVERRIDES[abilityName];
            return (
              <div key={`${title}-${abilityName}`} className={`compare-policy-row source-${source}`}>
                <div className="compare-policy-copy">
                  <div className="compare-policy-title-row">
                    <strong>{abilityName}</strong>
                    <span className={`compare-policy-badge ${source}`}>{source === "compareDefault" ? "Default" : source === "custom" ? "Custom" : "Global"}</span>
                  </div>
                  <span className="compare-policy-caption">
                    {source === "compareDefault"
                      ? `Uses compare default: ${ABILITY_TIMING_MODE_LABELS[effectiveMode]}.`
                      : source === "custom"
                      ? `Custom override: ${ABILITY_TIMING_MODE_LABELS[effectiveMode]}.`
                      : `Falls back to the global mode: ${ABILITY_TIMING_MODE_LABELS[globalMode]}.`}
                  </span>
                </div>
                <select
                  className="compare-policy-select"
                  aria-label={`Timing override for ${abilityName}`}
                  value={buildSelectValue(abilityName, draft)}
                  onChange={(event) => updateChoice(abilityName, event.target.value)}
                >
                  {defaultMode ? (
                    <option value="compareDefault">Default ({ABILITY_TIMING_MODE_LABELS[defaultMode]})</option>
                  ) : null}
                  <option value="global">Global ({ABILITY_TIMING_MODE_LABELS[globalMode]})</option>
                  {ABILITY_TIMING_MODE_OPTIONS.map((mode) => (
                    <option key={`${abilityName}-${mode}`} value={mode}>
                      {ABILITY_TIMING_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function AbilityTimingOverridesPanel({
  compareAbilityPolicy,
  creatureA,
  creatureB,
  overridesA,
  overridesB,
  onOverridesAChange,
  onOverridesBChange,
}: {
  compareAbilityPolicy: AbilityTimingMode;
  creatureA: CreatureRuntime | undefined;
  creatureB: CreatureRuntime | undefined;
  overridesA: CompareAbilityTimingOverrideDraft;
  overridesB: CompareAbilityTimingOverrideDraft;
  onOverridesAChange: (next: CompareAbilityTimingOverrideDraft) => void;
  onOverridesBChange: (next: CompareAbilityTimingOverrideDraft) => void;
}) {
  const totalActive =
    countCompareEffectiveAbilityTimingOverrides(creatureA, overridesA) +
    countCompareEffectiveAbilityTimingOverrides(creatureB, overridesB);

  return (
    <details className="compare-policy-card">
      <summary className="compare-policy-summary">
        <div>
          <strong>Ability Timing Overrides</strong>
          <span>Per-ability policy control for advanced compare.</span>
        </div>
        <span className="compare-policy-total">{totalActive} active</span>
      </summary>
      <div className="compare-policy-body">
        <div className="compare-policy-columns">
          <AbilityTimingOverrideColumn
            title="Creature A"
            creature={creatureA}
            globalMode={compareAbilityPolicy}
            draft={overridesA}
            onChange={onOverridesAChange}
          />
          <AbilityTimingOverrideColumn
            title="Creature B"
            creature={creatureB}
            globalMode={compareAbilityPolicy}
            draft={overridesB}
            onChange={onOverridesBChange}
          />
        </div>
      </div>
    </details>
  );
}
