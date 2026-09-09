import { useEffect, useRef, useState } from "react";
import {
  ABILITY_KIND_LABELS,
  ABILITY_NAMES_BY_KIND,
  CATEGORICAL_STAT_LABELS,
  CATEGORICAL_VALUE_OPTIONS,
  COMPARATOR_LABELS,
  NUMERIC_STAT_LABELS,
  STATUS_OPTIONS_BY_SLOT,
  STATUS_SLOT_LABELS,
  createDefaultPredicate,
  type AbilityKind,
  type CategoricalStatField,
  type EqualityComparator,
  type NumericComparator,
  type NumericStatField,
  type Predicate,
  type StatusSlot,
} from "../../engine/creatureSearch";

const NUMERIC_OPS: NumericComparator[] = ["eq", "neq", "gt", "lt", "gte", "lte"];
const EQUALITY_OPS: EqualityComparator[] = ["eq", "neq"];

const PREDICATE_KIND_LABELS: Record<Predicate["kind"], string> = {
  "stat-num": "Numeric stat",
  "stat-cat": "Categorical stat",
  ability: "Ability",
  status: "Status",
};

export function PredicateRow({
  predicate,
  onChange,
  onRemove,
}: {
  predicate: Predicate;
  onChange: (next: Predicate) => void;
  onRemove: () => void;
}) {
  const setKind = (kind: Predicate["kind"]) => {
    if (kind === predicate.kind) return;
    onChange(createDefaultPredicate(kind));
  };

  return (
    <div className="search-predicate-row">
      <select
        className="search-predicate-kind"
        value={predicate.kind}
        onChange={(e) => setKind(e.target.value as Predicate["kind"])}
        aria-label="Predicate kind"
      >
        {(Object.keys(PREDICATE_KIND_LABELS) as Predicate["kind"][]).map((kind) => (
          <option key={kind} value={kind}>
            {PREDICATE_KIND_LABELS[kind]}
          </option>
        ))}
      </select>

      {predicate.kind === "stat-num" ? (
        <StatNumControls predicate={predicate} onChange={onChange} />
      ) : null}
      {predicate.kind === "stat-cat" ? (
        <StatCatControls predicate={predicate} onChange={onChange} />
      ) : null}
      {predicate.kind === "ability" ? (
        <AbilityControls predicate={predicate} onChange={onChange} />
      ) : null}
      {predicate.kind === "status" ? (
        <StatusControls predicate={predicate} onChange={onChange} />
      ) : null}

      <button
        type="button"
        className="secondary search-predicate-remove"
        onClick={onRemove}
        aria-label="Remove condition"
        title="Remove condition"
      >
        ✕
      </button>
    </div>
  );
}

function StatNumControls({
  predicate,
  onChange,
}: {
  predicate: Extract<Predicate, { kind: "stat-num" }>;
  onChange: (next: Predicate) => void;
}) {
  return (
    <>
      <select
        value={predicate.field}
        onChange={(e) => onChange({ ...predicate, field: e.target.value as NumericStatField })}
        aria-label="Stat field"
      >
        {(Object.keys(NUMERIC_STAT_LABELS) as NumericStatField[]).map((field) => (
          <option key={field} value={field}>
            {NUMERIC_STAT_LABELS[field]}
          </option>
        ))}
      </select>
      <select
        className="search-predicate-op"
        value={predicate.op}
        onChange={(e) => onChange({ ...predicate, op: e.target.value as NumericComparator })}
        aria-label="Comparator"
      >
        {NUMERIC_OPS.map((op) => (
          <option key={op} value={op}>
            {COMPARATOR_LABELS[op]}
          </option>
        ))}
      </select>
      <NumericValueInput
        value={predicate.value}
        onChange={(next) => onChange({ ...predicate, value: next })}
        ariaLabel="Value"
      />
    </>
  );
}

function StatCatControls({
  predicate,
  onChange,
}: {
  predicate: Extract<Predicate, { kind: "stat-cat" }>;
  onChange: (next: Predicate) => void;
}) {
  const options = CATEGORICAL_VALUE_OPTIONS[predicate.field];
  return (
    <>
      <select
        value={predicate.field}
        onChange={(e) => {
          const nextField = e.target.value as CategoricalStatField;
          const nextOptions = CATEGORICAL_VALUE_OPTIONS[nextField];
          onChange({
            ...predicate,
            field: nextField,
            value: nextOptions.includes(predicate.value) ? predicate.value : nextOptions[0] ?? "",
          });
        }}
        aria-label="Stat field"
      >
        {(Object.keys(CATEGORICAL_STAT_LABELS) as CategoricalStatField[]).map((field) => (
          <option key={field} value={field}>
            {CATEGORICAL_STAT_LABELS[field]}
          </option>
        ))}
      </select>
      <select
        className="search-predicate-op"
        value={predicate.op}
        onChange={(e) => onChange({ ...predicate, op: e.target.value as EqualityComparator })}
        aria-label="Comparator"
      >
        {EQUALITY_OPS.map((op) => (
          <option key={op} value={op}>
            {COMPARATOR_LABELS[op]}
          </option>
        ))}
      </select>
      <select
        value={predicate.value}
        onChange={(e) => onChange({ ...predicate, value: e.target.value })}
        aria-label="Value"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </>
  );
}

function AbilityControls({
  predicate,
  onChange,
}: {
  predicate: Extract<Predicate, { kind: "ability" }>;
  onChange: (next: Predicate) => void;
}) {
  const names = ABILITY_NAMES_BY_KIND[predicate.abilityKind];
  return (
    <>
      <select
        value={predicate.abilityKind}
        onChange={(e) => {
          const nextKind = e.target.value as AbilityKind;
          const nextNames = ABILITY_NAMES_BY_KIND[nextKind];
          onChange({
            ...predicate,
            abilityKind: nextKind,
            name: nextNames.includes(predicate.name) ? predicate.name : nextNames[0] ?? "",
          });
        }}
        aria-label="Ability kind"
      >
        {(Object.keys(ABILITY_KIND_LABELS) as AbilityKind[]).map((kind) => (
          <option key={kind} value={kind}>
            {ABILITY_KIND_LABELS[kind]}
          </option>
        ))}
      </select>
      <select
        className="search-predicate-op"
        value={predicate.mode}
        onChange={(e) => onChange({ ...predicate, mode: e.target.value as "has" | "lacks" })}
        aria-label="Has / Lacks"
      >
        <option value="has">has</option>
        <option value="lacks">lacks</option>
      </select>
      <select
        value={predicate.name}
        onChange={(e) => onChange({ ...predicate, name: e.target.value })}
        aria-label="Ability name"
      >
        {names.length === 0 ? <option value="">(none available)</option> : null}
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </>
  );
}

function StatusControls({
  predicate,
  onChange,
}: {
  predicate: Extract<Predicate, { kind: "status" }>;
  onChange: (next: Predicate) => void;
}) {
  const options = STATUS_OPTIONS_BY_SLOT[predicate.slot];
  return (
    <>
      <select
        value={predicate.slot}
        onChange={(e) => {
          const nextSlot = e.target.value as StatusSlot;
          const nextOptions = STATUS_OPTIONS_BY_SLOT[nextSlot];
          const stillValid = nextOptions.some((option) => option.id === predicate.status);
          onChange({
            ...predicate,
            slot: nextSlot,
            status: stillValid ? predicate.status : nextOptions[0]?.id ?? "",
          });
        }}
        aria-label="Status slot"
      >
        {(Object.keys(STATUS_SLOT_LABELS) as StatusSlot[]).map((slot) => (
          <option key={slot} value={slot}>
            {STATUS_SLOT_LABELS[slot]}
          </option>
        ))}
      </select>
      <select
        value={predicate.status}
        onChange={(e) => onChange({ ...predicate, status: e.target.value })}
        aria-label="Status"
      >
        {options.length === 0 ? <option value="">(none available)</option> : null}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        className="search-predicate-op"
        value={predicate.op}
        onChange={(e) => onChange({ ...predicate, op: e.target.value as NumericComparator })}
        aria-label="Comparator"
      >
        {NUMERIC_OPS.map((op) => (
          <option key={op} value={op}>
            {COMPARATOR_LABELS[op]}
          </option>
        ))}
      </select>
      <NumericValueInput
        value={predicate.value}
        onChange={(next) => onChange({ ...predicate, value: next })}
        step={predicate.slot === "resist" ? 0.05 : 1}
        ariaLabel={predicate.slot === "resist" ? "Fraction (0-1)" : "Stacks"}
      />
    </>
  );
}

/**
 * Number input with a local-draft string so in-progress decimal input
 * (`0.`, `0.5e`, `-`) survives until the user commits. The previous
 * implementation parsed every keystroke into a number, which silently
 * stripped trailing dots and made it impossible to type `0.5` - the
 * `.` was eaten on the way back through React's controlled-value loop.
 *
 * Mirrors the `AirRuleCooldownInput` pattern already used in
 * BattleSettingsPanel for the same reason. On blur (or Enter) we
 * parse + commit; if the draft doesn't parse, we revert to the last
 * committed value so the UI never displays garbage.
 */
function NumericValueInput({
  value,
  onChange,
  step,
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  step?: number;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string>(() =>
    Number.isFinite(value) ? String(value) : "",
  );
  const committedRef = useRef<number>(value);
  useEffect(() => {
    if (value !== committedRef.current) {
      committedRef.current = value;
      setDraft(Number.isFinite(value) ? String(value) : "");
    }
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === ".") {
      setDraft(String(committedRef.current));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(String(committedRef.current));
      return;
    }
    committedRef.current = parsed;
    setDraft(String(parsed));
    if (parsed !== value) onChange(parsed);
  };

  // `type="number"` was actively hostile here: browsers report
  // `e.target.value === ""` for in-progress values like `0.`, `-`, or
  // `1e`, so the dot got eaten between keystrokes and `0.5` collapsed
  // to `5`. `type="text"` + `inputmode="decimal"` keeps the mobile
  // numeric keyboard while letting the draft contain transient
  // characters; `commit()` parses on blur / Enter.
  return (
    <input
      type="text"
      inputMode="decimal"
      className="search-predicate-value-num"
      data-step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      aria-label={ariaLabel}
    />
  );
}
