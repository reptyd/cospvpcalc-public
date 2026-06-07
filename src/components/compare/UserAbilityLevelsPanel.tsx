import { useEffect, useState } from "react";
import type {
  CreatureRuntime,
  UserAbilityLevelOverrides,
} from "../../engine";
import {
  listCustomAbilityRecords,
  subscribeCustomAbilityRegistry,
  type CustomAbilityRecord,
} from "../../shared/customAbilities";

/**
 * Per-fight active-level picker for user abilities
 * with `levels > 1`. Sister panel to UserAbilityTimingOverridesPanel
 * but operates on the `userAbilityLevels` map instead of timing.
 *
 * Rows are populated from `creature.userAbilityIds` × the custom-
 * ability registry, filtered to abilities whose spec has `levels > 1`
 * (single-level abilities don't surface a picker - there's nothing
 * to pick). Default selection is the spec's `default_level`; the
 * user can pin any 1..=spec.levels value for THIS matchup.
 *
 * Wires through to the Rust engine via
 * `RustAbilityPolicyOverrides.userAbilityLevels`.
 */
export function UserAbilityLevelsPanel({
  creatureA,
  creatureB,
  levelsA,
  levelsB,
  onLevelsAChange,
  onLevelsBChange,
}: {
  creatureA: CreatureRuntime | undefined;
  creatureB: CreatureRuntime | undefined;
  levelsA: UserAbilityLevelOverrides;
  levelsB: UserAbilityLevelOverrides;
  onLevelsAChange: (next: UserAbilityLevelOverrides) => void;
  onLevelsBChange: (next: UserAbilityLevelOverrides) => void;
}) {
  const [abilityRecords, setAbilityRecords] = useState<CustomAbilityRecord[]>(
    () => listCustomAbilityRecords(),
  );
  useEffect(
    () =>
      subscribeCustomAbilityRegistry(() =>
        setAbilityRecords(listCustomAbilityRecords()),
      ),
    [],
  );

  // Filter attached ids down to those whose spec has levels > 1 -
  // single-level abilities have nothing to pick.
  const leveledIdsFor = (ids: string[]): string[] =>
    ids.filter((id) => {
      const record = abilityRecords.find((r) => r.spec.id === id);
      return record !== undefined && (record.spec.levels ?? 1) > 1;
    });

  const idsA = leveledIdsFor(creatureA?.userAbilityIds ?? []);
  const idsB = leveledIdsFor(creatureB?.userAbilityIds ?? []);
  const totalLeveled = idsA.length + idsB.length;
  const totalActive = Object.keys(levelsA).length + Object.keys(levelsB).length;

  if (totalLeveled === 0) {
    // Nothing to pick - keep the panel mounted for discoverability
    // but show only the empty hint.
    return (
      <details className="compare-policy-card">
        <summary className="compare-policy-summary">
          <div>
            <strong>Custom-ability per-fight level</strong>
            <span>
              Pick Lv 1 / Lv 2 / ... for user abilities that declare
              <code> levels &gt; 1</code>.
            </span>
          </div>
          <span className="compare-policy-total">none with levels</span>
        </summary>
        <div className="compare-policy-body">
          <div className="compare-policy-empty">
            No attached custom ability has multiple levels. To enable
            scaling per matchup, edit a custom ability under
            <em> Custom &gt; Abilities</em> and set <code>levels</code>{" "}
            with a <code>scaling</code> table.
          </div>
        </div>
      </details>
    );
  }

  return (
    <details className="compare-policy-card">
      <summary className="compare-policy-summary">
        <div>
          <strong>Custom-ability per-fight level</strong>
          <span>
            Override <code>default_level</code> for this matchup. Empty
            picks fall back to the spec's default.
          </span>
        </div>
        <span className="compare-policy-total">{totalActive} active</span>
      </summary>
      <div className="compare-policy-body">
        <div className="compare-policy-columns">
          <LevelsColumn
            title="Creature A"
            ids={idsA}
            abilityRecords={abilityRecords}
            draft={levelsA}
            onChange={onLevelsAChange}
          />
          <LevelsColumn
            title="Creature B"
            ids={idsB}
            abilityRecords={abilityRecords}
            draft={levelsB}
            onChange={onLevelsBChange}
          />
        </div>
      </div>
    </details>
  );
}

function LevelsColumn({
  title,
  ids,
  abilityRecords,
  draft,
  onChange,
}: {
  title: string;
  ids: string[];
  abilityRecords: CustomAbilityRecord[];
  draft: UserAbilityLevelOverrides;
  onChange: (next: UserAbilityLevelOverrides) => void;
}) {
  const activeCount = Object.keys(draft).length;
  const reset = () => onChange({});
  const setLevel = (id: string, raw: string) => {
    const next = { ...draft };
    if (raw === "default") {
      delete next[id];
    } else {
      const parsed = Number(raw);
      if (Number.isInteger(parsed) && parsed >= 1) {
        next[id] = parsed;
      }
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
              ? "No leveled custom abilities."
              : `${activeCount} active pick${activeCount === 1 ? "" : "s"} of ${ids.length} leveled`}
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
          No leveled custom abilities on this side.
        </div>
      ) : (
        <div className="compare-policy-list">
          {ids.map((id) => {
            const record = abilityRecords.find((r) => r.spec.id === id);
            if (!record) return null;
            const displayName = record.spec.display_name ?? id;
            const levels = record.spec.levels ?? 1;
            const defaultLevel = record.spec.default_level ?? 1;
            const choice = draft[id];
            const selectValue = choice === undefined ? "default" : String(choice);
            return (
              <label key={id} className="compare-policy-row">
                <span className="compare-policy-row-label">
                  <strong>{displayName}</strong>
                  <code>{id}</code>
                </span>
                <select
                  value={selectValue}
                  onChange={(e) => setLevel(id, e.target.value)}
                  className="compare-policy-row-select"
                >
                  <option value="default">
                    Spec default (Lv {defaultLevel})
                  </option>
                  {Array.from({ length: levels }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      Lv {n}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
