import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  UserStatusSpec,
  UserStatusPolarity,
  UserStatusStackRule,
  EffectKind,
  EffectBatch,
} from "../../shared/customAbilityTypes";
import {
  Palette,
  SmallField,
  StackView,
  VocabDatalists,
  WorkspaceDropArea,
  type StackDescriptor,
} from "./AbilityVisualEditor";

/**
 * Visual constructor for a user-defined status. Built on the SAME `scratch`
 * layout as `AbilityVisualEditor` (so it matches the Abilities / Timings
 * sub-tabs). Two flat groups define the status; ALL behaviour lives in hooks:
 *
 *   • Identity / Stacking & decay  — the two flat groups (what the status IS).
 *   • Behaviour (hooks)            — the block constructor: lifecycle
 *                                    (on_apply / on_tick / on_expire) + the
 *                                    reactive triggers (on_take_damage, on_kill,
 *                                    on_decay, on_restack, …). Bearer = self.
 *
 * The old parametric Periodic-tick and Combat-modifier sections (and their `ƒx`
 * number↔expression toggles) were RETIRED: periodic behaviour is authored via
 * the on_tick hook, damage scaling via the pre-damage hooks, and cooldown /
 * regen via `modify_stat` — one uniform hook model instead of a knob wall. The
 * legacy spec fields persist for backward-compat (editable only via Code), see
 * `LEGACY_STATUS_SPEC_FIELDS`. Every edit calls `onChange`; the parent
 * re-serializes through `serializeStatus`, so Code and Visual round-trip
 * losslessly (locked by `statusConstructorCoverage.test.ts`).
 */
export function StatusVisualEditor({
  spec,
  onChange,
}: {
  spec: UserStatusSpec;
  onChange: (next: UserStatusSpec) => void;
}): ReactNode {
  const set = <K extends keyof UserStatusSpec>(
    key: K,
    value: UserStatusSpec[K],
  ) => onChange({ ...spec, [key]: value });

  // ── Hook stacks (reuse the ability block constructor) ──────────
  const [focusedHook, setFocusedHook] = useState<string>("on_apply");
  // Every hook id is exactly the spec field it backs. All are simple
  // `EffectBatch` fields except `on_tick`, which additionally carries an
  // interval — so the simple-batch path indexes the spec by the hook id and
  // the tick path is special-cased.
  const simpleBatch = (id: string): EffectBatch | undefined =>
    (spec as unknown as Record<string, EffectBatch | undefined>)[id];
  const setHookField = (id: string, value: EffectBatch | undefined) =>
    onChange({ ...spec, [id]: value } as UserStatusSpec);
  const hookEffects = (id: string): EffectKind[] => {
    if (id === "on_tick") return spec.on_tick?.effects.effects ?? [];
    return simpleBatch(id)?.effects ?? [];
  };
  const setHookEffects = (id: string, effects: EffectKind[]) => {
    if (id === "on_tick") {
      set(
        "on_tick",
        effects.length
          ? {
              interval_sec: spec.on_tick?.interval_sec ?? 1,
              effects: { name: "on_tick", effects },
            }
          : undefined,
      );
    } else {
      setHookField(id, effects.length ? { name: id, effects } : undefined);
    }
  };
  const setTickInterval = (sec: number) =>
    set("on_tick", {
      interval_sec: Math.max(0.05, sec),
      effects: spec.on_tick?.effects ?? { name: "on_tick", effects: [] },
    });
  const appendToFocusedHook = (eff: EffectKind) =>
    setHookEffects(focusedHook, [...hookEffects(focusedHook), eff]);

  // Hooks are added on demand (palette hats), not pre-placed — only hooks the
  // spec actually carries render as stacks; ✕ removes one entirely.
  const hookPresent = (id: string): boolean =>
    id === "on_tick" ? spec.on_tick !== undefined : simpleBatch(id) !== undefined;
  const addHook = (id: string) => {
    if (id === "on_tick") {
      set("on_tick", { interval_sec: 1, effects: { name: "on_tick", effects: [] } });
    } else {
      setHookField(id, { name: id, effects: [] });
    }
    setFocusedHook(id);
  };
  const removeHook = (id: string) => {
    if (id === "on_tick") set("on_tick", undefined);
    else setHookField(id, undefined);
  };
  const usedHookIds = new Set(HOOKS.filter((h) => hookPresent(h.id)).map((h) => h.id));
  const activeStacks: StackDescriptor[] = HOOKS.filter((h) => hookPresent(h.id)).map(
    (h) => ({
      id: h.id,
      hatLabel: h.label,
      hatHint: h.hint,
      effects: hookEffects(h.id),
    }),
  );

  return (
    <div className="scratch">
      <VocabDatalists />

      <div className="scratch-strip">
        <Group title="Identity">
          <SmallField label="ID">
            <input
              className="scratch-input"
              value={spec.id}
              placeholder="user.my_status"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => set("id", e.target.value)}
            />
          </SmallField>
          <SmallField label="Display name">
            <input
              className="scratch-input"
              value={spec.display_name}
              placeholder="My Status"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => set("display_name", e.target.value)}
            />
          </SmallField>
          <SmallField label="Polarity">
            <Select
              value={spec.polarity ?? "negative"}
              options={["negative", "positive", "neutral"]}
              onChange={(v) => set("polarity", v as UserStatusPolarity)}
            />
          </SmallField>
        </Group>

        <Group title="Stacking & decay">
          <SmallField label="Stack rule">
            <Select
              value={spec.stack_rule ?? "stacking"}
              options={["stacking", "non_stacking", "unique"]}
              onChange={(v) => set("stack_rule", v as UserStatusStackRule)}
            />
          </SmallField>
          <SmallField label="Max stacks (∞ if blank)">
            <NumInput
              value={spec.max_stacks ?? undefined}
              step={1}
              min={0}
              onChange={(v) => set("max_stacks", v)}
            />
          </SmallField>
          <SmallField label="Decay — seconds / stack">
            <NumInput
              value={spec.decay_interval_sec}
              step={0.1}
              min={0}
              onChange={(v) => set("decay_interval_sec", v)}
            />
          </SmallField>
          <SmallField label="Cleanse (Fortify)">
            <span className="scratch-derived">
              <span
                className={`scratch-derived-badge ${
                  (spec.polarity ?? "negative") === "negative" ? "is-removable" : ""
                }`}
              >
                {(spec.polarity ?? "negative") === "negative"
                  ? "Removable"
                  : "Permanent"}
              </span>
              <span className="scratch-derived-note">from polarity</span>
            </span>
          </SmallField>
        </Group>

        {/* Periodic-tick and Combat-modifier parametric sections are retired:
            periodic behaviour is authored via the on_tick hook, damage scaling
            via pre-damage hooks, and cooldown/regen via modify_stat — all in the
            Behaviour zone below. The legacy spec knobs persist for backward-compat
            (editable only via Code) but are no longer surfaced here. */}
      </div>

      {/* Behaviour zone — the block constructor for the lifecycle hooks.
          Hooks sit in the palette as hats (like ability triggers) and are
          added on click/drag, not pre-placed. */}
      <div className="scratch-main">
        <div className="scratch-palette">
          <Palette
            hats={STATUS_HATS}
            stacksUsed={usedHookIds}
            onAddHat={addHook}
            onAddBlock={appendToFocusedHook}
          />
        </div>
        <WorkspaceDropArea onDropHat={addHook}>
          <div className="scratch-zone-head">
            <div className="scratch-zone-title">Behaviour — lifecycle hooks</div>
            <div className="scratch-zone-sub">
              Add a hook from the palette, then drop effects in. Bearer ={" "}
              <code>self</code>, the other side = <code>opp</code>. Any stat
              modifier a hook installs reverts (HP kept proportional) when the
              status falls off.
            </div>
          </div>
          {activeStacks.length === 0 ? (
            <div className="scratch-empty">
              <p>
                <strong>No hooks yet.</strong> Click or drag a hook from the
                palette — <span className="scratch-hint-pill">when applied</span>,{" "}
                <span className="scratch-hint-pill">every N seconds</span>, or{" "}
                <span className="scratch-hint-pill">when it falls off</span> — to
                give the status behaviour.
              </p>
            </div>
          ) : (
            activeStacks.map((stack) => (
              <StackView
                key={stack.id}
                stack={stack}
                isFocused={stack.id === focusedHook}
                onFocus={() => setFocusedHook(stack.id)}
                onChangeEffects={(next) => setHookEffects(stack.id, next)}
                onRemove={() => removeHook(stack.id)}
                onTickIntervalChange={
                  stack.id === "on_tick" ? setTickInterval : undefined
                }
                tickInterval={spec.on_tick?.interval_sec}
              />
            ))
          )}
        </WorkspaceDropArea>
      </div>
    </div>
  );
}

const HOOKS: ReadonlyArray<{ id: string; label: string; hint: string }> = [
  {
    id: "on_apply",
    label: "when applied",
    hint: "Fires once when the status first lands on a creature. Bearer = self.",
  },
  {
    id: "on_tick",
    label: "every N seconds",
    hint: "Periodic while present. Bearer = self; read status.stacks inside.",
  },
  {
    id: "on_expire",
    label: "when it falls off",
    hint: "Fires once on removal; any modifier the status installed auto-reverts (HP reconciled) afterwards.",
  },
  // Bearer-reactive triggers (status↔ability parity). Bearer = self,
  // opponent = the other side; each exposes event.* context inside the batch.
  {
    id: "on_round_start",
    label: "when round starts",
    hint: "Fires once at t=0 for a status present at fight start. Bearer = self.",
  },
  {
    id: "on_take_damage",
    label: "when bearer takes damage",
    hint: "Bearer took damage this iteration. Read event.damage_taken.",
  },
  {
    id: "on_deal_damage",
    label: "when bearer deals damage",
    hint: "Bearer dealt damage this iteration. Read event.damage_dealt.",
  },
  {
    id: "on_kill",
    label: "when bearer kills",
    hint: "Bearer downed the opponent this iteration.",
  },
  {
    id: "on_first_strike",
    label: "when first-strike flips",
    hint: "Bearer's first-strike state changed. Read event.first_strike_active.",
  },
  {
    id: "on_heal",
    label: "when bearer is healed",
    hint: "Bearer received healing this iteration. Read event.heal_amount.",
  },
  {
    id: "on_status_apply",
    label: "when another status lands",
    hint: "Another status was applied to the bearer. Read event.applied.<id>.",
  },
  {
    id: "on_status_expire",
    label: "when another status leaves",
    hint: "Another status left the bearer. Read event.expired.<id>.",
  },
  {
    id: "on_before_take_damage",
    label: "before bearer takes damage",
    hint: "Pre-mitigation shield: write set_extra self damage_override = N to absorb/reduce.",
  },
  {
    id: "on_before_deal_damage",
    label: "before bearer deals damage",
    hint: "Pre-mitigation amp: write set_extra self damage_override = N to change outgoing.",
  },
  {
    id: "on_decay",
    label: "when a stack decays",
    hint: "Bearer lost stacks while surviving (decay / partial cleanse). Read event.stacks_lost.",
  },
  {
    id: "on_restack",
    label: "when re-applied",
    hint: "An already-present status gained stacks. Read event.stacks_gained.",
  },
];

/** All lifecycle + reactive hooks, offered as palette hats (added on click/drag). */
const STATUS_HATS: ReadonlyArray<{ id: string; label: string }> = HOOKS.map(
  (h) => ({ id: h.id, label: h.label }),
);

// ── Sub-sections ───────────────────────────────────────────────

/** A titled group of fields inside the strip — gives the dense parametric
 *  surface a scannable hierarchy the flat ability strip doesn't need. */
function Group({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="scratch-group">
      <div className="scratch-group-head">
        <span className="scratch-group-title">{title}</span>
        {action}
      </div>
      <div className="scratch-strip-row">{children}</div>
    </div>
  );
}

/**
 * Combat modifiers, collapsed until needed. Most statuses are neutral here
 * (regen/incoming/outgoing/bite all ×1 / 0), so the section stays out of the
 * way behind a "+ Add" until the author opts in — then it reveals the four
 * knobs, each with its own number↔expression toggle.
 */
// ── Field controls (scratch aesthetic — mirror AbilityVisualEditor) ──

/**
 * Custom dropdown in the scratch / `.ce-templates-menu` design language — a
 * themed toggle + popover listbox, so the OPEN state is styled to match the
 * dark editor instead of the OS-native option list (which ignores the design
 * and only takes `color-scheme`). Closes on outside-click or Escape. Keeps the
 * same `(value, options, onChange)` API as the native select it replaces, so
 * every call site is unchanged.
 */
function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="scratch-select" ref={ref}>
      <button
        type="button"
        className={`scratch-input scratch-select-toggle ${open ? "is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="scratch-select-value">{value}</span>
        <span className="scratch-select-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="scratch-select-menu" role="listbox">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              role="option"
              aria-selected={opt === value}
              className={`scratch-select-item ${opt === value ? "is-selected" : ""}`}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Bare numeric input — clears to `undefined` (engine default) when emptied,
 *  commits only finite numbers (a half-typed value never enters the spec). */
function NumInput({
  value,
  onChange,
  step,
  min,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
}): ReactNode {
  return (
    <input
      className="scratch-input"
      type="number"
      value={value === undefined || Number.isNaN(value) ? "" : String(value)}
      step={step ?? "any"}
      min={min}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          onChange(undefined);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
