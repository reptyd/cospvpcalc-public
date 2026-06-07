import { useEffect, useState } from "react";
import type {
  CreatureRuntime,
  UserAbilityTimingChoice,
  UserAbilityTimingOverrides,
} from "../../engine";
import {
  ABILITY_TIMING_MODE_LABELS,
  ABILITY_TIMING_MODE_OPTIONS,
} from "./compareAbilityTimingPolicy";
import {
  listCustomAbilityRecords,
  subscribeCustomAbilityRegistry,
  type CustomAbilityRecord,
} from "../../shared/customAbilities";
import {
  listCustomTimingRecords,
  subscribeCustomTimingRegistry,
  type CustomTimingRecord,
} from "../../shared/customTimings";

/**
 * Per-fight timing overrides for USER abilities attached to a
 * creature. Sister panel to AbilityTimingOverridesPanel (which
 * handles built-in abilities). Differences:
 *
 *  - Rows are populated from `creature.userAbilityIds` × the
 *    custom-ability registry (live-subscribed so newly authored
 *    abilities show up here without a tab switch).
 *  - The override value can be a built-in mode OR a registered
 *    custom timing - picked from one combined select with optgroups.
 *  - "Spec default" (no entry in the draft) lets the spec's own
 *    `timing_user_override` / `timing_mode_override` defaults
 *    apply. The runtime override pinned here only takes effect
 *    when the user explicitly picks a non-default value.
 *
 * Wires through to the Rust engine via
 * `RustAbilityPolicyOverrides.userAbilityOverrides`.
 */
export function UserAbilityTimingOverridesPanel({
  creatureA,
  creatureB,
  overridesA,
  overridesB,
  onOverridesAChange,
  onOverridesBChange,
}: {
  creatureA: CreatureRuntime | undefined;
  creatureB: CreatureRuntime | undefined;
  overridesA: UserAbilityTimingOverrides;
  overridesB: UserAbilityTimingOverrides;
  onOverridesAChange: (next: UserAbilityTimingOverrides) => void;
  onOverridesBChange: (next: UserAbilityTimingOverrides) => void;
}) {
  const [abilityRecords, setAbilityRecords] = useState<CustomAbilityRecord[]>(() =>
    listCustomAbilityRecords(),
  );
  const [timingRecords, setTimingRecords] = useState<CustomTimingRecord[]>(() =>
    listCustomTimingRecords(),
  );
  useEffect(
    () =>
      subscribeCustomAbilityRegistry(() => setAbilityRecords(listCustomAbilityRecords())),
    [],
  );
  useEffect(
    () =>
      subscribeCustomTimingRegistry(() => setTimingRecords(listCustomTimingRecords())),
    [],
  );

  const idsA = creatureA?.userAbilityIds ?? [];
  const idsB = creatureB?.userAbilityIds ?? [];
  const totalAttached = idsA.length + idsB.length;
  const totalActive = Object.keys(overridesA).length + Object.keys(overridesB).length;

  if (totalAttached === 0) {
    // Nothing to override - keep the panel mounted so the user
    // discovers the feature, but show only the empty hint.
    return (
      <details className="compare-policy-card">
        <summary className="compare-policy-summary">
          <div>
            <strong>Custom-ability per-fight timing</strong>
            <span>Override timing for user abilities attached to a creature.</span>
          </div>
          <span className="compare-policy-total">none attached</span>
        </summary>
        <div className="compare-policy-body">
          <div className="compare-policy-empty">
            Neither creature has any custom abilities attached. Open
            <em> Custom &gt; Creatures</em> and tick a custom ability into
            the creature's <em>Supported abilities</em> picker to see it
            here.
          </div>
        </div>
      </details>
    );
  }

  return (
    <details className="compare-policy-card">
      <summary className="compare-policy-summary">
        <div>
          <strong>Custom-ability per-fight timing</strong>
          <span>
            Override timing for user abilities for THIS matchup (no spec
            edit needed).
          </span>
        </div>
        <span className="compare-policy-total">{totalActive} active</span>
      </summary>
      <div className="compare-policy-body">
        <div className="compare-policy-columns">
          <UserOverrideColumn
            title="Creature A"
            ids={idsA}
            abilityRecords={abilityRecords}
            timingRecords={timingRecords}
            draft={overridesA}
            onChange={onOverridesAChange}
          />
          <UserOverrideColumn
            title="Creature B"
            ids={idsB}
            abilityRecords={abilityRecords}
            timingRecords={timingRecords}
            draft={overridesB}
            onChange={onOverridesBChange}
          />
        </div>
      </div>
    </details>
  );
}

function UserOverrideColumn({
  title,
  ids,
  abilityRecords,
  timingRecords,
  draft,
  onChange,
}: {
  title: string;
  ids: string[];
  abilityRecords: CustomAbilityRecord[];
  timingRecords: CustomTimingRecord[];
  draft: UserAbilityTimingOverrides;
  onChange: (next: UserAbilityTimingOverrides) => void;
}) {
  const activeCount = Object.keys(draft).length;
  const reset = () => onChange({});
  const setChoice = (id: string, raw: string) => {
    const next = { ...draft };
    if (raw === "default") {
      delete next[id];
    } else if (raw.startsWith("user:")) {
      next[id] = { kind: "user", timingId: raw.slice("user:".length) };
    } else {
      next[id] = {
        kind: "builtIn",
        mode: raw as UserAbilityTimingChoice extends { kind: "builtIn"; mode: infer M } ? M : never,
      };
    }
    onChange(next);
  };

  return (
    <section className="compare-policy-column">
      <div className="compare-policy-column-header">
        <div>
          <strong>{title}</strong>
          <span>
            {ids.length === 0
              ? "No custom abilities attached."
              : `${activeCount} active override${activeCount === 1 ? "" : "s"} of ${ids.length} attached`}
          </span>
        </div>
        <button
          type="button"
          className="secondary compare-policy-reset"
          onClick={reset}
          disabled={ids.length === 0}
        >
          Reset Side
        </button>
      </div>
      {ids.length === 0 ? (
        <div className="compare-policy-empty">
          Attach custom abilities under <em>Custom &gt; Creatures</em>.
        </div>
      ) : (
        <div className="compare-policy-list">
          {ids.map((id) => {
            const record = abilityRecords.find((r) => r.spec.id === id);
            const displayName = record?.spec.display_name ?? id;
            const choice = draft[id];
            const selectValue = choice
              ? choice.kind === "user"
                ? `user:${choice.timingId}`
                : choice.mode
              : "default";
            const specHint = record
              ? record.spec.timing_user_override
                ? `Spec uses custom timing: ${record.spec.timing_user_override}`
                : record.spec.timing_mode_override
                  ? `Spec uses built-in: ${ABILITY_TIMING_MODE_LABELS[record.spec.timing_mode_override === "really_fast" ? "reallyFast" : record.spec.timing_mode_override === "semi_ideal" ? "semiIdeal" : record.spec.timing_mode_override]}`
                  : "Spec uses session default."
              : "Stale id - ability not in registry.";
            return (
              <div key={`${title}-${id}`} className={`compare-policy-row ${choice ? "source-custom" : "source-global"}`}>
                <div className="compare-policy-copy">
                  <div className="compare-policy-title-row">
                    <strong>{displayName}</strong>
                    <span className={`compare-policy-badge ${choice ? "custom" : "global"}`}>
                      {choice ? (choice.kind === "user" ? "Custom timing" : "Built-in") : "Spec default"}
                    </span>
                  </div>
                  <span className="compare-policy-caption">
                    <code style={{ fontSize: 11 }}>{id}</code> - {specHint}
                  </span>
                </div>
                <select
                  className="compare-policy-select"
                  aria-label={`Timing override for ${id}`}
                  value={selectValue}
                  onChange={(e) => setChoice(id, e.target.value)}
                >
                  <option value="default">Spec default (no override)</option>
                  <optgroup label="Built-in modes">
                    {ABILITY_TIMING_MODE_OPTIONS.map((mode) => (
                      <option key={mode} value={mode}>
                        {ABILITY_TIMING_MODE_LABELS[mode]}
                      </option>
                    ))}
                  </optgroup>
                  {timingRecords.length > 0 ? (
                    <optgroup label="Your custom timings">
                      {timingRecords.map((tr) => (
                        <option key={tr.spec.id} value={`user:${tr.spec.id}`}>
                          {tr.spec.display_name || tr.spec.id}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
