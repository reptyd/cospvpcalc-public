import { useEffect, useRef, useState, type ReactNode, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "../../hooks/useIsMobile";
import type {
  UserAbilitySpec,
  EffectKind,
  EffectTarget,
  EffectBatch,
  TriggerHooks,
  TriggerHookKey,
  TimingMode,
  ModifierMode,
  TypedDamageKind,
  Expr,
  AppliedStatus,
} from "../../shared/customAbilityTypes";
import type { CustomTimingRecord } from "../../shared/customTimings";

type StackKey =
  | "on_fire"
  | "on_round_start"
  | "on_take_damage"
  | "on_deal_damage"
  | "on_status_apply"
  | "on_status_expire"
  | "on_kill"
  | "on_first_strike"
  | "on_heal"
  | "on_active_end"
  | "on_before_take_damage"
  | "on_before_deal_damage"
  | "on_tick";

/** Module-level drag payload. We bypass dataTransfer for the actual
 * effect data because it would force JSON-serialising/parsing every
 * EffectKind on each drag, and we only ever drop within the same
 * editor instance (no cross-window). dataTransfer is still set with
 * a stub MIME so onDragOver/onDrop fire correctly. */
type DragPayload =
  | { kind: "palette"; effect: EffectKind }
  | { kind: "palette-hat"; hatId: string }
  | { kind: "workspace"; stackId: string; fromIndex: number };
let activeDragPayload: DragPayload | null = null;
const DRAG_MIME = "application/x-cos-ability-block";

function setDragPayload(e: DragEvent, payload: DragPayload) {
  activeDragPayload = payload;
  // The actual data is the JSON stub; the real payload travels via
  // the module-level ref. Browsers refuse drop without setData.
  try {
    e.dataTransfer.setData(DRAG_MIME, "1");
    e.dataTransfer.effectAllowed = payload.kind === "workspace" ? "move" : "copy";
  } catch {
    // Safari sometimes throws on setData with custom MIME mid-drag;
    // the ref-based payload still works.
  }
  installAutoScroll();
}

function clearDragPayload() {
  activeDragPayload = null;
}

function isOurDrag(): boolean {
  // Cheaper than checking dataTransfer types, and works after
  // dragenter where types may be empty in some browsers.
  return activeDragPayload !== null;
}

/** True when the drag is something a per-block / per-stack drop
 * target should handle. Hat drags are intentionally excluded so
 * they bubble up to the workspace-level drop target, which is the
 * only place that knows how to create a new stack. */
function isBlockLevelDrag(): boolean {
  return (
    activeDragPayload !== null && activeDragPayload.kind !== "palette-hat"
  );
}

/** Install a window-level auto-scroll on drag. When the cursor is
 * near the top or bottom of the viewport the page scrolls in that
 * direction, so the user can drag from a low palette tile to a
 * destination that's currently above the visible area (and vice
 * versa). Without this, a long palette + tall workspace combo
 * makes some drags impossible to complete. */
function installAutoScroll(): void {
  if (typeof window === "undefined") return;
  if ((window as unknown as { __cosScrollInstalled?: boolean }).__cosScrollInstalled) {
    return;
  }
  (window as unknown as { __cosScrollInstalled?: boolean }).__cosScrollInstalled = true;

  const margin = 80;
  const maxSpeed = 18;
  let raf = 0;
  let lastY = 0;
  let active = false;

  const tick = () => {
    raf = 0;
    if (!active) return;
    const h = window.innerHeight;
    let dy = 0;
    if (lastY < margin) {
      const ratio = 1 - lastY / margin;
      dy = -maxSpeed * Math.max(0, Math.min(1, ratio));
    } else if (lastY > h - margin) {
      const ratio = 1 - (h - lastY) / margin;
      dy = maxSpeed * Math.max(0, Math.min(1, ratio));
    }
    if (dy !== 0) {
      window.scrollBy(0, dy);
      // Also scroll the nearest scrollable container under the cursor
      // (e.g., the palette or workspace pane), so internal scrolling
      // works for cases where the page itself can't scroll further.
      const el = document.elementFromPoint(window.innerWidth / 2, lastY);
      let node: HTMLElement | null = el as HTMLElement | null;
      while (node) {
        const cs = getComputedStyle(node);
        if (
          (cs.overflowY === "auto" || cs.overflowY === "scroll") &&
          node.scrollHeight > node.clientHeight
        ) {
          node.scrollBy(0, dy);
          break;
        }
        node = node.parentElement;
      }
    }
    if (active) raf = requestAnimationFrame(tick);
  };

  // Use `globalThis.DragEvent` - at the top of this file React's
  // synthetic `DragEvent<Element>` shadows the global identifier, and
  // `window.addEventListener` expects the native lib.dom shape.
  const onDragOver = (e: globalThis.DragEvent) => {
    if (!isOurDrag()) return;
    lastY = e.clientY;
    if (!active) {
      active = true;
      raf = requestAnimationFrame(tick);
    }
  };
  const stop = () => {
    active = false;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragend", stop);
  window.addEventListener("drop", stop);
}
import { parseExpr, printExpr } from "../../shared/exprDsl";
import {
  KNOWN_STATUS_IDS,
  STATS_FIELDS,
  ABILITY_ID_SUGGESTIONS,
} from "../../shared/customAbilityVocab";
import {
  listCustomStatusRecords,
  subscribeCustomStatusRegistry,
} from "../../shared/customStatuses";

/**
 * Scratch-style visual ability editor - block-based authoring as
 * the alternative to code mode. Designed so a complete novice can
 * assemble an ability by clicking colored blocks from a palette.
 *
 * Architecture:
 *   - Palette (left): groups of colored blocks. Click a block → it
 *     appends to the focused stack in the workspace.
 *   - Workspace (right): vertical stacks of blocks, one per active
 *     trigger (plus on_fire if present). Hat blocks at the top of
 *     each stack are reserved/yellow.
 *   - Top strip: identity, timing, decision exprs (utility,
 *     available, reallyfast_gate). These are spec-level fields
 *     that aren't naturally block-shaped.
 *
 * Source-of-truth: the parent owns `text`. We receive a parsed
 * `spec` and emit `onChange(nextSpec)`; parent re-prints to text.
 */
export function AbilityVisualEditor({
  spec,
  onChange,
  timingRecords,
}: {
  spec: UserAbilitySpec;
  onChange: (next: UserAbilitySpec) => void;
  /** Custom timings the user authored - merged into the timing
   * dropdown so the user can pick `user.<id>` without writing
   * code. Empty array if none registered yet. */
  timingRecords?: ReadonlyArray<CustomTimingRecord>;
}): ReactNode {
  const stacks = describeStacks(spec);
  const [focusedStack, setFocusedStack] = useState<string>(stacks[0]?.id ?? "on_fire");

  const ensureStackId = (id: string): string => {
    if (stacks.some((s) => s.id === id)) return id;
    return stacks[0]?.id ?? "on_fire";
  };
  const focusId = ensureStackId(focusedStack);

  const update = (patch: Partial<UserAbilitySpec>) => onChange({ ...spec, ...patch });

  const setBatchEffects = (stackId: string, effects: EffectKind[]) => {
    if (stackId === "on_fire") {
      if (effects.length === 0) update({ on_fire: undefined });
      else update({ on_fire: { name: spec.on_fire?.name ?? "Fire", effects } });
      return;
    }
    if (stackId === "on_tick") {
      const cur = spec.triggers?.on_tick;
      const triggers = { ...(spec.triggers ?? {}) };
      if (effects.length === 0) {
        delete triggers.on_tick;
      } else {
        triggers.on_tick = {
          interval_sec: cur?.interval_sec ?? 1,
          effects: { name: cur?.effects.name ?? "on_tick", effects },
        };
      }
      update({ triggers: Object.keys(triggers).length ? triggers : undefined });
      return;
    }
    const key = stackId as TriggerHookKey;
    const triggers: Record<string, unknown> = { ...(spec.triggers ?? {}) };
    if (effects.length === 0) {
      delete triggers[key];
    } else {
      triggers[key] = {
        name: (spec.triggers?.[key] as EffectBatch | undefined)?.name ?? key,
        effects,
      };
    }
    update({ triggers: Object.keys(triggers).length ? (triggers as TriggerHooks) : undefined });
  };

  const setTickInterval = (sec: number) => {
    const cur = spec.triggers?.on_tick;
    const triggers = { ...(spec.triggers ?? {}) };
    triggers.on_tick = {
      interval_sec: Math.max(0.05, sec),
      effects: cur?.effects ?? { name: "on_tick", effects: [] },
    };
    update({ triggers });
  };

  const removeStack = (stackId: string) => {
    if (stackId === "on_fire") update({ on_fire: undefined });
    else {
      const triggers: Record<string, unknown> = { ...(spec.triggers ?? {}) };
      delete triggers[stackId];
      update({ triggers: Object.keys(triggers).length ? (triggers as TriggerHooks) : undefined });
    }
    if (focusedStack === stackId) setFocusedStack("");
  };

  const addStack = (key: string) => {
    if (key === "on_fire") {
      update({ on_fire: spec.on_fire ?? { name: "Fire", effects: [] } });
    } else if (key === "on_tick") {
      const triggers = { ...(spec.triggers ?? {}) };
      triggers.on_tick = spec.triggers?.on_tick ?? {
        interval_sec: 1,
        effects: { name: "on_tick", effects: [] },
      };
      update({ triggers });
    } else {
      const triggers: Record<string, unknown> = { ...(spec.triggers ?? {}) };
      triggers[key] = (spec.triggers?.[key as TriggerHookKey] as EffectBatch | undefined) ?? {
        name: key,
        effects: [],
      };
      update({ triggers: triggers as TriggerHooks });
    }
    setFocusedStack(key);
  };

  const appendEffect = (eff: EffectKind) => {
    const stack = stacks.find((s) => s.id === focusId);
    if (!stack) {
      // No stacks yet - auto-create on_fire
      update({ on_fire: { name: "Fire", effects: [eff] } });
      setFocusedStack("on_fire");
      return;
    }
    setBatchEffects(stack.id, [...stack.effects, eff]);
  };

  return (
    <div className="scratch">
      <VocabDatalists />
      <SpecHeaderStrip spec={spec} update={update} timingRecords={timingRecords} />

      <div className="scratch-main">
        <div className="scratch-palette">
          <Palette
            stacksUsed={new Set(stacks.map((s) => s.id))}
            onAddHat={addStack}
            onAddBlock={appendEffect}
          />
        </div>

        <WorkspaceDropArea onDropHat={addStack}>
          {stacks.length === 0 ? (
            <EmptyWorkspaceHint />
          ) : (
            stacks.map((stack) => (
              <StackView
                key={stack.id}
                stack={stack}
                isFocused={stack.id === focusId}
                onFocus={() => setFocusedStack(stack.id)}
                onChangeEffects={(next) => setBatchEffects(stack.id, next)}
                onRemove={() => removeStack(stack.id)}
                onTickIntervalChange={
                  stack.id === "on_tick" ? setTickInterval : undefined
                }
                tickInterval={spec.triggers?.on_tick?.interval_sec}
              />
            ))
          )}
        </WorkspaceDropArea>
      </div>
    </div>
  );
}

// ── Top strip: identity, timing, decision ─────────────────────────

function SpecHeaderStrip({
  spec,
  update,
  timingRecords,
}: {
  spec: UserAbilitySpec;
  update: (patch: Partial<UserAbilitySpec>) => void;
  timingRecords?: ReadonlyArray<CustomTimingRecord>;
}): ReactNode {
  return (
    <div className="scratch-strip">
      <div className="scratch-strip-row">
        <SmallField label="ID">
          <input
            className="scratch-input"
            value={spec.id}
            onChange={(e) => update({ id: e.target.value })}
            placeholder="user.my_ability"
          />
        </SmallField>
        <SmallField label="Display name">
          <input
            className="scratch-input"
            value={spec.display_name}
            onChange={(e) => update({ display_name: e.target.value })}
            placeholder="My Ability"
          />
        </SmallField>
        <SmallField label="Timing">
          <select
            className="scratch-input"
            // The select multiplexes both timing_mode_override (built-ins)
            // and timing_user_override (user-defined). User entries are
            // prefixed `user:` to avoid collision with built-in names.
            value={
              spec.timing_user_override
                ? `user:${spec.timing_user_override}`
                : (spec.timing_mode_override ?? "")
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("user:")) {
                update({
                  timing_mode_override: undefined,
                  timing_user_override: v.slice(5),
                });
              } else {
                update({
                  timing_mode_override: v === "" ? undefined : (v as TimingMode),
                  timing_user_override: undefined,
                });
              }
            }}
          >
            <option value="">(session default)</option>
            <optgroup label="Built-in">
              <option value="really_fast">really_fast</option>
              <option value="fast">fast</option>
              <option value="semi_ideal">semi_ideal</option>
              <option value="ideal">ideal</option>
              <option value="extreme">extreme</option>
            </optgroup>
            {timingRecords && timingRecords.length > 0 ? (
              <optgroup label="Your custom timings">
                {timingRecords.map((r) => (
                  <option key={r.spec.id} value={`user:${r.spec.id}`}>
                    {r.spec.display_name || r.spec.id}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </SmallField>
      </div>
      <div className="scratch-strip-row">
        <SmallField label="Utility (higher = more attractive)">
          <ExprInput
            value={spec.utility}
            onChange={(v) => v !== undefined && update({ utility: v })}
            placeholder="e.g. self.bite_dps"
          />
        </SmallField>
        <SmallField label="Available (0 = unavailable)">
          <ExprInput
            value={spec.is_available}
            onChange={(v) => v !== undefined && update({ is_available: v })}
            placeholder="e.g. self.cooldown_remaining.user.x &lt;= 0"
          />
        </SmallField>
        <SmallField label="ReallyFast gate (optional)">
          <ExprInput
            value={spec.really_fast_gate}
            onChange={(v) => update({ really_fast_gate: v })}
            placeholder="(empty)"
            optional
          />
        </SmallField>
      </div>
      <LevelsSection spec={spec} update={update} />
    </div>
  );
}

// Levels + scaling-table editor. Collapses entirely
// when the ability is single-level with no scaling (the earlier
// default), to keep the header strip clean for the common case.
function LevelsSection({
  spec,
  update,
}: {
  spec: UserAbilitySpec;
  update: (patch: Partial<UserAbilitySpec>) => void;
}): ReactNode {
  const levels = spec.levels ?? 1;
  const defaultLevel = spec.default_level ?? 1;
  const scaling = spec.scaling ?? {};
  const hasShape =
    levels !== 1 ||
    defaultLevel !== 1 ||
    Object.keys(scaling).length > 0;

  if (!hasShape) {
    return (
      <div className="scratch-strip-row">
        <button
          type="button"
          className="scratch-input"
          style={{ width: "auto", cursor: "pointer" }}
          onClick={() =>
            update({
              levels: 2,
              default_level: 1,
              scaling: { damage: [50, 100] },
            })
          }
        >
          + Add ability levels (scaling table)
        </button>
        <span className="scratch-hint">
          Lets users pick Lv 1 / Lv 2 / ... per matchup. The spec's
          numeric scaling values resolve to <code>scaling.&lt;key&gt;</code>{" "}
          inside expressions.
        </span>
      </div>
    );
  }

  const setLevels = (next: number) => {
    const clampedLevels = Math.max(1, Math.floor(next));
    // Re-shape every scaling array to clampedLevels (pad with last, truncate).
    const nextScaling: Record<string, number[]> = {};
    for (const [key, values] of Object.entries(scaling)) {
      if (clampedLevels === 0) continue;
      if (values.length === clampedLevels) {
        nextScaling[key] = values;
      } else if (values.length < clampedLevels) {
        const last = values[values.length - 1] ?? 0;
        nextScaling[key] = [
          ...values,
          ...Array(clampedLevels - values.length).fill(last),
        ];
      } else {
        nextScaling[key] = values.slice(0, clampedLevels);
      }
    }
    update({
      levels: clampedLevels,
      default_level: Math.min(defaultLevel, clampedLevels),
      scaling: nextScaling,
    });
  };

  const setCell = (key: string, levelIdx: number, value: number) => {
    const values = (scaling[key] ?? []).slice();
    while (values.length < levels) values.push(0);
    values[levelIdx] = Number.isFinite(value) ? value : 0;
    update({ scaling: { ...scaling, [key]: values } });
  };

  const renameKey = (oldKey: string, newKey: string) => {
    if (!newKey || newKey === oldKey) return;
    if (scaling[newKey]) return; // collision - silently ignore
    const next: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(scaling)) {
      next[k === oldKey ? newKey : k] = v;
    }
    update({ scaling: next });
  };

  const removeKey = (key: string) => {
    const next = { ...scaling };
    delete next[key];
    update({ scaling: next });
  };

  const addKey = () => {
    let i = 1;
    let key = `value${i}`;
    while (scaling[key]) {
      i += 1;
      key = `value${i}`;
    }
    update({
      scaling: { ...scaling, [key]: new Array(levels).fill(0) },
    });
  };

  const removeLevelsBlock = () => {
    update({ levels: 1, default_level: 1, scaling: {} });
  };

  return (
    <>
      <div className="scratch-strip-row">
        <SmallField label="Levels">
          <input
            className="scratch-input"
            type="number"
            min={1}
            max={10}
            value={levels}
            onChange={(e) => setLevels(Number(e.target.value))}
            style={{ width: 80 }}
          />
        </SmallField>
        <SmallField label="Default level (Compare-page override later)">
          <select
            className="scratch-input"
            value={defaultLevel}
            onChange={(e) =>
              update({ default_level: Math.min(Number(e.target.value), levels) })
            }
            style={{ width: 80 }}
          >
            {Array.from({ length: levels }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </SmallField>
        <button
          type="button"
          className="scratch-input"
          style={{ width: "auto", cursor: "pointer" }}
          onClick={removeLevelsBlock}
          title="Reset back to single-level"
        >
          Remove levels
        </button>
      </div>
      <div className="scratch-strip-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span className="scratch-field-label">Scaling table</span>
          <button
            type="button"
            className="scratch-input"
            style={{ width: "auto", cursor: "pointer" }}
            onClick={addKey}
          >
            + Add scaling key
          </button>
        </div>
        {Object.keys(scaling).length === 0 ? (
          <span className="scratch-hint">
            No scaling keys yet - click <b>+ Add scaling key</b> to add one.
            Each row: <code>scaling.&lt;name&gt;</code> with one value per
            level. Use it inside expressions like{" "}
            <code>scaling.damage</code>.
          </span>
        ) : (
          <table style={{ borderCollapse: "collapse", fontSize: "0.85em" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "2px 6px" }}>Key</th>
                {Array.from({ length: levels }, (_, i) => i + 1).map((n) => (
                  <th key={n} style={{ padding: "2px 6px" }}>
                    Lv {n}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {Object.entries(scaling)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, values]) => (
                  <tr key={key}>
                    <td style={{ padding: "2px 6px" }}>
                      <input
                        className="scratch-input"
                        value={key}
                        onChange={(e) => renameKey(key, e.target.value.trim())}
                        style={{ width: 140 }}
                        placeholder="key"
                      />
                    </td>
                    {Array.from({ length: levels }, (_, i) => (
                      <td key={i} style={{ padding: "2px 6px" }}>
                        <input
                          className="scratch-input"
                          type="number"
                          value={values[i] ?? 0}
                          onChange={(e) =>
                            setCell(key, i, Number(e.target.value))
                          }
                          style={{ width: 80 }}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className="scratch-input"
                        style={{ width: "auto", cursor: "pointer" }}
                        onClick={() => removeKey(key)}
                        title="Remove this scaling key"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export function SmallField({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <label className="scratch-field">
      <span className="scratch-field-label">{label}</span>
      {children}
    </label>
  );
}

// ── Stack model ───────────────────────────────────────────────────

// `id` is a plain string (not `StackKey`) so the status editor can reuse
// `StackView` for its own fixed hook stacks (on_apply / on_tick / on_expire).
// The drag payload already keys `stackId` as a string; StackView only
// special-cases the literal "on_tick".
export type StackDescriptor = {
  id: string;
  hatLabel: string;
  hatHint: string;
  effects: EffectKind[];
};

const HAT_LABELS: Record<StackKey, { label: string; hint: string }> = {
  on_fire: { label: "when ability fires", hint: "Active firing - what the policy uses when 'now'." },
  on_round_start: { label: "when round starts", hint: "Fires once at fight start (t = 0)." },
  on_take_damage: { label: "when this side takes damage", hint: "event.damage_taken available inside." },
  on_deal_damage: { label: "when this side deals damage", hint: "event.damage_dealt available inside." },
  on_status_apply: { label: "when status applied to this side", hint: "event.applied_status_count available." },
  on_status_expire: { label: "when status expires on this side", hint: "event.expired_status_count available." },
  on_kill: { label: "when this side kills opponent", hint: "event.damage_dealt available." },
  on_first_strike: { label: "when first-strike state changes", hint: "event.first_strike_active available." },
  on_heal: { label: "when this side gets healed", hint: "event.heal_amount available." },
  on_active_end: { label: "when a user.* active window ends", hint: "event.ended.<id> flags + event.ended_count available." },
  on_before_take_damage: { label: "before this side takes damage (shield hook)", hint: "Write set_extra self damage_override = N to replace incoming damage. event.raw_damage / event.damage_taken / event.prevented_damage available." },
  on_before_deal_damage: { label: "before this side deals damage (amp hook)", hint: "Write set_extra self damage_override = N to replace outgoing damage. Fires before the victim's on_before_take_damage." },
  on_tick: { label: "every N seconds", hint: "Periodic - interval_sec ≥ 0.05." },
};

function describeStacks(spec: UserAbilitySpec): StackDescriptor[] {
  const out: StackDescriptor[] = [];
  if (spec.on_fire) {
    out.push({
      id: "on_fire",
      hatLabel: HAT_LABELS.on_fire.label,
      hatHint: HAT_LABELS.on_fire.hint,
      effects: spec.on_fire.effects,
    });
  }
  // Excludes on_tick because that trigger has a different shape
  // (TickTrigger wraps EffectBatch). on_tick is handled separately
  // below so this loop's `batch.effects` is always `EffectKind[]`.
  const triggerOrder: Array<Exclude<TriggerHookKey, "on_tick">> = [
    "on_round_start",
    "on_take_damage",
    "on_deal_damage",
    "on_status_apply",
    "on_status_expire",
    "on_kill",
    "on_first_strike",
    "on_heal",
    "on_active_end",
    "on_before_take_damage",
    "on_before_deal_damage",
  ];
  for (const k of triggerOrder) {
    const batch = spec.triggers?.[k];
    if (!batch) continue;
    out.push({
      id: k,
      hatLabel: HAT_LABELS[k].label,
      hatHint: HAT_LABELS[k].hint,
      effects: batch.effects,
    });
  }
  if (spec.triggers?.on_tick) {
    out.push({
      id: "on_tick",
      hatLabel: HAT_LABELS.on_tick.label,
      hatHint: HAT_LABELS.on_tick.hint,
      effects: spec.triggers.on_tick.effects.effects,
    });
  }
  return out;
}

// ── Workspace ─────────────────────────────────────────────────────

/** Workspace drop target for palette-hat drags. Catches hat drops
 * anywhere on the workspace background (no need to hit a specific
 * spot) and routes them to addStack. Other drag kinds bubble down
 * to per-block / per-stack handlers via standard DOM event flow. */
export function WorkspaceDropArea({
  onDropHat,
  children,
}: {
  onDropHat: (hatId: string) => void;
  children: ReactNode;
}): ReactNode {
  const [hatHover, setHatHover] = useState(false);
  const onDragOver = (e: DragEvent) => {
    if (activeDragPayload?.kind !== "palette-hat") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!hatHover) setHatHover(true);
  };
  const onDragLeave = (e: DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !(e.currentTarget as Node).contains(next)) {
      setHatHover(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    if (activeDragPayload?.kind !== "palette-hat") return;
    e.preventDefault();
    const hatId = activeDragPayload.hatId;
    onDropHat(hatId);
    clearDragPayload();
    setHatHover(false);
  };
  return (
    <div
      className={`scratch-workspace ${hatHover ? "is-hat-dragover" : ""}`}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
}

function EmptyWorkspaceHint(): ReactNode {
  return (
    <div className="scratch-empty">
      <p>
        <strong>Empty workspace.</strong>
      </p>
      <p>
        Click a yellow <em>hat block</em> on the left palette
        to create your first stack
        <br />
        (e.g. <span className="scratch-hint-pill">when ability fires</span>).
      </p>
      <p className="scratch-empty-hint">
        Then click effect blocks below the palette to add them
        to that stack.
      </p>
    </div>
  );
}

export function StackView({
  stack,
  isFocused,
  onFocus,
  onChangeEffects,
  onRemove,
  onTickIntervalChange,
  tickInterval,
}: {
  stack: StackDescriptor;
  isFocused: boolean;
  onFocus: () => void;
  onChangeEffects: (next: EffectKind[]) => void;
  onRemove: () => void;
  onTickIntervalChange?: (sec: number) => void;
  tickInterval?: number;
}): ReactNode {
  const moveEffect = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stack.effects.length) return;
    const copy = [...stack.effects];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChangeEffects(copy);
  };
  const removeEffect = (i: number) => {
    onChangeEffects(stack.effects.filter((_, idx) => idx !== i));
  };
  const updateEffect = (i: number, next: EffectKind) => {
    const copy = [...stack.effects];
    copy[i] = next;
    onChangeEffects(copy);
  };

  // Stack-level fallback drop target: catches drops that land on
  // the stack background (e.g., the rounded corners or any padding
  // not covered by a block / DropZone). Routes to "append at end"
  // for both palette inserts and workspace reorders. Without this,
  // a slightly-off drop would silently fail.
  const onStackDragOver = (e: DragEvent) => {
    // Hat drags must bubble up to the workspace-level drop target,
    // which is the only place that creates new stacks. Other drags
    // we accept here as a fallback (drop-on-stack-background ⇒
    // append at end).
    if (!isBlockLevelDrag()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect =
      activeDragPayload?.kind === "palette" ? "copy" : "move";
  };
  const onStackDrop = (e: DragEvent) => {
    if (!isBlockLevelDrag()) return;
    e.preventDefault();
    const payload = activeDragPayload;
    if (!payload || payload.kind === "palette-hat") return;
    if (payload.kind === "palette") {
      onChangeEffects([...stack.effects, payload.effect]);
    } else if (payload.stackId === stack.id) {
      if (payload.fromIndex === stack.effects.length - 1) {
        clearDragPayload();
        return;
      }
      const copy = [...stack.effects];
      const [moved] = copy.splice(payload.fromIndex, 1);
      copy.push(moved);
      onChangeEffects(copy);
    }
    clearDragPayload();
  };

  return (
    <div
      className={`scratch-stack ${isFocused ? "is-focused" : ""}`}
      onClick={onFocus}
      onDragOver={onStackDragOver}
      onDrop={onStackDrop}
    >
      {/* Hat block */}
      <div className="scratch-block scratch-block-hat cat-trigger" title={stack.hatHint}>
        {stack.id === "on_tick" && onTickIntervalChange ? (
          <span className="scratch-block-chunk">
            <span className="scratch-block-text">every</span>
            <input
              type="number"
              className="scratch-slot scratch-slot-num"
              value={tickInterval ?? 1}
              min={0.05}
              step={0.05}
              onChange={(e) => onTickIntervalChange(Number(e.target.value) || 1)}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="scratch-block-text">seconds</span>
          </span>
        ) : (
          <span className="scratch-block-text">{stack.hatLabel}</span>
        )}
        <span className="scratch-block-spacer" />
        <button
          type="button"
          className="scratch-block-tool"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Remove the entire "${stack.hatLabel}" stack?`)) onRemove();
          }}
          title="Remove this stack"
          aria-label={`Remove ${stack.hatLabel} stack`}
        >
          ✕
        </button>
      </div>

      {stack.effects.length === 0 ? (
        <DropZone
          onPaletteDrop={(eff) => onChangeEffects([eff])}
          onWorkspaceDrop={() => {/* unused on empty stack from same stack */}}
          variant="empty"
          emptyHint={
            isFocused
              ? "↳ click or drag a palette block here"
              : "↳ click to focus, then click/drag from palette"
          }
        />
      ) : (
        <>
          {stack.effects.map((eff, i) => (
            <DraggableBlock
              key={i}
              stackId={stack.id}
              index={i}
              onPaletteInsert={(newEff, at) => {
                const copy = [...stack.effects];
                copy.splice(at, 0, newEff);
                onChangeEffects(copy);
              }}
              onWorkspaceMove={(fromStack, fromIndex, at) => {
                if (fromStack !== stack.id) return;
                if (fromIndex === at || fromIndex === at - 1) return;
                const copy = [...stack.effects];
                const [moved] = copy.splice(fromIndex, 1);
                const dest = fromIndex < at ? at - 1 : at;
                copy.splice(dest, 0, moved);
                onChangeEffects(copy);
              }}
            >
              <BlockView
                effect={eff}
                onChange={(next) => updateEffect(i, next)}
                onRemove={() => removeEffect(i)}
                onMoveUp={i > 0 ? () => moveEffect(i, -1) : undefined}
                onMoveDown={i < stack.effects.length - 1 ? () => moveEffect(i, 1) : undefined}
              />
            </DraggableBlock>
          ))}
          {/* Trailing drop zone - visible bar so users see WHERE
              they can drop. Append at end on drop. */}
          <DropZone
            onPaletteDrop={(newEff) => onChangeEffects([...stack.effects, newEff])}
            onWorkspaceDrop={(fromStack, fromIndex) => {
              if (fromStack !== stack.id) return;
              if (fromIndex === stack.effects.length - 1) return;
              const copy = [...stack.effects];
              const [moved] = copy.splice(fromIndex, 1);
              copy.push(moved);
              onChangeEffects(copy);
            }}
            variant="trailing"
          />
        </>
      )}
    </div>
  );
}

/** Drop target for the empty-stack hint and the trailing append
 * zone. The "in-between" insertion targeting now lives on
 * DraggableBlock (cursor-aware above/below indicator), so this
 * component only handles the cases where there is no specific
 * neighbor block to align against. */
function DropZone({
  onPaletteDrop,
  onWorkspaceDrop,
  variant,
  emptyHint,
}: {
  onPaletteDrop: (eff: EffectKind) => void;
  onWorkspaceDrop: (fromStackId: string, fromIndex: number) => void;
  variant: "empty" | "trailing";
  emptyHint?: string;
}): ReactNode {
  const [hovering, setHovering] = useState(false);
  const onDragOver = (e: DragEvent) => {
    if (!isBlockLevelDrag()) return; // hats bubble up to workspace
    e.preventDefault();
    e.dataTransfer.dropEffect =
      activeDragPayload?.kind === "palette" ? "copy" : "move";
    if (!hovering) setHovering(true);
  };
  const onDragLeave = () => setHovering(false);
  const onDrop = (e: DragEvent) => {
    if (!isBlockLevelDrag()) return;
    e.preventDefault();
    setHovering(false);
    const payload = activeDragPayload;
    if (!payload || payload.kind === "palette-hat") return;
    if (payload.kind === "palette") {
      onPaletteDrop(payload.effect);
    } else {
      onWorkspaceDrop(payload.stackId, payload.fromIndex);
    }
    clearDragPayload();
  };
  const variantClass =
    variant === "empty" ? "is-empty" : "is-trailing";
  return (
    <div
      className={`scratch-dropzone ${variantClass} ${hovering ? "is-dragover" : ""}`}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className="scratch-dropzone-hint">
        {variant === "empty"
          ? emptyHint
          : "↳ drop here to append at end"}
      </span>
    </div>
  );
}

/** Wraps a workspace block to make it both draggable AND a drop
 * target. Cursor Y position decides whether the drop lands above
 * or below this block; a cyan indicator line shows the resulting
 * insertion point in real time. This means the user can drop
 * directly on a block instead of having to hit a tiny gap strip. */
function DraggableBlock({
  stackId,
  index,
  onPaletteInsert,
  onWorkspaceMove,
  children,
}: {
  stackId: string;
  index: number;
  onPaletteInsert: (eff: EffectKind, insertAt: number) => void;
  onWorkspaceMove: (
    fromStackId: string,
    fromIndex: number,
    insertAt: number,
  ) => void;
  children: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  const [insertSide, setInsertSide] = useState<"above" | "below" | null>(null);
  const isMobile = useIsMobile();

  const startBlockDrag = (e: DragEvent) => {
    // Avoid drag firing on input clicks inside the block. Only meaningful
    // for the desktop path where the whole block is the drag source -
    // the mobile handle isn't an input.
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.isContentEditable) {
      e.preventDefault();
      return;
    }
    setDragPayload(e, { kind: "workspace", stackId, fromIndex: index });
  };

  const onDragOver = (e: DragEvent) => {
    if (!isBlockLevelDrag()) return; // let hat drags bubble up
    e.preventDefault();
    e.dataTransfer.dropEffect =
      activeDragPayload?.kind === "palette" ? "copy" : "move";
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cy = e.clientY - rect.top;
    const side: "above" | "below" = cy < rect.height / 2 ? "above" : "below";
    if (insertSide !== side) setInsertSide(side);
  };
  const onDragLeave = (e: DragEvent) => {
    // Leaving a child element doesn't count - relatedTarget tells us
    // whether the cursor moved out of the block entirely.
    const next = e.relatedTarget as Node | null;
    if (!next || !ref.current?.contains(next)) {
      setInsertSide(null);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const payload = activeDragPayload;
    const side = insertSide;
    setInsertSide(null);
    if (!payload || !side) return;
    // Hat drags target the stack as a whole, not an individual block -
    // they're handled by the stack-level onDrop handler. Discriminate
    // here so the narrow below holds (palette | workspace only).
    if (payload.kind === "palette-hat") return;
    const insertAt = side === "below" ? index + 1 : index;
    if (payload.kind === "palette") {
      onPaletteInsert(payload.effect, insertAt);
    } else {
      onWorkspaceMove(payload.stackId, payload.fromIndex, insertAt);
    }
    clearDragPayload();
  };

  return (
    <div
      ref={ref}
      className={
        `scratch-block-draggable` +
        (insertSide === "above" ? " is-drop-above" : "") +
        (insertSide === "below" ? " is-drop-below" : "")
      }
      draggable={!isMobile}
      onDragStart={startBlockDrag}
      onDragEnd={() => {
        clearDragPayload();
        setInsertSide(null);
      }}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span
        className="scratch-drag-handle scratch-drag-handle-block"
        draggable
        onDragStart={startBlockDrag}
        onDragEnd={() => {
          clearDragPayload();
          setInsertSide(null);
        }}
        onClick={(e) => e.stopPropagation()}
        aria-hidden
      >
        ⋮⋮
      </span>
      {children}
    </div>
  );
}

// ── Block dispatch ────────────────────────────────────────────────

function BlockView({
  effect,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  effect: EffectKind;
  onChange: (next: EffectKind) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}): ReactNode {
  const meta = blockMeta(effect.kind);
  const tools = (
    <div className="scratch-block-tools">
      <button
        type="button"
        className="scratch-block-tool"
        onClick={(e) => {
          e.stopPropagation();
          onMoveUp?.();
        }}
        disabled={!onMoveUp}
        title="Move up"
        aria-label={`Move ${effect.kind} block up`}
      >
        ↑
      </button>
      <button
        type="button"
        className="scratch-block-tool"
        onClick={(e) => {
          e.stopPropagation();
          onMoveDown?.();
        }}
        disabled={!onMoveDown}
        title="Move down"
        aria-label={`Move ${effect.kind} block down`}
      >
        ↓
      </button>
      <button
        type="button"
        className="scratch-block-tool"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove"
        aria-label={`Remove ${effect.kind} block`}
      >
        ✕
      </button>
    </div>
  );

  if (meta.shape === "c") {
    return <CBlock effect={effect} onChange={onChange} category={meta.category} tools={tools} />;
  }

  return (
    <div className={`scratch-block scratch-block-stack ${meta.category}`} onClick={(e) => e.stopPropagation()}>
      <BlockBody effect={effect} onChange={onChange} />
      {tools}
    </div>
  );
}

function CBlock({
  effect,
  onChange,
  category,
  tools,
}: {
  effect: EffectKind;
  onChange: (next: EffectKind) => void;
  category: string;
  tools: ReactNode;
}): ReactNode {
  if (effect.kind === "conditional") {
    return (
      <div className={`scratch-cblock ${category}`} onClick={(e) => e.stopPropagation()}>
        <div className="scratch-cblock-head">
          <Chunk>
            <Lbl>if</Lbl>
            <ExprSlot value={effect.cond} onChange={(v) => onChange({ ...effect, cond: v })} />
            <Lbl>then</Lbl>
          </Chunk>
          {tools}
        </div>
        <NestedStack
          effects={effect.then}
          onChange={(next) => onChange({ ...effect, then: next })}
        />
        <div className="scratch-cblock-mid">
          <Lbl>else</Lbl>
        </div>
        <NestedStack
          effects={effect.otherwise}
          onChange={(next) => onChange({ ...effect, otherwise: next })}
        />
        <div className="scratch-cblock-foot" />
      </div>
    );
  }
  if (effect.kind === "repeat") {
    return (
      <div className={`scratch-cblock ${category}`} onClick={(e) => e.stopPropagation()}>
        <div className="scratch-cblock-head">
          <Chunk>
            <Lbl>repeat</Lbl>
            <NumberSlot
              value={effect.count}
              onChange={(v) =>
                onChange({ ...effect, count: Math.max(1, Math.min(64, Math.floor(v))) })
              }
              min={1}
              step={1}
            />
            <Lbl>times</Lbl>
          </Chunk>
          {tools}
        </div>
        <NestedStack
          effects={effect.body}
          onChange={(next) => onChange({ ...effect, body: next })}
        />
        <div className="scratch-cblock-foot" />
      </div>
    );
  }
  if (effect.kind === "chance") {
    return (
      <div className={`scratch-cblock ${category}`} onClick={(e) => e.stopPropagation()}>
        <div className="scratch-cblock-head">
          <Chunk>
            <Lbl>with chance</Lbl>
            <ExprSlot
              value={effect.probability}
              onChange={(v) => onChange({ ...effect, probability: v })}
            />
          </Chunk>
          {tools}
        </div>
        <NestedStack
          effects={effect.then}
          onChange={(next) => onChange({ ...effect, then: next })}
        />
        <div className="scratch-cblock-foot" />
      </div>
    );
  }
  if (effect.kind === "schedule_effect") {
    return (
      <div className={`scratch-cblock ${category}`} onClick={(e) => e.stopPropagation()}>
        <div className="scratch-cblock-head">
          <Chunk>
            <Lbl>after</Lbl>
            <NumberSlot
              value={effect.delay_sec}
              onChange={(v) => onChange({ ...effect, delay_sec: Math.max(0, v) })}
            />
            <Lbl>seconds, do</Lbl>
          </Chunk>
          {tools}
        </div>
        <NestedStack
          effects={effect.effects}
          onChange={(next) => onChange({ ...effect, effects: next })}
        />
        <div className="scratch-cblock-foot" />
      </div>
    );
  }
  return null;
}

function NestedStack({
  effects,
  onChange,
}: {
  effects: EffectKind[];
  onChange: (next: EffectKind[]) => void;
}): ReactNode {
  const moveEffect = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= effects.length) return;
    const copy = [...effects];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  };
  const updateEffect = (i: number, next: EffectKind) => {
    const copy = [...effects];
    copy[i] = next;
    onChange(copy);
  };
  const removeEffect = (i: number) => onChange(effects.filter((_, idx) => idx !== i));

  return (
    <div className="scratch-cblock-body">
      {effects.length === 0 ? (
        <div className="scratch-stack-empty scratch-stack-empty-nested">
          ↳ empty - use ＋ add block to fill
        </div>
      ) : (
        effects.map((eff, i) => (
          <BlockView
            key={i}
            effect={eff}
            onChange={(next) => updateEffect(i, next)}
            onRemove={() => removeEffect(i)}
            onMoveUp={i > 0 ? () => moveEffect(i, -1) : undefined}
            onMoveDown={i < effects.length - 1 ? () => moveEffect(i, 1) : undefined}
          />
        ))
      )}
      <NestedAddBlockMenu onAdd={(eff) => onChange([...effects, eff])} />
    </div>
  );
}

// ── Block body (per effect kind) ──────────────────────────────────

function BlockBody({
  effect,
  onChange,
}: {
  effect: EffectKind;
  onChange: (next: EffectKind) => void;
}): ReactNode {
  switch (effect.kind) {
    case "deal_direct_damage":
      return (
        <>
          <Chunk>
            <Lbl>deal</Lbl>
            <NumberSlot value={effect.amount} onChange={(v) => onChange({ ...effect, amount: v })} />
          </Chunk>
          <Chunk>
            <Lbl>to</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
        </>
      );
    case "deal_expr_damage":
      return (
        <>
          <Chunk>
            <Lbl>deal</Lbl>
            <ExprSlot value={effect.amount} onChange={(v) => onChange({ ...effect, amount: v })} />
          </Chunk>
          <Chunk>
            <Lbl>to</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
        </>
      );
    case "heal_hp":
      return (
        <>
          <Chunk>
            <Lbl>heal</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <Lbl>by</Lbl>
            <NumberSlot value={effect.amount} onChange={(v) => onChange({ ...effect, amount: v })} />
          </Chunk>
        </>
      );
    case "heal_expr_amount":
      return (
        <>
          <Chunk>
            <Lbl>heal</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <Lbl>by</Lbl>
            <ExprSlot value={effect.amount} onChange={(v) => onChange({ ...effect, amount: v })} />
          </Chunk>
        </>
      );
    case "deal_direct_damage_max_hp_fraction":
      return (
        <>
          <Chunk>
            <Lbl>deal</Lbl>
            <NumberSlot
              value={effect.fraction}
              onChange={(v) => onChange({ ...effect, fraction: v })}
              step={0.05}
            />
            <Lbl>× max HP</Lbl>
          </Chunk>
          <Chunk>
            <Lbl>to</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
        </>
      );
    case "pay_self_cost_max_hp_fraction":
      return (
        <>
          <Chunk>
            <Lbl>pay</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <NumberSlot
              value={effect.fraction}
              onChange={(v) => onChange({ ...effect, fraction: v })}
              step={0.05}
            />
            <Lbl>× max HP</Lbl>
          </Chunk>
        </>
      );
    case "set_hp":
      return (
        <>
          <Chunk>
            <Lbl>set HP of</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <Lbl>to</Lbl>
            <NumberSlot value={effect.value} onChange={(v) => onChange({ ...effect, value: v })} />
          </Chunk>
        </>
      );
    case "set_hp_expr":
      return (
        <>
          <Chunk>
            <Lbl>set HP of</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <Lbl>to</Lbl>
            <ExprSlot value={effect.value} onChange={(v) => onChange({ ...effect, value: v })} />
          </Chunk>
        </>
      );
    case "transfer_hp":
      return (
        <>
          <Chunk>
            <Lbl>transfer</Lbl>
            <NumberSlot value={effect.amount} onChange={(v) => onChange({ ...effect, amount: v })} />
            <Lbl>HP</Lbl>
          </Chunk>
          <Chunk>
            <Lbl>from</Lbl>
            <TargetSlot value={effect.from} onChange={(t) => onChange({ ...effect, from: t })} />
          </Chunk>
          <Chunk>
            <Lbl>to</Lbl>
            <TargetSlot value={effect.to} onChange={(t) => onChange({ ...effect, to: t })} />
          </Chunk>
        </>
      );
    case "swap_hp_ratio":
      return <Lbl>swap HP% (caster ↔ opp)</Lbl>;
    case "deal_typed_damage":
      return (
        <>
          <Chunk>
            <Lbl>deal</Lbl>
            <NumberSlot value={effect.amount} onChange={(v) => onChange({ ...effect, amount: v })} />
            <SelectSlot
              value={effect.damage_type}
              options={["bite", "breath", "true"]}
              onChange={(v) => onChange({ ...effect, damage_type: v as TypedDamageKind })}
            />
          </Chunk>
          <Chunk>
            <Lbl>to</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
        </>
      );
    case "apply_status_to_target":
      return (
        <>
          <Chunk>
            <Lbl>apply</Lbl>
            <TextSlot
              value={effect.status.status_id}
              onChange={(s) =>
                onChange({ ...effect, status: { ...effect.status, status_id: s } })
              }
              placeholder="Burn_Status"
              suggest="statuses"
            />
          </Chunk>
          <Chunk>
            <Lbl>×</Lbl>
            <NumberSlot
              value={effect.status.stacks}
              onChange={(v) =>
                onChange({ ...effect, status: { ...effect.status, stacks: v } as AppliedStatus })
              }
              min={0}
              step={1}
            />
          </Chunk>
          <Chunk>
            <Lbl>to</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
        </>
      );
    case "apply_status_expr_stacks":
      return (
        <>
          <Chunk>
            <Lbl>apply</Lbl>
            <TextSlot value={effect.status_id} onChange={(s) => onChange({ ...effect, status_id: s })} placeholder="Burn_Status" suggest="statuses" />
          </Chunk>
          <Chunk>
            <Lbl>×</Lbl>
            <ExprSlot value={effect.stacks} onChange={(v) => onChange({ ...effect, stacks: v })} />
          </Chunk>
          <Chunk>
            <Lbl>to</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
        </>
      );
    case "clear_status":
      return (
        <>
          <Chunk>
            <Lbl>clear</Lbl>
            <TextSlot value={effect.status_id} onChange={(s) => onChange({ ...effect, status_id: s })} placeholder="Burn_Status" suggest="statuses" />
          </Chunk>
          <Chunk>
            <Lbl>on</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
        </>
      );
    case "modify_status_stacks":
      return (
        <>
          <Chunk>
            <Lbl>modify</Lbl>
            <TextSlot value={effect.status_id} onChange={(s) => onChange({ ...effect, status_id: s })} placeholder="Burn_Status" suggest="statuses" />
            <Lbl>stacks</Lbl>
          </Chunk>
          <Chunk>
            <Lbl>on</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <ModeSlot value={effect.mode} onChange={(m) => onChange({ ...effect, mode: m })} />
            <NumberSlot value={effect.value} onChange={(v) => onChange({ ...effect, value: v })} />
          </Chunk>
        </>
      );
    case "dispel_all_statuses":
      return (
        <Chunk>
          <Lbl>dispel ALL statuses on</Lbl>
          <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
        </Chunk>
      );
    case "cleanse_fortify_removable_statuses":
      return (
        <Chunk>
          <Lbl>cleanse fortify-removable on</Lbl>
          <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
        </Chunk>
      );
    case "extend_status":
      return (
        <>
          <Chunk>
            <Lbl>extend</Lbl>
            <TextSlot value={effect.status_id} onChange={(s) => onChange({ ...effect, status_id: s })} placeholder="Burn_Status" suggest="statuses" />
          </Chunk>
          <Chunk>
            <Lbl>on</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <Lbl>by</Lbl>
            <NumberSlot value={effect.seconds} onChange={(v) => onChange({ ...effect, seconds: v })} />
            <Lbl>s</Lbl>
          </Chunk>
        </>
      );
    case "set_status_next_decay":
      return (
        <>
          <Chunk>
            <Lbl>set</Lbl>
            <TextSlot value={effect.status_id} onChange={(s) => onChange({ ...effect, status_id: s })} suggest="statuses" />
            <Lbl>next-decay</Lbl>
          </Chunk>
          <Chunk>
            <Lbl>on</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <Lbl>to t =</Lbl>
            <NumberSlot value={effect.absolute_time} onChange={(v) => onChange({ ...effect, absolute_time: v })} />
          </Chunk>
        </>
      );
    case "set_status_next_tick":
      return (
        <>
          <Chunk>
            <Lbl>set</Lbl>
            <TextSlot value={effect.status_id} onChange={(s) => onChange({ ...effect, status_id: s })} suggest="statuses" />
            <Lbl>next-tick</Lbl>
          </Chunk>
          <Chunk>
            <Lbl>on</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <Lbl>to t =</Lbl>
            <NumberSlot value={effect.absolute_time} onChange={(v) => onChange({ ...effect, absolute_time: v })} />
          </Chunk>
        </>
      );
    case "consume_status_for_damage":
      return (
        <>
          <Chunk>
            <Lbl>consume</Lbl>
            <TextSlot value={effect.status_id} onChange={(s) => onChange({ ...effect, status_id: s })} placeholder="Burn_Status" suggest="statuses" />
          </Chunk>
          <Chunk>
            <Lbl>on</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <Lbl>for</Lbl>
            <ExprSlot value={effect.damage_per_stack} onChange={(v) => onChange({ ...effect, damage_per_stack: v })} />
            <Lbl>damage / stack</Lbl>
          </Chunk>
        </>
      );
    case "set_cooldown_until":
      return (
        <>
          <Chunk>
            <Lbl>cooldown</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <TextSlot value={effect.cooldown_id} onChange={(s) => onChange({ ...effect, cooldown_id: s })} placeholder="user.my_id" suggest="abilities" wide />
          <Chunk>
            <Lbl>for</Lbl>
            <NumberSlot value={effect.duration_sec} onChange={(v) => onChange({ ...effect, duration_sec: v })} />
            <Lbl>s</Lbl>
          </Chunk>
        </>
      );
    case "set_active_until":
      return (
        <>
          <Chunk>
            <Lbl>active</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <TextSlot value={effect.active_id} onChange={(s) => onChange({ ...effect, active_id: s })} placeholder="user.my_id" suggest="abilities" wide />
          <Chunk>
            <Lbl>for</Lbl>
            <NumberSlot value={effect.duration_sec} onChange={(v) => onChange({ ...effect, duration_sec: v })} />
            <Lbl>s</Lbl>
          </Chunk>
        </>
      );
    case "set_cooldown_until_expr":
      return (
        <>
          <Chunk>
            <Lbl>cooldown</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <TextSlot value={effect.cooldown_id} onChange={(s) => onChange({ ...effect, cooldown_id: s })} placeholder="user.my_id" suggest="abilities" wide />
          <Chunk>
            <Lbl>for</Lbl>
            <ExprSlot value={effect.duration_sec} onChange={(v) => onChange({ ...effect, duration_sec: v })} />
            <Lbl>s</Lbl>
          </Chunk>
        </>
      );
    case "set_active_until_expr":
      return (
        <>
          <Chunk>
            <Lbl>active</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <TextSlot value={effect.active_id} onChange={(s) => onChange({ ...effect, active_id: s })} placeholder="user.my_id" suggest="abilities" wide />
          <Chunk>
            <Lbl>for</Lbl>
            <ExprSlot value={effect.duration_sec} onChange={(v) => onChange({ ...effect, duration_sec: v })} />
            <Lbl>s</Lbl>
          </Chunk>
        </>
      );
    case "cooldown_reset":
      return (
        <>
          <Chunk>
            <Lbl>reset</Lbl>
            <SelectSlot
              value={effect.which}
              options={["cooldown", "active_until"]}
              onChange={(v) => onChange({ ...effect, which: v as "cooldown" | "active_until" })}
            />
          </Chunk>
          <Chunk>
            <Lbl>on</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <TextSlot value={effect.cooldown_id} onChange={(s) => onChange({ ...effect, cooldown_id: s })} placeholder="user.my_id" suggest="abilities" wide />
        </>
      );
    case "interrupt_next_hit":
      return (
        <>
          <Chunk>
            <Lbl>interrupt next bite of</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <Lbl>by</Lbl>
            <NumberSlot value={effect.delay_sec} onChange={(v) => onChange({ ...effect, delay_sec: v })} />
            <Lbl>s</Lbl>
          </Chunk>
        </>
      );
    case "consume_breath":
      return (
        <>
          <Chunk>
            <Lbl>consume</Lbl>
            <NumberSlot value={effect.amount} onChange={(v) => onChange({ ...effect, amount: v })} />
            <Lbl>s of breath</Lbl>
          </Chunk>
          <Chunk>
            <Lbl>on</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
        </>
      );
    case "restore_breath":
      return (
        <>
          <Chunk>
            <Lbl>restore</Lbl>
            <NumberSlot value={effect.amount} onChange={(v) => onChange({ ...effect, amount: v })} />
            <Lbl>s of breath</Lbl>
          </Chunk>
          <Chunk>
            <Lbl>on</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
        </>
      );
    case "modify_stat":
      return (
        <>
          <Chunk>
            <Lbl>modify</Lbl>
            <TextSlot value={effect.field} onChange={(s) => onChange({ ...effect, field: s })} placeholder="damage" suggest="stats" />
          </Chunk>
          <Chunk>
            <Lbl>on</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <ModeSlot value={effect.mode} onChange={(m) => onChange({ ...effect, mode: m })} />
            <NumberSlot value={effect.value} onChange={(v) => onChange({ ...effect, value: v })} />
          </Chunk>
          <Chunk>
            <Lbl>for</Lbl>
            <NumberSlot value={effect.duration_sec} onChange={(v) => onChange({ ...effect, duration_sec: v })} />
            <Lbl>s</Lbl>
          </Chunk>
        </>
      );
    case "form_swap":
      // Array variant (stat_changes) - render an opaque summary; full
      // editing happens in code mode, mirroring apply_statuses_to_target /
      // clear_statuses.
      return (
        <Lbl>
          (form swap: {effect.stat_changes.length} stat
          {effect.stat_changes.length === 1 ? "" : "s"} on {effect.target},{" "}
          {effect.duration_sec > 0 ? `${effect.duration_sec}s` : "permanent"},{" "}
          {effect.hp_policy.kind} hp - edit in code)
        </Lbl>
      );
    case "modify_stat_expr":
      return (
        <>
          <Chunk>
            <Lbl>modify</Lbl>
            <TextSlot value={effect.field} onChange={(s) => onChange({ ...effect, field: s })} placeholder="damage" suggest="stats" />
          </Chunk>
          <Chunk>
            <Lbl>on</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <ModeSlot value={effect.mode} onChange={(m) => onChange({ ...effect, mode: m })} />
            <ExprSlot value={effect.value} onChange={(v) => onChange({ ...effect, value: v })} />
          </Chunk>
          <Chunk>
            <Lbl>for</Lbl>
            <ExprSlot value={effect.duration_sec} onChange={(v) => onChange({ ...effect, duration_sec: v })} />
            <Lbl>s</Lbl>
          </Chunk>
        </>
      );
    case "set_extra":
      return (
        <>
          <Chunk>
            <Lbl>set</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
            <Lbl>.</Lbl>
            <TextSlot value={effect.key} onChange={(s) => onChange({ ...effect, key: s })} placeholder="rage" />
          </Chunk>
          <Chunk>
            <Lbl>=</Lbl>
            <ExprSlot value={effect.value} onChange={(v) => onChange({ ...effect, value: v })} />
          </Chunk>
        </>
      );
    case "increment_extra":
      return (
        <>
          <Chunk>
            <Lbl>add</Lbl>
            <ExprSlot value={effect.amount} onChange={(v) => onChange({ ...effect, amount: v })} />
          </Chunk>
          <Chunk>
            <Lbl>to</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
            <Lbl>.</Lbl>
            <TextSlot value={effect.key} onChange={(s) => onChange({ ...effect, key: s })} placeholder="rage" />
          </Chunk>
        </>
      );
    case "push_extra":
      return (
        <>
          <Chunk>
            <Lbl>push</Lbl>
            <ExprSlot value={effect.value} onChange={(v) => onChange({ ...effect, value: v })} />
          </Chunk>
          <Chunk>
            <Lbl>onto</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
            <Lbl>.</Lbl>
            <TextSlot value={effect.key} onChange={(s) => onChange({ ...effect, key: s })} placeholder="recent_hits" />
          </Chunk>
        </>
      );
    case "clear_extra_array":
      return (
        <Chunk>
          <Lbl>clear array</Lbl>
          <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          <Lbl>.</Lbl>
          <TextSlot value={effect.key} onChange={(s) => onChange({ ...effect, key: s })} placeholder="recent_hits" />
        </Chunk>
      );
    case "trigger_ability":
      return (
        <Chunk>
          <Lbl>chain ability</Lbl>
          <TextSlot
            value={effect.ability_id}
            onChange={(s) => onChange({ ...effect, ability_id: s })}
            placeholder="user.other"
            suggest="abilities"
            wide
          />
        </Chunk>
      );
    case "record_snapshot":
      return (
        <>
          <Chunk>
            <Lbl>snapshot</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <Lbl>as</Lbl>
            <TextSlot value={effect.key} onChange={(s) => onChange({ ...effect, key: s })} placeholder="before" />
          </Chunk>
        </>
      );
    case "restore_snapshot":
      return (
        <>
          <Chunk>
            <Lbl>restore</Lbl>
            <TargetSlot value={effect.target} onChange={(t) => onChange({ ...effect, target: t })} />
          </Chunk>
          <Chunk>
            <Lbl>from</Lbl>
            <TextSlot value={effect.key} onChange={(s) => onChange({ ...effect, key: s })} placeholder="before" />
          </Chunk>
        </>
      );
    case "conditional":
    case "repeat":
    case "chance":
    case "choose":
    case "schedule_effect":
      return null;
    case "apply_statuses_to_target":
      // Array variant - render an opaque summary in
      // the scratch view; full editing happens in code mode (the
      // textarea). Same approach as the compositor blocks that
      // return null above.
      return <Lbl>(apply {effect.statuses.length} statuses - edit in code)</Lbl>;
    case "clear_statuses":
      return <Lbl>(clear {effect.status_ids.length} statuses - edit in code)</Lbl>;
    case "cancel_schedule":
      return (
        <>
          <Chunk>
            <Lbl>cancel schedule</Lbl>
            <TextSlot
              value={effect.name}
              onChange={(s) => onChange({ ...effect, name: s })}
              placeholder="my_bomb"
            />
          </Chunk>
        </>
      );
    case "reschedule":
      return (
        <>
          <Chunk>
            <Lbl>reschedule</Lbl>
            <TextSlot
              value={effect.name}
              onChange={(s) => onChange({ ...effect, name: s })}
              placeholder="my_bomb"
            />
          </Chunk>
          <Chunk>
            <Lbl>to fire in</Lbl>
            <NumberSlot
              value={effect.delay_sec}
              onChange={(v) => onChange({ ...effect, delay_sec: v })}
              min={0}
              step={0.5}
            />
            <Lbl>s</Lbl>
          </Chunk>
        </>
      );
    default: {
      void (effect satisfies never);
      return <Lbl>(unsupported - edit in code)</Lbl>;
    }
  }
}

function Lbl({ children }: { children: ReactNode }): ReactNode {
  return <span className="scratch-block-text">{children}</span>;
}

/** Inline-flex nowrap span - keeps label+slot pairs (e.g. "to opp",
 * "for 5 s") together when block content wraps. Without this the
 * preposition strands at the end of one line and its slot wraps to
 * the next, which reads badly. */
function Chunk({ children }: { children: ReactNode }): ReactNode {
  return <span className="scratch-block-chunk">{children}</span>;
}

// ── Slot inputs ───────────────────────────────────────────────────

function NumberSlot({
  value,
  onChange,
  step,
  min,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}): ReactNode {
  return (
    <input
      type="number"
      className="scratch-slot scratch-slot-num"
      value={value}
      step={step ?? "any"}
      min={min}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Vocab key → which datalist this slot references. The actual
 * <datalist> elements are rendered once at the editor root. */
type SuggestionList = "statuses" | "abilities" | "stats";

const SUGGESTION_LIST_ID: Record<SuggestionList, string> = {
  statuses: "scratch-vocab-statuses",
  abilities: "scratch-vocab-abilities",
  stats: "scratch-vocab-stats",
};

function TextSlot({
  value,
  onChange,
  placeholder,
  suggest,
  wide,
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  /** Optional vocab list - user can still type freeform. */
  suggest?: SuggestionList;
  /** Wider variant for long IDs like `user.my_ability`. */
  wide?: boolean;
}): ReactNode {
  return (
    <input
      type="text"
      className={`scratch-slot scratch-slot-text ${wide ? "is-wide" : ""}`}
      value={value}
      placeholder={placeholder}
      list={suggest ? SUGGESTION_LIST_ID[suggest] : undefined}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      spellCheck={false}
      autoComplete="off"
    />
  );
}

/** Live list of registered custom-status ids so the
 * apply/clear/consume status-id inputs suggest the user's own statuses
 * alongside the built-in catalog. Re-reads on registry changes. */
function useRegisteredUserStatusIds(): string[] {
  const [ids, setIds] = useState<string[]>(() =>
    listCustomStatusRecords().map((r) => r.spec.id),
  );
  useEffect(() => {
    const update = () =>
      setIds(listCustomStatusRecords().map((r) => r.spec.id));
    update();
    return subscribeCustomStatusRegistry(update);
  }, []);
  return ids;
}

/** Renders the shared <datalist> elements once. Inputs throughout
 * the editor reference these via `list="scratch-vocab-..."`. */
export function VocabDatalists(): ReactNode {
  const userStatusIds = useRegisteredUserStatusIds();
  const statusIds = [...new Set([...KNOWN_STATUS_IDS, ...userStatusIds])];
  return (
    <>
      <datalist id={SUGGESTION_LIST_ID.statuses}>
        {statusIds.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id={SUGGESTION_LIST_ID.abilities}>
        {ABILITY_ID_SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id={SUGGESTION_LIST_ID.stats}>
        {STATS_FIELDS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}

function TargetSlot({
  value,
  onChange,
}: {
  value: EffectTarget;
  onChange: (t: EffectTarget) => void;
}): ReactNode {
  return (
    <select
      className="scratch-slot scratch-slot-select"
      value={value}
      onChange={(e) => onChange(e.target.value as EffectTarget)}
      onClick={(e) => e.stopPropagation()}
    >
      <option value="caster">self</option>
      <option value="opponent">opp</option>
    </select>
  );
}

function ModeSlot({
  value,
  onChange,
}: {
  value: ModifierMode;
  onChange: (m: ModifierMode) => void;
}): ReactNode {
  return (
    <select
      className="scratch-slot scratch-slot-select"
      value={value}
      onChange={(e) => onChange(e.target.value as ModifierMode)}
      onClick={(e) => e.stopPropagation()}
    >
      <option value="add">+=</option>
      <option value="mul">×=</option>
      <option value="set">=</option>
    </select>
  );
}

function SelectSlot({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}): ReactNode {
  return (
    <select
      className="scratch-slot scratch-slot-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** Round-trip Expr through DSL text. Local string state survives
 * spec re-renders so user typing isn't clobbered. */
function ExprSlot({
  value,
  onChange,
}: {
  value: Expr;
  onChange: (v: Expr) => void;
}): ReactNode {
  return (
    <ExprInput
      value={value}
      onChange={(v) => v !== undefined && onChange(v)}
      slotStyle
    />
  );
}

export function ExprInput({
  value,
  onChange,
  placeholder,
  optional,
  slotStyle,
}: {
  value: Expr | undefined;
  onChange: (v: Expr | undefined) => void;
  placeholder?: string;
  optional?: boolean;
  slotStyle?: boolean;
}): ReactNode {
  const printed = value === undefined ? "" : printExpr(value);
  const [text, setText] = useState(printed);
  const [error, setError] = useState<string | null>(null);
  // Re-sync from parent when the printed form differs and user
  // hasn't diverged. Cheap to recompute on each render.
  if (text !== printed && error === null) {
    // Only re-sync if the parsed form of `text` matches `value`
    // (i.e. user committed a change and parent updated). Otherwise
    // user is mid-edit; keep their text.
    const r = parseExpr(text);
    if (r.ok && printExpr(r.expr) !== printed) {
      // diverged - local typing is in progress; do nothing
    } else if (!r.ok) {
      // local has error; keep the text
    } else {
      // matches - leave text alone (already in sync)
    }
  }

  const commit = (raw: string) => {
    if (optional && raw.trim() === "") {
      setError(null);
      onChange(undefined);
      return;
    }
    if (raw.trim() === "") {
      setError("expression required");
      return;
    }
    const r = parseExpr(raw);
    if (r.ok) {
      setError(null);
      onChange(r.expr);
    } else {
      setError(r.error);
    }
  };

  const cls = slotStyle ? "scratch-slot scratch-slot-expr" : "scratch-input scratch-input-mono";
  return (
    <span className={`scratch-expr-wrap ${slotStyle ? "is-slot" : ""}`}>
      <input
        type="text"
        className={`${cls} ${error ? "is-error" : ""}`}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onClick={(e) => e.stopPropagation()}
        spellCheck={false}
      />
      {error ? <span className="scratch-expr-error" title={error}>!</span> : null}
    </span>
  );
}

// ── Block metadata ────────────────────────────────────────────────

type BlockMeta = { category: string; shape: "stack" | "c" };

function blockMeta(kind: EffectKind["kind"]): BlockMeta {
  switch (kind) {
    case "deal_direct_damage":
    case "deal_expr_damage":
    case "deal_direct_damage_max_hp_fraction":
    case "deal_typed_damage":
    case "pay_self_cost_max_hp_fraction":
    case "consume_status_for_damage":
      return { category: "cat-damage", shape: "stack" };
    case "heal_hp":
    case "heal_expr_amount":
    case "set_hp":
    case "set_hp_expr":
    case "transfer_hp":
    case "swap_hp_ratio":
      return { category: "cat-heal", shape: "stack" };
    case "apply_status_to_target":
    case "apply_statuses_to_target":
    case "apply_status_expr_stacks":
    case "clear_status":
    case "clear_statuses":
    case "modify_status_stacks":
    case "dispel_all_statuses":
    case "cleanse_fortify_removable_statuses":
    case "extend_status":
    case "set_status_next_decay":
    case "set_status_next_tick":
      return { category: "cat-status", shape: "stack" };
    case "set_cooldown_until":
    case "set_cooldown_until_expr":
    case "set_active_until":
    case "set_active_until_expr":
    case "cooldown_reset":
    case "interrupt_next_hit":
    case "consume_breath":
    case "restore_breath":
      return { category: "cat-cooldown", shape: "stack" };
    case "set_extra":
    case "increment_extra":
    case "modify_stat":
    case "modify_stat_expr":
    case "form_swap":
    case "push_extra":
    case "clear_extra_array":
      return { category: "cat-state", shape: "stack" };
    case "conditional":
    case "repeat":
    case "chance":
    case "choose":
    case "schedule_effect":
      return { category: "cat-control", shape: "c" };
    case "cancel_schedule":
    case "reschedule":
      // Leaf shape: no nested body slot, just inline-edit fields.
      return { category: "cat-control", shape: "stack" };
    case "record_snapshot":
    case "restore_snapshot":
    case "trigger_ability":
      return { category: "cat-snapshot", shape: "stack" };
    default:
      return { category: "cat-state", shape: "stack" };
  }
}

// ── Palette ───────────────────────────────────────────────────────

type PaletteItem = {
  label: string;
  build: () => EffectKind;
};

type PaletteCategory = {
  id: string;
  name: string;
  className: string;
  items: PaletteItem[];
};

type HatItem = { id: string; label: string };

const PALETTE_HATS: HatItem[] = [
  { id: "on_fire", label: "when ability fires" },
  { id: "on_round_start", label: "when round starts" },
  { id: "on_take_damage", label: "when takes damage" },
  { id: "on_deal_damage", label: "when deals damage" },
  { id: "on_status_apply", label: "when status applied" },
  { id: "on_status_expire", label: "when status expires" },
  { id: "on_kill", label: "when kills" },
  { id: "on_first_strike", label: "when first-strike" },
  { id: "on_heal", label: "when gets healed" },
  { id: "on_active_end", label: "when active ends" },
  { id: "on_before_take_damage", label: "before takes damage (shield)" },
  { id: "on_before_deal_damage", label: "before deals damage (amp)" },
  { id: "on_tick", label: "every N seconds" },
];

const PALETTE_CATEGORIES: PaletteCategory[] = [
  {
    id: "damage",
    name: "Damage",
    className: "cat-damage",
    items: [
      { label: "deal N to opp", build: () => ({ kind: "deal_direct_damage", target: "opponent", amount: 100 }) },
      { label: "deal Expr to opp", build: () => ({ kind: "deal_expr_damage", target: "opponent", amount: { kind: "const", value: 100 } }) },
      { label: "deal fraction× max HP", build: () => ({ kind: "deal_direct_damage_max_hp_fraction", target: "opponent", fraction: 0.5 }) },
      { label: "deal typed (bite/breath)", build: () => ({ kind: "deal_typed_damage", target: "opponent", damage_type: "bite", amount: 100 }) },
      { label: "pay self N% maxHP", build: () => ({ kind: "pay_self_cost_max_hp_fraction", target: "caster", fraction: 0.1 }) },
      { label: "consume status for dmg", build: () => ({ kind: "consume_status_for_damage", target: "opponent", status_id: "Burn_Status", damage_per_stack: { kind: "const", value: 100 } }) },
    ],
  },
  {
    id: "heal",
    name: "Heal / HP",
    className: "cat-heal",
    items: [
      { label: "heal self by N", build: () => ({ kind: "heal_hp", target: "caster", amount: 100 }) },
      { label: "heal self by Expr", build: () => ({ kind: "heal_expr_amount", target: "caster", amount: { kind: "const", value: 100 } }) },
      { label: "set HP to N", build: () => ({ kind: "set_hp", target: "caster", value: 100 }) },
      { label: "set HP to Expr", build: () => ({ kind: "set_hp_expr", target: "caster", value: { kind: "const", value: 100 } }) },
      { label: "transfer N HP", build: () => ({ kind: "transfer_hp", from: "opponent", to: "caster", amount: 100 }) },
      { label: "swap HP%", build: () => ({ kind: "swap_hp_ratio" }) },
    ],
  },
  {
    id: "status",
    name: "Statuses",
    className: "cat-status",
    items: [
      { label: "apply Status × N", build: () => ({ kind: "apply_status_to_target", target: "opponent", status: { status_id: "Burn_Status", stacks: 3 } }) },
      { label: "apply Status × Expr", build: () => ({ kind: "apply_status_expr_stacks", target: "opponent", status_id: "Burn_Status", stacks: { kind: "const", value: 3 } }) },
      { label: "clear Status", build: () => ({ kind: "clear_status", target: "caster", status_id: "Burn_Status" }) },
      { label: "modify Status stacks", build: () => ({ kind: "modify_status_stacks", target: "caster", status_id: "Burn_Status", mode: "add", value: 1 }) },
      { label: "dispel ALL", build: () => ({ kind: "dispel_all_statuses", target: "opponent" }) },
      { label: "cleanse (fortify-removable)", build: () => ({ kind: "cleanse_fortify_removable_statuses", target: "caster" }) },
      { label: "extend Status by N s", build: () => ({ kind: "extend_status", target: "caster", status_id: "Burn_Status", seconds: 5 }) },
      { label: "set Status next-tick", build: () => ({ kind: "set_status_next_tick", target: "opponent", status_id: "Burn_Status", absolute_time: 0 }) },
      { label: "set Status next-decay", build: () => ({ kind: "set_status_next_decay", target: "opponent", status_id: "Burn_Status", absolute_time: 0 }) },
      { label: "apply N statuses (array)", build: () => ({ kind: "apply_statuses_to_target", target: "opponent", statuses: [{ status_id: "Burn_Status", stacks: 3, source_ability: null }, { status_id: "Bleed_Status", stacks: 3, source_ability: null }] }) },
      { label: "clear N statuses (array)", build: () => ({ kind: "clear_statuses", target: "caster", status_ids: ["Burn_Status", "Bleed_Status"] }) },
    ],
  },
  {
    id: "cooldown",
    name: "Cooldowns",
    className: "cat-cooldown",
    items: [
      { label: "cooldown for N s", build: () => ({ kind: "set_cooldown_until", target: "caster", cooldown_id: "user.my_ability", duration_sec: 5 }) },
      { label: "cooldown for Expr s", build: () => ({ kind: "set_cooldown_until_expr", target: "caster", cooldown_id: "user.my_ability", duration_sec: { kind: "const", value: 5 } }) },
      { label: "active for N s", build: () => ({ kind: "set_active_until", target: "caster", active_id: "user.my_ability", duration_sec: 5 }) },
      { label: "active for Expr s", build: () => ({ kind: "set_active_until_expr", target: "caster", active_id: "user.my_ability", duration_sec: { kind: "const", value: 5 } }) },
      { label: "reset cooldown", build: () => ({ kind: "cooldown_reset", target: "caster", cooldown_id: "user.my_ability", which: "cooldown" }) },
      { label: "interrupt next bite", build: () => ({ kind: "interrupt_next_hit", target: "opponent", delay_sec: 1 }) },
      { label: "consume breath N s", build: () => ({ kind: "consume_breath", target: "caster", amount: 1 }) },
      { label: "restore breath N s", build: () => ({ kind: "restore_breath", target: "caster", amount: 1 }) },
    ],
  },
  {
    id: "state",
    name: "Custom state / Stat mods",
    className: "cat-state",
    items: [
      { label: "set extra = Expr", build: () => ({ kind: "set_extra", target: "caster", key: "rage", value: { kind: "const", value: 0 } }) },
      { label: "inc extra += Expr", build: () => ({ kind: "increment_extra", target: "caster", key: "rage", amount: { kind: "const", value: 1 } }) },
      { label: "modify_stat", build: () => ({ kind: "modify_stat", target: "caster", field: "damage", mode: "mul", value: 1.5, duration_sec: 10 }) },
      { label: "modify_stat (Expr)", build: () => ({ kind: "modify_stat_expr", target: "caster", field: "damage", mode: "mul", value: { kind: "const", value: 1.5 }, duration_sec: { kind: "const", value: 10 } }) },
      { label: "form swap", build: () => ({ kind: "form_swap", target: "caster", stat_changes: [{ field: "health", mode: "set", value: 10000 }], duration_sec: 0, hp_policy: { kind: "ratio" } }) },
      { label: "push to array", build: () => ({ kind: "push_extra", target: "caster", key: "recent_hits", value: { kind: "const", value: 0 } }) },
      { label: "clear array", build: () => ({ kind: "clear_extra_array", target: "caster", key: "recent_hits" }) },
    ],
  },
  {
    id: "control",
    name: "Control flow",
    className: "cat-control",
    items: [
      { label: "if … then … else", build: () => ({ kind: "conditional", cond: { kind: "const", value: 1 }, then: [], otherwise: [] }) },
      { label: "repeat N times", build: () => ({ kind: "repeat", count: 2, body: [] }) },
      { label: "with chance p", build: () => ({ kind: "chance", probability: { kind: "const", value: 0.5 }, then: [] }) },
      { label: "choose 1-of-N (weighted)", build: () => ({ kind: "choose", branches: [{ weight: { kind: "const", value: 1 }, effects: [] }, { weight: { kind: "const", value: 1 }, effects: [] }] }) },
      { label: "after N seconds, do", build: () => ({ kind: "schedule_effect", delay_sec: 1, effects: [] }) },
      { label: "schedule (named) … fire later", build: () => ({ kind: "schedule_effect", delay_sec: 5, effects: [], name: "my_bomb" }) },
      { label: "cancel named schedule", build: () => ({ kind: "cancel_schedule", name: "my_bomb" }) },
      { label: "reschedule named", build: () => ({ kind: "reschedule", name: "my_bomb", delay_sec: 3 }) },
    ],
  },
  {
    id: "snapshot",
    name: "Snapshots / Chains",
    className: "cat-snapshot",
    items: [
      { label: "snapshot key", build: () => ({ kind: "record_snapshot", target: "caster", key: "before" }) },
      { label: "restore snapshot", build: () => ({ kind: "restore_snapshot", target: "caster", key: "before" }) },
      { label: "chain ability", build: () => ({ kind: "trigger_ability", ability_id: "user.other" }) },
    ],
  },
];

/**
 * Every `EffectKind` discriminant the Visual palette can spawn, derived
 * from `PALETTE_CATEGORIES`. The constructor-coverage test asserts this
 * equals `ALL_EFFECT_KINDS` so the Visual editor stays at 100% of the DSL.
 * Adding a palette item updates this set automatically.
 */
export const PALETTE_EFFECT_KINDS: ReadonlySet<EffectKind["kind"]> = new Set(
  PALETTE_CATEGORIES.flatMap((category) =>
    category.items.map((item) => item.build().kind),
  ),
);

export function Palette({
  stacksUsed,
  onAddHat,
  onAddBlock,
  hats,
}: {
  stacksUsed: Set<string>;
  onAddHat: (k: string) => void;
  onAddBlock: (e: EffectKind) => void;
  /** Hat tiles to offer (default: the ability triggers). The status editor
   *  passes its own three lifecycle hooks so they sit in the palette like
   *  ability hats - added on click/drag, not pre-placed. */
  hats?: ReadonlyArray<HatItem>;
}): ReactNode {
  // On mobile (<=640px) the whole tile must NOT be draggable - otherwise
  // every touch on the tile arms the polyfill's drag-start and the
  // palette becomes unscrollable. Instead a small ⋮⋮ handle (rendered
  // inside the tile, hidden on desktop) is the only drag-source. On
  // desktop the handle is hidden via CSS and the tile itself is the
  // mouse-drag source.
  const isMobile = useIsMobile();
  return (
    <>
      <PaletteSection title="Hats - start a new stack" className="cat-trigger">
        {(hats ?? PALETTE_HATS).map((hat) => {
          const used = stacksUsed.has(hat.id);
          const startHatDrag = (e: DragEvent) => {
            if (used) {
              e.preventDefault();
              return;
            }
            setDragPayload(e, { kind: "palette-hat", hatId: hat.id });
          };
          return (
            <button
              key={hat.id}
              type="button"
              className="scratch-palette-block scratch-palette-hat cat-trigger"
              onClick={() => onAddHat(hat.id)}
              disabled={used}
              draggable={!used && !isMobile}
              onDragStart={startHatDrag}
              onDragEnd={clearDragPayload}
              title={
                used
                  ? `${hat.label} (already in workspace)`
                  : `Click or drag to add a "${hat.label}" stack to the workspace`
              }
            >
              <span
                className="scratch-drag-handle"
                draggable={!used}
                onDragStart={startHatDrag}
                onDragEnd={clearDragPayload}
                onClick={(e) => e.stopPropagation()}
                aria-hidden
              >
                ⋮⋮
              </span>
              {hat.label}
            </button>
          );
        })}
      </PaletteSection>

      {PALETTE_CATEGORIES.map((cat) => (
        <PaletteSection key={cat.id} title={cat.name} className={cat.className}>
          {cat.items.map((it) => {
            const startBlockDrag = (e: DragEvent) =>
              setDragPayload(e, { kind: "palette", effect: it.build() });
            return (
              <button
                key={it.label}
                type="button"
                className={`scratch-palette-block ${cat.className}`}
                onClick={() => onAddBlock(it.build())}
                draggable={!isMobile}
                onDragStart={startBlockDrag}
                onDragEnd={clearDragPayload}
                title={`Click or drag "${it.label}" into a stack`}
              >
                <span
                  className="scratch-drag-handle"
                  draggable
                  onDragStart={startBlockDrag}
                  onDragEnd={clearDragPayload}
                  onClick={(e) => e.stopPropagation()}
                  aria-hidden
                >
                  ⋮⋮
                </span>
                {it.label}
              </button>
            );
          })}
        </PaletteSection>
      ))}
    </>
  );
}

function PaletteSection({
  title,
  className,
  children,
}: {
  title: string;
  className: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="scratch-palette-section">
      <div className={`scratch-palette-section-label ${className}`}>{title}</div>
      <div className="scratch-palette-section-blocks">{children}</div>
    </div>
  );
}

/** Compact add-block menu used inside C-block bodies (no palette
 * available there since the palette adds to the top-level focused
 * stack, not the nested body).
 *
 * The menu portals to document.body so it escapes the stack's
 * `overflow: hidden` clipping (the stack uses overflow:hidden to
 * round its corners over flat-edged child blocks). Without the
 * portal the menu would render but be invisible - it'd lie outside
 * the stack's clip rectangle. Position is computed from the
 * toggle button's viewport rect at open-time. */
function NestedAddBlockMenu({ onAdd }: { onAdd: (e: EffectKind) => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  // Close on outside click / Escape / scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        !target?.closest(".scratch-nested-add-menu") &&
        !target?.closest(".scratch-nested-add-toggle")
      ) {
        setOpen(false);
      }
    };
    const onScroll = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && toggleRef.current) {
      const rect = toggleRef.current.getBoundingClientRect();
      // Position below the button by default; flip above if there's
      // not enough room. The CSS `max-height: 60vh` handles further
      // overflow inside the menu via internal scroll.
      const menuHeightEstimate = Math.min(window.innerHeight * 0.6, 480);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const flipUp = spaceBelow < menuHeightEstimate && spaceAbove > spaceBelow;
      const top = flipUp
        ? Math.max(8, rect.top - menuHeightEstimate - 4)
        : rect.bottom + 4;
      // Keep within viewport horizontally too.
      const menuWidthEstimate = 260;
      const left = Math.min(
        Math.max(8, rect.left),
        window.innerWidth - menuWidthEstimate - 8,
      );
      setMenuPos({ top, left });
    }
    setOpen((v) => !v);
  };

  return (
    <div className="scratch-nested-add-wrap">
      <button
        ref={toggleRef}
        type="button"
        className="scratch-nested-add-toggle"
        onClick={handleToggle}
      >
        ＋ add block
      </button>
      {open && menuPos && typeof document !== "undefined"
        ? createPortal(
            <div
              className="scratch-nested-add-menu is-portal"
              style={{ top: menuPos.top, left: menuPos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              {PALETTE_CATEGORIES.map((cat) => (
                <div key={cat.id} className="scratch-nested-add-group">
                  <div className={`scratch-nested-add-group-label ${cat.className}`}>
                    {cat.name}
                  </div>
                  {cat.items.map((it) => (
                    <button
                      key={it.label}
                      type="button"
                      className={`scratch-nested-add-item ${cat.className}`}
                      onClick={() => {
                        onAdd(it.build());
                        setOpen(false);
                      }}
                    >
                      {it.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
