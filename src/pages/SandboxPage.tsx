import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AbilityTimingMode, BuildOptions, CreatureRuntime } from "../engine";
import { CreatureSelectorCard } from "../components/compare/CreatureSelectorCard";
import { statusById, statusEffects } from "../engine/data";
import {
  formatRoundedNumber,
  formatRoundedPercent,
  formatRoundedSeconds,
} from "../shared/displayFormat";

function prettyStatusName(id: string): string {
  return statusById[id]?.name ?? id;
}
import { useSandboxSimulation } from "../hooks/useSandboxSimulation";
import { useBestBuildsBattleSettings } from "../components/bestBuilds/BestBuildsBattleSettingsContext";
import { BestBuildsBattleSettingsPanel } from "../components/bestBuilds/BestBuildsBattleSettings";
import type {
  SandboxAbilityValueKind,
  SandboxAbilityValueSpec,
  SandboxAbilityView,
  SandboxEventFilter,
  SandboxLogEntryView,
  SandboxOverrideField,
  SandboxPassiveKind,
  SandboxPassiveSpec,
  SandboxReadyKind,
  SandboxSide,
  SandboxSideView,
  SandboxView,
} from "../engine/sandboxBridge";
import { getAbilityValueOptions, type AbilityValueOption } from "../engine/abilityValueOptions";
import {
  buildBreathProfileByName,
  listAvailableBreathNames,
} from "../optimizer/rustBestBuildsRuntime";
import { registerMatchSnapshotProvider } from "../shared/matchSnapshot";

const DEFAULT_SEED_STATUS_ID = "Poison_Status";

type SandboxOverrideCategory =
  | "stat"
  | "ability"
  | "passive"
  | "breath"
  | "resist"
  | "offensiveStatus"
  | "defensiveStatus";
type SandboxOverrideMode = "set" | "add";
type SandboxStatField = "health" | "weight" | "damage" | "biteCooldown" | "healthRegen";

const STAT_FIELD_OPTIONS: { id: SandboxStatField; label: string; engineKey: SandboxOverrideField }[] = [
  { id: "health", label: "Health", engineKey: "health" },
  { id: "healthRegen", label: "Health Regen", engineKey: "health_regen" },
  { id: "weight", label: "Weight", engineKey: "weight" },
  { id: "damage", label: "Damage", engineKey: "damage" },
  { id: "biteCooldown", label: "Bite Cooldown", engineKey: "bite_cooldown" },
];

// Ability list is sourced from the Rust engine via
// `sandboxListOverridableAbilities()` on Sandbox mount — single
// source of truth in `composable/sandbox.rs::OVERRIDABLE_ABILITY_FLAGS`.
// Adding a new ability there auto-syncs to this dropdown without
// any TS-side edit. The empty-array fallback below is for the
// first render before the WASM-sourced list resolves.
const ABILITY_OPTIONS_FALLBACK: string[] = [];

type SandboxOverrideEntry =
  | { kind: "stat"; field: SandboxStatField; value: number; mode: SandboxOverrideMode }
  | { kind: "ability"; abilityName: string; enabled: boolean }
  | { kind: "abilityNumber"; abilityName: string; value: number }
  | { kind: "abilityString"; abilityName: string; value: string | null }
  | { kind: "passiveBool"; passiveName: string; enabled: boolean }
  | { kind: "passiveNumber"; passiveName: string; value: number }
  | { kind: "breath"; breathName: string | null }
  | { kind: "resist"; statusId: string; fraction: number }
  | { kind: "offensiveStatus"; statusId: string; stacks: number }
  | { kind: "defensiveStatus"; statusId: string; stacks: number };

type SandboxOverrideEditorState = {
  side: SandboxSide;
  category: SandboxOverrideCategory;
  statField: SandboxStatField;
  abilityName: string;
  passiveName: string;
  breathName: string;
  statusId: string;
  value: string;
};

const DEFAULT_OVERRIDE_EDITOR: SandboxOverrideEditorState = {
  side: "A",
  category: "stat",
  statField: "health",
  // Filled in from the WASM-sourced ability list on mount; empty
  // string is a safe placeholder for the first render before the
  // list resolves (the dropdown shows "no abilities available"
  // briefly then hydrates).
  abilityName: ABILITY_OPTIONS_FALLBACK[0] ?? "",
  passiveName: "",
  breathName: "",
  statusId: DEFAULT_SEED_STATUS_ID,
  value: "",
};

type SandboxPageProps = {
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  buildB: BuildOptions;
  creatureA?: CreatureRuntime;
  creatureB?: CreatureRuntime;
  creatureNames: string[];
  getCreatureIcon: (name: string) => string | null;
  onNameAChange: (value: string) => void;
  onNameBChange: (value: string) => void;
  onBuildAChange: (value: BuildOptions) => void;
  onBuildBChange: (value: BuildOptions) => void;
};

type SandboxPageSnapshotState = {
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  buildB: BuildOptions;
  automationMode: "manual" | "semiAuto";
  abilityPolicy: AbilityTimingMode;
  activesOn: boolean;
  breathOn: boolean;
  startHpA: number;
  startHpB: number;
  overridesA: SandboxOverrideEntry[];
  overridesB: SandboxOverrideEntry[];
};

function describeOverride(entry: SandboxOverrideEntry): string {
  switch (entry.kind) {
    case "stat":
      return `${entry.mode === "set" ? "Set" : "Add"} ${entry.field}: ${formatRoundedNumber(entry.value)}`;
    case "ability":
      return `Ability ${entry.abilityName} ${entry.enabled ? "on" : "off"}`;
    case "abilityNumber":
      // Ability values often live in 0..1 or 0..10 ranges (life-leech
      // fractions, trail HP%, healing-step %), so the standard
      // `formatRoundedNumber` integer truncation hides the user's
      // input. Drop trailing zeros instead.
      return `Ability ${entry.abilityName}: ${Number.isFinite(entry.value) ? String(Number(entry.value.toFixed(4))) : "0"}`;
    case "abilityString":
      return `Ability ${entry.abilityName}: ${entry.value ?? "(none)"}`;
    case "passiveBool":
      return `Passive ${entry.passiveName} ${entry.enabled ? "on" : "off"}`;
    case "passiveNumber":
      return `Passive ${entry.passiveName}: ${Number.isFinite(entry.value) ? String(Number(entry.value.toFixed(4))) : "0"}`;
    case "breath":
      return `Breath ${entry.breathName ?? "(none)"}`;
    case "resist":
      return `Resist ${entry.statusId}: ${formatRoundedNumber(entry.fraction * 100)}%`;
    case "offensiveStatus":
      return `Offensive ${entry.statusId}: ${formatRoundedNumber(entry.stacks)} stacks`;
    case "defensiveStatus":
      return `Defensive ${entry.statusId}: ${formatRoundedNumber(entry.stacks)} stacks`;
  }
}

function logEntryTitle(eventType: string): string {
  switch (eventType) {
    case "bite":
      return "Bite hit";
    case "breath":
      return "Breath tick";
    case "dot":
      return "Status damage";
    case "ability":
      return "Ability fire";
    case "regen":
      return "Regen tick";
    case "death":
      return "Death";
    case "self_destruct":
      return "Self-Destruct";
    case "status_apply":
      return "Status applied";
    case "status_decay":
      return "Status decayed";
    default:
      return eventType
        .split("_")
        .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
        .join(" ");
  }
}

function statusOptionsList(): { id: string; name: string }[] {
  return statusEffects
    .map((s) => ({ id: s.id, name: s.name ?? s.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function SideSetupCard({
  label,
  startHp,
  statusOptions,
  onStartHpChange,
  onApplyHpNow,
  onApplyStatusNow,
}: {
  label: string;
  startHp: number;
  statusOptions: { id: string; name: string }[];
  onStartHpChange: (value: number) => void;
  onApplyHpNow: (value: number) => void;
  onApplyStatusNow: (statusId: string, stacks: number) => void;
}) {
  const [statusId, setStatusId] = useState(DEFAULT_SEED_STATUS_ID);
  const [stacks, setStacks] = useState(10);

  return (
    <div className="panel-block">
      <h3>{label}</h3>
      <div className="field">
        <label>Start HP</label>
        <input
          aria-label={`${label} start HP`}
          type="number"
          min={0}
          value={startHp}
          onChange={(event) => onStartHpChange(Number(event.target.value) || 0)}
        />
      </div>
      <div className="row-actions">
        <button className="secondary" type="button" onClick={() => onApplyHpNow(startHp)}>
          Apply HP Now
        </button>
      </div>
      <div className="field">
        <label>Seed Status</label>
        <select aria-label={`${label} seed status`} value={statusId} onChange={(event) => setStatusId(event.target.value)}>
          {statusOptions.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Stacks</label>
        <input
          aria-label={`${label} seed status stacks`}
          type="number"
          value={stacks}
          onChange={(event) => setStacks(Number(event.target.value) || 0)}
        />
      </div>
      <div className="row-actions">
        <button className="secondary" type="button" onClick={() => onApplyStatusNow(statusId, stacks)}>
          Apply Status Now
        </button>
      </div>
    </div>
  );
}

function SideStateCard({
  label,
  side,
  creatureName,
  view,
  onNextBiteReady,
  onNextBreathReady,
  onNextAbilityReady,
  onManualBite,
  onManualBreath,
  onManualAbility,
}: {
  label: string;
  side: SandboxSide;
  creatureName: string;
  view: SandboxSideView;
  onNextBiteReady: () => void;
  onNextBreathReady: () => void;
  onNextAbilityReady: () => void;
  onManualBite: () => void;
  onManualBreath: () => void;
  onManualAbility: (abilityName: string) => void;
}) {
  return (
    <div className="panel-block">
      <h3>{label}</h3>
      {/* Live regions: HP / breath / next-hit / status changes are the
       * primary feedback when the user advances time or fires an action.
       * `aria-live="polite"` lets a screen reader announce the diff
       * without preempting whatever the user is reading. `aria-atomic`
       * keeps the announcement self-contained (the whole block re-reads,
       * not just the changed sub-node, which is the readable shape for
       * "HP X/Y → HP X'/Y'"). */}
      <div className="sandbox-summary" aria-live="polite" aria-atomic="true">
        <div>
          <strong>{creatureName || `Side ${side}`}</strong>
        </div>
        <div>
          HP: {view.hp.toFixed(1)} / {formatRoundedNumber(view.maxHp)} ({formatRoundedPercent(view.hpPct)})
        </div>
        <div>
          Breath: {view.breathCapacityLeft.toFixed(1)} / {formatRoundedNumber(view.breathCapacityMax)} ({formatRoundedPercent(view.breathCapacityPct)})
        </div>
        <div>Next bite at: {formatRoundedSeconds(view.nextHitAt)}</div>
        <div>
          Next breath at: {view.nextBreathAt == null ? "-" : formatRoundedSeconds(view.nextBreathAt)}
        </div>
        {view.deathTime != null ? <div className="muted">Dead at {formatRoundedSeconds(view.deathTime)}</div> : null}
      </div>

      <div className="row-actions sandbox-action-row">
        <button className="secondary" type="button" onClick={onNextBiteReady}>
          Next bite ready
        </button>
        <button className="secondary" type="button" onClick={onNextBreathReady}>
          Next breath ready
        </button>
        <button className="secondary" type="button" onClick={onNextAbilityReady}>
          Next ability ready
        </button>
      </div>

      <div className="row-actions sandbox-action-row">
        <button className="primary" type="button" onClick={onManualBite} disabled={!view.biteReady || view.deathTime != null}>
          {view.biteReady ? "Bite" : `Bite (${formatRoundedSeconds(view.biteCooldownLeft)})`}
        </button>
        <button
          className="secondary"
          type="button"
          onClick={onManualBreath}
          disabled={!view.breathReady || view.deathTime != null}
        >
          {view.breathReady
            ? "Breath"
            : `Breath (${view.breathCooldownLeft == null ? "-" : formatRoundedSeconds(view.breathCooldownLeft)})`}
        </button>
      </div>

      <div className="field">
        <label>Manual abilities</label>
        <div className="sandbox-ability-buttons">
          {view.abilities.length === 0 ? (
            <div className="muted">No manual ability hooks exposed for this creature.</div>
          ) : null}
          {view.abilities.map((ability: SandboxAbilityView) => {
            const disabled = view.deathTime != null || !ability.ready;
            const label = ability.ready
              ? ability.actionLabel
              : `${ability.actionLabel} (${formatRoundedSeconds(ability.cooldownLeft)})`;
            return (
              <button
                key={ability.name}
                className={ability.ready ? "secondary" : "secondary sandbox-cooldown"}
                type="button"
                onClick={() => onManualAbility(ability.name)}
                disabled={disabled}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <label>Statuses</label>
        <div className="sandbox-status-list" aria-live="polite" aria-atomic="false" aria-relevant="additions removals">
          {view.statuses.length === 0 ? <div className="muted">No active statuses.</div> : null}
          {view.statuses.map((status) => (
            <div key={status.id} className="sandbox-status-item">
              <strong>{prettyStatusName(status.id)}</strong>
              <span>Stacks: {formatRoundedNumber(status.stacks)}</span>
              <span>Remain: {formatRoundedSeconds(status.remainingSec)}</span>
              <span>Next tick: {status.nextTickAt == null ? "-" : formatRoundedSeconds(status.nextTickAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SandboxOverridesPanel({
  editor,
  setEditor,
  statusOptions,
  abilityOptions,
  abilityValueSpecs,
  passiveSpecs,
  breathOptions,
  overridesA,
  overridesB,
  onApply,
  onClear,
  onRemove,
}: {
  editor: SandboxOverrideEditorState;
  setEditor: (next: SandboxOverrideEditorState) => void;
  statusOptions: { id: string; name: string }[];
  abilityOptions: string[];
  abilityValueSpecs: Map<string, SandboxAbilityValueKind>;
  passiveSpecs: Map<string, SandboxPassiveKind>;
  breathOptions: string[];
  overridesA: SandboxOverrideEntry[];
  overridesB: SandboxOverrideEntry[];
  onApply: (mode: SandboxOverrideMode) => void;
  onClear: (side: SandboxSide) => void;
  onRemove: (side: SandboxSide, index: number) => void;
}) {
  // Pattern mirrors src/pages/CustomCreaturesPage.tsx::getSelectedAbilityValueOptions:
  // curated dropdown when `getAbilityValueOptions` returns entries
  // (Yolk Bomb / Lich Mark), free-form input otherwise (Aura subtype).
  const selectedValueKind = abilityValueSpecs.get(editor.abilityName) ?? null;
  const selectedStringOptions: AbilityValueOption[] =
    selectedValueKind === "string" ? getAbilityValueOptions(editor.abilityName) : [];
  const selectedPassiveKind: SandboxPassiveKind | null =
    editor.category === "passive" ? passiveSpecs.get(editor.passiveName) ?? null : null;
  return (
    <div className="panel-block">
      <h3>Sandbox Overrides</h3>
      <div className="field">
        <label>Target Side</label>
        <select
          aria-label="Override target side"
          value={editor.side}
          onChange={(event) => setEditor({ ...editor, side: event.target.value as SandboxSide })}
        >
          <option value="A">A</option>
          <option value="B">B</option>
        </select>
      </div>
      <div className="field">
        <label>Override Type</label>
        <select
          aria-label="Override type"
          value={editor.category}
          onChange={(event) =>
            setEditor({ ...editor, category: event.target.value as SandboxOverrideCategory })
          }
        >
          <option value="stat">Stat</option>
          <option value="ability">Ability / Effect</option>
          <option value="passive">Passive</option>
          <option value="breath">Breath</option>
          <option value="resist">Resist</option>
          <option value="offensiveStatus">Offensive Status Attack</option>
          <option value="defensiveStatus">Defensive Status Attack</option>
        </select>
      </div>
      {editor.category === "stat" ? (
        <>
          <div className="field">
            <label>Stat</label>
            <select
              aria-label="Override stat"
              value={editor.statField}
              onChange={(event) => setEditor({ ...editor, statField: event.target.value as SandboxStatField })}
            >
              {STAT_FIELD_OPTIONS.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Value</label>
            <input
              aria-label="Override stat value"
              type="number"
              step={editor.statField === "biteCooldown" ? "0.1" : "1"}
              value={editor.value}
              onChange={(event) => setEditor({ ...editor, value: event.target.value })}
            />
          </div>
        </>
      ) : null}
      {editor.category === "ability" ? (
        <>
          <div className="field">
            <label>Ability</label>
            <select
              aria-label="Override ability"
              value={editor.abilityName}
              onChange={(event) => setEditor({ ...editor, abilityName: event.target.value, value: "" })}
            >
              {abilityOptions.length === 0 ? (
                <option value="">(loading…)</option>
              ) : null}
              {abilityOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          {selectedValueKind === "number" ? (
            <div className="field">
              <label>Value</label>
              <input
                aria-label="Override ability value"
                type="number"
                step="0.01"
                placeholder="0 = disabled"
                value={editor.value}
                onChange={(event) => setEditor({ ...editor, value: event.target.value })}
              />
            </div>
          ) : null}
          {selectedValueKind === "string" && selectedStringOptions.length > 0 ? (
            <div className="field">
              <label>Payload</label>
              <select
                aria-label="Override ability payload"
                value={editor.value}
                onChange={(event) => setEditor({ ...editor, value: event.target.value })}
              >
                <option value="">(none)</option>
                {selectedStringOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {selectedValueKind === "string" && selectedStringOptions.length === 0 ? (
            <div className="field">
              <label>Value</label>
              <input
                aria-label="Override ability value"
                type="text"
                placeholder="e.g. Disease"
                value={editor.value}
                onChange={(event) => setEditor({ ...editor, value: event.target.value })}
              />
            </div>
          ) : null}
        </>
      ) : null}
      {editor.category === "breath" ? (
        <>
          <div className="field">
            <label>Breath</label>
            <select
              aria-label="Override breath profile"
              value={editor.breathName}
              onChange={(event) => setEditor({ ...editor, breathName: event.target.value })}
            >
              <option value="">(clear breath)</option>
              {breathOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="note">
            Replaces the side's breath profile with the wiki-spec one (or
            clears breath when "(clear breath)" is picked). Capacity
            resets to the new profile's max and the next-breath timer
            resets to 0 so the new breath is ready immediately.
          </div>
        </>
      ) : null}
      {editor.category === "passive" ? (
        <>
          <div className="field">
            <label>Passive</label>
            <select
              aria-label="Override passive"
              value={editor.passiveName}
              onChange={(event) =>
                setEditor({ ...editor, passiveName: event.target.value, value: "" })
              }
            >
              {passiveSpecs.size === 0 ? <option value="">(loading…)</option> : null}
              {Array.from(passiveSpecs.keys()).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          {selectedPassiveKind === "number" ? (
            <div className="field">
              <label>Value</label>
              <input
                aria-label="Override passive value"
                type="number"
                step="0.01"
                placeholder="0 = disabled"
                value={editor.value}
                onChange={(event) => setEditor({ ...editor, value: event.target.value })}
              />
            </div>
          ) : null}
          {selectedPassiveKind === "bool" ? (
            <div className="note">
              Spec-standard activation (e.g. Berserk fires &lt; 20 % HP, Quick Recovery
              ramps below 100 %). Press Set to enable; Remove to disable.
            </div>
          ) : null}
        </>
      ) : null}
      {editor.category === "resist" ||
      editor.category === "offensiveStatus" ||
      editor.category === "defensiveStatus" ? (
        <>
          <div className="field">
            <label>Status</label>
            <select
              aria-label="Override status"
              value={editor.statusId}
              onChange={(event) => setEditor({ ...editor, statusId: event.target.value })}
            >
              {statusOptions.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{editor.category === "resist" ? "Fraction (0..1)" : "Stacks"}</label>
            <input
              aria-label={editor.category === "resist" ? "Resist fraction (0..1)" : "Status stacks"}
              type="number"
              step="0.1"
              value={editor.value}
              onChange={(event) => setEditor({ ...editor, value: event.target.value })}
            />
          </div>
        </>
      ) : null}
      <div className="row-actions">
        <button className="secondary" type="button" onClick={() => onApply("set")}>
          Set
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => onApply("add")}
          disabled={editor.category !== "stat"}
          title="Add mode only available for stat overrides"
        >
          Add
        </button>
      </div>
      <div className="note">
        One override form for both sides. Pick side in the selector, then apply `Set` (replace) or `Add`
        (additive for stat overrides). Non-stat overrides always replace.
      </div>
      <div className="field">
        <label>Current Overrides A</label>
        <div className="sandbox-status-list">
          {overridesA.length === 0 ? <div className="muted">No overrides.</div> : null}
          {overridesA.map((entry, index) => (
            <div key={`A-${index}`} className="sandbox-status-item">
              <span>{describeOverride(entry)}</span>
              <button
                type="button"
                className="sandbox-remove-btn"
                title="Remove this override"
                aria-label={`Remove override ${describeOverride(entry)}`}
                onClick={() => onRemove("A", index)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="row-actions">
          <button className="secondary" type="button" onClick={() => onClear("A")}>
            Clear A
          </button>
        </div>
      </div>
      <div className="field">
        <label>Current Overrides B</label>
        <div className="sandbox-status-list">
          {overridesB.length === 0 ? <div className="muted">No overrides.</div> : null}
          {overridesB.map((entry, index) => (
            <div key={`B-${index}`} className="sandbox-status-item">
              <span>{describeOverride(entry)}</span>
              <button
                type="button"
                className="sandbox-remove-btn"
                title="Remove this override"
                aria-label={`Remove override ${describeOverride(entry)}`}
                onClick={() => onRemove("B", index)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="row-actions">
          <button className="secondary" type="button" onClick={() => onClear("B")}>
            Clear B
          </button>
        </div>
      </div>
    </div>
  );
}

function SandboxControlsPanel({
  automationMode,
  setAutomationMode,
  abilityPolicy,
  setAbilityPolicy,
  activesOn,
  setActivesOn,
  breathOn,
  setBreathOn,
  loading,
  onReset,
  onNextEvent,
  view,
  timeStep,
  setTimeStep,
  jumpTarget,
  setJumpTarget,
  onNudge,
  onSeek,
  battleSettingsControl,
}: {
  battleSettingsControl: ReactNode;
  automationMode: "manual" | "semiAuto";
  setAutomationMode: (mode: "manual" | "semiAuto") => void;
  abilityPolicy: AbilityTimingMode;
  setAbilityPolicy: (mode: AbilityTimingMode) => void;
  activesOn: boolean;
  setActivesOn: (on: boolean) => void;
  breathOn: boolean;
  setBreathOn: (on: boolean) => void;
  loading: boolean;
  onReset: () => void;
  onNextEvent: (filter: SandboxEventFilter) => void;
  view: SandboxView | null;
  timeStep: string;
  setTimeStep: (value: string) => void;
  jumpTarget: string;
  setJumpTarget: (value: string) => void;
  onNudge: (delta: number) => void;
  onSeek: (target: number) => void;
}) {
  const canAdvance = view != null && !view.halted;
  return (
    <div className="panel-block">
      <h3>Sandbox Controls</h3>
      <div className="field">
        <label>Battle Settings</label>
        {battleSettingsControl}
        <div className="note">
          Shared with Best Builds / Optimizer: weather, day/night, moon, and
          per-side buffs apply to this sandbox session.
        </div>
      </div>
      <div className="field">
        <label>Sandbox Mode</label>
        <select
          aria-label="Sandbox Mode"
          value={automationMode}
          onChange={(event) => setAutomationMode(event.target.value as "manual" | "semiAuto")}
        >
          <option value="manual">Manual</option>
          <option value="semiAuto">Semi-Auto</option>
        </select>
        <div className="note">
          {automationMode === "manual"
            ? "Time advance only moves passive/timed events. No auto-bites, auto-breath, or auto-cast abilities."
            : "Time advance can use automatic combat actions when the runtime decides they should trigger."}
        </div>
      </div>
      <div className="field">
        <label>Ability Policy</label>
        <select
          aria-label="Ability Policy"
          value={abilityPolicy}
          onChange={(event) => setAbilityPolicy(event.target.value as AbilityTimingMode)}
        >
          <option value="reallyFast">Really fast</option>
          <option value="fast">Fast</option>
          <option value="semiIdeal">Semi-Ideal</option>
          <option value="ideal">Ideal</option>
        </select>
      </div>
      <div className="field">
        <label>Actives</label>
        <select aria-label="Actives" value={activesOn ? "on" : "off"} onChange={(event) => setActivesOn(event.target.value === "on")}>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </div>
      <div className="field">
        <label>Breath</label>
        <select aria-label="Breath" value={breathOn ? "on" : "off"} onChange={(event) => setBreathOn(event.target.value === "on")}>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </div>
      <div className="row-actions">
        <button className="primary" type="button" onClick={onReset} disabled={loading}>
          {loading ? "Resetting..." : "Reset Sandbox"}
        </button>
        <button className="secondary" type="button" onClick={() => onNextEvent("any")} disabled={!canAdvance}>
          Next Any
        </button>
        <button className="secondary" type="button" onClick={() => onNextEvent("damage")} disabled={!canAdvance}>
          Next Damage
        </button>
        <button className="secondary" type="button" onClick={() => onNextEvent("effects")} disabled={!canAdvance}>
          Next Effects
        </button>
        <button className="secondary" type="button" onClick={() => onNextEvent("ability")} disabled={!canAdvance}>
          Next Ability
        </button>
      </div>
      <div className="field">
        <label>Time Step (sec)</label>
        <input aria-label="Time Step (sec)" type="number" step="0.1" min="0.1" value={timeStep} onChange={(event) => setTimeStep(event.target.value)} />
      </div>
      <div className="row-actions">
        <button className="secondary" type="button" onClick={() => onNudge(-(Number(timeStep) || 0))}>
          - Step
        </button>
        <button className="secondary" type="button" onClick={() => onNudge(Number(timeStep) || 0)}>
          + Step
        </button>
        <button className="secondary" type="button" onClick={() => onNudge(-0.1)}>
          -0.1s
        </button>
        <button className="secondary" type="button" onClick={() => onNudge(0.1)}>
          +0.1s
        </button>
        <button className="secondary" type="button" onClick={() => onNudge(-0.5)}>
          -0.5s
        </button>
        <button className="secondary" type="button" onClick={() => onNudge(0.5)}>
          +0.5s
        </button>
        <button className="secondary" type="button" onClick={() => onNudge(-20)}>
          -20s
        </button>
        <button className="secondary" type="button" onClick={() => onNudge(20)}>
          +20s
        </button>
      </div>
      <div className="field">
        <label>Jump To Time (sec)</label>
        <input
          aria-label="Jump To Time (sec)"
          type="number"
          step="0.1"
          min="0"
          value={jumpTarget}
          onChange={(event) => setJumpTarget(event.target.value)}
        />
      </div>
      <div className="row-actions">
        <button className="secondary" type="button" onClick={() => onSeek(Number(jumpTarget) || 0)}>
          Seek
        </button>
        <button className="secondary" type="button" onClick={() => onSeek(0)}>
          Back To 0
        </button>
      </div>
      <div className="note">
        This sandbox uses the standard combat runtime and advances to the nearest modeled event. Manual mode
        keeps combat actions fully user-driven; semi-auto lets the runtime act on its own while you can still
        intervene manually.
      </div>
      {view ? <div className="note">Current time: {formatRoundedSeconds(view.time)}</div> : null}
    </div>
  );
}

export default function SandboxPage({
  nameA,
  nameB,
  buildA,
  buildB,
  creatureA,
  creatureB,
  creatureNames,
  getCreatureIcon,
  onNameAChange,
  onNameBChange,
  onBuildAChange,
  onBuildBChange,
}: SandboxPageProps) {
  const { settings: battleSettings } = useBestBuildsBattleSettings();
  const [automationMode, setAutomationMode] = useState<"manual" | "semiAuto">("manual");
  const [abilityPolicy, setAbilityPolicy] = useState<AbilityTimingMode>("ideal");
  const [activesOn, setActivesOn] = useState(true);
  const [breathOn, setBreathOn] = useState(true);
  const [timeStep, setTimeStep] = useState("0.5");
  const [jumpTarget, setJumpTarget] = useState("0");
  const [startHpA, setStartHpA] = useState(0);
  const [startHpB, setStartHpB] = useState(0);
  const [overrideEditor, setOverrideEditor] = useState<SandboxOverrideEditorState>(DEFAULT_OVERRIDE_EDITOR);
  const [abilityOptions, setAbilityOptions] = useState<string[]>(ABILITY_OPTIONS_FALLBACK);
  const [abilityValueSpecs, setAbilityValueSpecs] = useState<Map<string, SandboxAbilityValueKind>>(
    () => new Map<string, SandboxAbilityValueKind>(),
  );
  const [passiveSpecs, setPassiveSpecs] = useState<Map<string, SandboxPassiveKind>>(
    () => new Map<string, SandboxPassiveKind>(),
  );
  useEffect(() => {
    let cancelled = false;
    void import("../engine/sandboxBridge").then(
      ({
        sandboxListOverridableAbilities,
        sandboxListOverridableAbilityValues,
        sandboxListOverridablePassives,
      }) => {
        void sandboxListOverridableAbilities().then((names) => {
          if (cancelled || names.length === 0) return;
          setAbilityOptions(names);
          // Backfill the editor's default ability if it was left empty
          // because the WASM list hadn't resolved yet.
          setOverrideEditor((prev) =>
            prev.abilityName ? prev : { ...prev, abilityName: names[0] },
          );
        });
        void sandboxListOverridableAbilityValues().then((specs: SandboxAbilityValueSpec[]) => {
          if (cancelled) return;
          setAbilityValueSpecs(new Map(specs.map((s) => [s.name, s.kind])));
        });
        void sandboxListOverridablePassives().then((specs: SandboxPassiveSpec[]) => {
          if (cancelled || specs.length === 0) return;
          setPassiveSpecs(new Map(specs.map((s) => [s.name, s.kind])));
          setOverrideEditor((prev) =>
            prev.passiveName ? prev : { ...prev, passiveName: specs[0].name },
          );
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const [overridesA, setOverridesA] = useState<SandboxOverrideEntry[]>([]);
  const [overridesB, setOverridesB] = useState<SandboxOverrideEntry[]>([]);
  // UI-side log of explicit user actions ("A manual bite" / "A apply Poison").
  // Engine combat events come from view.log; we render local actions on top
  // so the most recent user-driven event is always at the top of the log.
  const [actionLog, setActionLog] = useState<SandboxLogEntryView[]>([]);

  const prependAction = (entry: SandboxLogEntryView) => {
    setActionLog((prev) => [entry, ...prev].slice(0, 80));
  };
  const clearActionLog = () => setActionLog([]);

  const sandbox = useSandboxSimulation({
    creatureA,
    creatureB,
    buildA,
    buildB,
    abilityPolicy,
    activesOn,
    breathOn,
    automationMode,
    battleSettings,
  });

  const statusOptions = useMemo(statusOptionsList, []);

  // Sync Start HP fields with view max HP whenever the sandbox rebuilds.
  // Mirrors the old TS Sandbox's `useEffect` on `[creatureA, creatureB,
  // buildA, buildB, ...]` which reset `startHpA/B` to the new creature's
  // max HP on every config change. Without this, picking a 500-HP creature
  // after a 1000-HP one leaves `startHpA = 1000` (out-of-range, "Apply HP
  // Now" silently clamps to 500). Tied to the creature name + the view's
  // current max HP so the reset fires only when the underlying creature
  // changes, not on every render.
  const viewMaxA = sandbox.view?.sideA.maxHp;
  const viewMaxB = sandbox.view?.sideB.maxHp;
  const creatureKeyA = creatureA?.name;
  const creatureKeyB = creatureB?.name;
  useEffect(() => {
    if (viewMaxA != null) setStartHpA(Math.round(viewMaxA));
     
  }, [creatureKeyA, viewMaxA]);
  useEffect(() => {
    if (viewMaxB != null) setStartHpB(Math.round(viewMaxB));

  }, [creatureKeyB, viewMaxB]);

  // Share-Match snapshot provider. A ref mirrors shareable setup each
  // render so the provider (registered once) reads current values. A
  // separate pending ref holds imported overrides + start HP until the
  // session rebuilds under the shared creatures (see effect below).
  const shareSnapshotRef = useRef<SandboxPageSnapshotState | null>(null);
  shareSnapshotRef.current = {
    nameA,
    nameB,
    buildA,
    buildB,
    automationMode,
    abilityPolicy,
    activesOn,
    breathOn,
    startHpA,
    startHpB,
    overridesA,
    overridesB,
  };
  const pendingImportedOverridesRef = useRef<{
    nameA: string;
    nameB: string;
    startHpA: number;
    startHpB: number;
    overridesA: SandboxOverrideEntry[];
    overridesB: SandboxOverrideEntry[];
  } | null>(null);
  useEffect(() => {
    return registerMatchSnapshotProvider({
      page: "sandbox",
      getSnapshot: () => {
        const s = shareSnapshotRef.current!;
        return {
          pageState: { ...s } as unknown as Record<string, unknown>,
          participantCreatureNames: [s.nameA, s.nameB].filter((n): n is string => Boolean(n)),
        };
      },
      applySnapshot: (pageState) => {
        const s = pageState as Partial<SandboxPageSnapshotState>;
        if (typeof s.nameA === "string") onNameAChange(s.nameA);
        if (typeof s.nameB === "string") onNameBChange(s.nameB);
        if (s.buildA) onBuildAChange(s.buildA);
        if (s.buildB) onBuildBChange(s.buildB);
        if (s.automationMode !== undefined) setAutomationMode(s.automationMode);
        if (s.abilityPolicy !== undefined) setAbilityPolicy(s.abilityPolicy);
        if (s.activesOn !== undefined) setActivesOn(s.activesOn);
        if (s.breathOn !== undefined) setBreathOn(s.breathOn);
        if (s.overridesA !== undefined) setOverridesA(s.overridesA);
        if (s.overridesB !== undefined) setOverridesB(s.overridesB);
        // Overrides + start HP touch the live session, which rebuilds
        // asynchronously when the creatures change. Stash them; the
        // effect below applies them once the session is ready under the
        // shared creatures.
        pendingImportedOverridesRef.current = {
          nameA: typeof s.nameA === "string" ? s.nameA : "",
          nameB: typeof s.nameB === "string" ? s.nameB : "",
          startHpA: typeof s.startHpA === "number" ? s.startHpA : 0,
          startHpB: typeof s.startHpB === "number" ? s.startHpB : 0,
          overridesA: s.overridesA ?? [],
          overridesB: s.overridesB ?? [],
        };
      },
    });
  }, [onNameAChange, onNameBChange, onBuildAChange, onBuildBChange]);

  // Apply imported overrides + start HP once the session has rebuilt
  // under the shared creatures (names match + ready). Clearing first
  // mirrors the stat-remove re-apply contract.
  useEffect(() => {
    const pending = pendingImportedOverridesRef.current;
    if (!pending || !sandbox.ready) return;
    if (creatureKeyA !== pending.nameA || creatureKeyB !== pending.nameB) return;
    pendingImportedOverridesRef.current = null;
    void (async () => {
      await sandbox.clearOverrides("A");
      for (const entry of pending.overridesA) await applyOverrideEntryToSession("A", entry);
      await sandbox.clearOverrides("B");
      for (const entry of pending.overridesB) await applyOverrideEntryToSession("B", entry);
      if (pending.startHpA > 0) {
        setStartHpA(pending.startHpA);
        await sandbox.applyHp("A", pending.startHpA);
      }
      if (pending.startHpB > 0) {
        setStartHpB(pending.startHpB);
        await sandbox.applyHp("B", pending.startHpB);
      }
    })();

  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot apply gated by pendingImportedOverridesRef; sandbox/applyOverrideEntryToSession deliberately excluded (sandbox identity changes every render)
  }, [sandbox.ready, creatureKeyA, creatureKeyB]);

  const nudge = (delta: number) => {
    const view = sandbox.view;
    if (!view) return;
    void sandbox.stepToTime(Math.max(0, view.time + delta));
  };

  const seek = (target: number) => {
    // Back To 0 + Seek: rewind via action-log replay (Rust handles backward
    // jumps in step_to_time → rewind_to). Old TS Sandbox's
    // `seekSandboxToTime` had the same shape — seeking to t = 0 rebuilds
    // from the baseline snapshot + replays every recorded action whose
    // time <= 0, which preserves seeded statuses / overrides / forced
    // actions placed at t = 0. Use the explicit "Reset Sandbox" button to
    // wipe the action log.
    void sandbox.stepToTime(Math.max(0, target));
  };

  // Canonical breath / beam ability list used by the Breath override
  // category. Sourced from the production breath catalog so adding a
  // new entry to `breath_specs.runtime.json` auto-surfaces it in the
  // dropdown.
  const breathOptionList = useMemo(() => listAvailableBreathNames(), []);

  // Union of bool-flag abilities and value-bearing abilities (number /
  // string). UI renders one dropdown; the value spec map decides
  // whether to render the value input next to the picker.
  const mergedAbilityOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of abilityOptions) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
    for (const name of abilityValueSpecs.keys()) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
    return out;
  }, [abilityOptions, abilityValueSpecs]);

  const overridesFor = (side: SandboxSide): SandboxOverrideEntry[] =>
    side === "A" ? overridesA : overridesB;
  const setOverridesFor = (side: SandboxSide, next: SandboxOverrideEntry[]) => {
    if (side === "A") setOverridesA(next);
    else setOverridesB(next);
  };

  const logAction = (side: SandboxSide, description: string) => {
    prependAction({
      time: sandbox.view?.time ?? 0,
      side,
      eventType: "manualAction",
      description,
    });
  };

  const onApplyHp = (side: SandboxSide, hp: number) => {
    void sandbox.applyHp(side, hp);
    logAction(side, `${side} set HP to ${hp.toFixed(1)}`);
  };
  const onApplyStatus = (side: SandboxSide, statusId: string, stacks: number) => {
    void sandbox.applyStatus(side, statusId, stacks);
    logAction(side, `${side} apply ${prettyStatusName(statusId)} x${stacks}`);
  };
  const onManualBite = (side: SandboxSide) => {
    void sandbox.forceBite(side);
    logAction(side, `${side} manual bite`);
  };
  const onManualBreath = (side: SandboxSide) => {
    void sandbox.forceBreath(side);
    logAction(side, `${side} manual breath`);
  };
  const onManualAbility = async (side: SandboxSide, name: string) => {
    const recognised = await sandbox.forceAbility(side, name);
    logAction(side, recognised ? `${side} manual ${name}` : `${side} ${name} on cooldown`);
  };
  const onResetWithClear = async () => {
    clearActionLog();
    await sandbox.reset();
  };

  async function applyOverride(mode: SandboxOverrideMode) {
    const editor = overrideEditor;
    const side = editor.side;
    const numericValue = Number(editor.value);
    const validNumeric = Number.isFinite(numericValue);
    const prev = overridesFor(side);
    let entry: SandboxOverrideEntry | null = null;
    switch (editor.category) {
      case "stat": {
        if (!validNumeric) return;
        const engineField =
          STAT_FIELD_OPTIONS.find((f) => f.id === editor.statField)?.engineKey ?? "damage";
        const finalValue =
          mode === "add"
            ? (() => {
                const baseEntry = prev.find(
                  (e) => e.kind === "stat" && e.field === editor.statField,
                ) as { kind: "stat"; field: SandboxStatField; value: number; mode: SandboxOverrideMode } | undefined;
                return (baseEntry?.value ?? 0) + numericValue;
              })()
            : numericValue;
        await sandbox.overrideStat(side, engineField, finalValue);
        // Stat-override is special: "health" is applied as a direct HP set on
        // the current side, while the rest go through modifier.* extras. We
        // mirror the editor field choice (UX matches the old TS Sandbox).
        if (editor.statField === "health") {
          await sandbox.applyHp(side, finalValue);
        }
        entry = { kind: "stat", field: editor.statField, value: finalValue, mode };
        break;
      }
      case "breath": {
        // Empty `breathName` clears the side's breath. Otherwise build
        // the profile from the wiki-spec catalog (same conversion the
        // Compare path uses).
        const name = editor.breathName.trim();
        const profile = name ? buildBreathProfileByName(name) : null;
        await sandbox.overrideBreath(side, profile);
        entry = { kind: "breath", breathName: name || null };
        break;
      }
      case "passive": {
        if (!editor.passiveName) return;
        const kind = passiveSpecs.get(editor.passiveName) ?? null;
        if (kind === "bool") {
          const recognised = await sandbox.overridePassiveBool(side, editor.passiveName, true);
          if (!recognised) return;
          entry = { kind: "passiveBool", passiveName: editor.passiveName, enabled: true };
        } else if (kind === "number") {
          const value = validNumeric ? numericValue : 0;
          const recognised = await sandbox.overridePassiveNumber(side, editor.passiveName, value);
          if (!recognised) return;
          entry = { kind: "passiveNumber", passiveName: editor.passiveName, value };
        }
        break;
      }
      case "ability": {
        if (!editor.abilityName) return;
        // Per-ability dispatch: value-bearing abilities (Cursed Sigil,
        // Life Leech, Trail family, Aura, Yolk Bomb payload, ...) go
        // through dedicated number / string bridge endpoints so the
        // Sandbox UI writes through to the right config field. Bool-
        // only abilities (Fortify, Adrenaline, ...) keep the existing
        // toggle path.
        const valueKind = abilityValueSpecs.get(editor.abilityName) ?? null;
        if (valueKind === "number") {
          const recognised = await sandbox.overrideAbilityNumber(
            side,
            editor.abilityName,
            validNumeric ? numericValue : 0,
          );
          if (!recognised) return;
          entry = {
            kind: "abilityNumber",
            abilityName: editor.abilityName,
            value: validNumeric ? numericValue : 0,
          };
        } else if (valueKind === "string") {
          const trimmed = editor.value.trim();
          const payload = trimmed.length > 0 ? trimmed : null;
          const recognised = await sandbox.overrideAbilityString(side, editor.abilityName, payload);
          if (!recognised) return;
          entry = { kind: "abilityString", abilityName: editor.abilityName, value: payload };
        } else {
          // Bool-only ability. Enabling = inject ability. Set mode replaces
          // existing toggle; Add mode same effect (no degree to "add").
          await sandbox.overrideAbility(side, editor.abilityName, true);
          entry = { kind: "ability", abilityName: editor.abilityName, enabled: true };
        }
        break;
      }
      case "resist": {
        if (!validNumeric) return;
        await sandbox.overrideResist(side, editor.statusId, numericValue);
        entry = { kind: "resist", statusId: editor.statusId, fraction: numericValue };
        break;
      }
      case "offensiveStatus": {
        if (!validNumeric) return;
        await sandbox.overrideOffensiveStatus(side, editor.statusId, numericValue);
        entry = { kind: "offensiveStatus", statusId: editor.statusId, stacks: numericValue };
        break;
      }
      case "defensiveStatus": {
        if (!validNumeric) return;
        await sandbox.overrideDefensiveStatus(side, editor.statusId, numericValue);
        entry = { kind: "defensiveStatus", statusId: editor.statusId, stacks: numericValue };
        break;
      }
    }
    if (entry) {
      setOverridesFor(side, [...prev, entry]);
    }
  }

  async function clearOverridesForSide(side: SandboxSide) {
    await sandbox.clearOverrides(side);
    setOverridesFor(side, []);
  }

  // Apply a single override entry to the live session. Shared by the
  // stat-remove re-apply path and the imported-match restore so both
  // map entry kinds to engine calls identically.
  async function applyOverrideEntryToSession(side: SandboxSide, entry: SandboxOverrideEntry) {
    switch (entry.kind) {
      case "stat": {
        const engineField = STAT_FIELD_OPTIONS.find((f) => f.id === entry.field)?.engineKey ?? "damage";
        await sandbox.overrideStat(side, engineField, entry.value);
        if (entry.field === "health") {
          await sandbox.applyHp(side, entry.value);
        }
        break;
      }
      case "ability":
        await sandbox.overrideAbility(side, entry.abilityName, entry.enabled);
        break;
      case "abilityNumber":
        await sandbox.overrideAbilityNumber(side, entry.abilityName, entry.value);
        break;
      case "abilityString":
        await sandbox.overrideAbilityString(side, entry.abilityName, entry.value);
        break;
      case "passiveBool":
        await sandbox.overridePassiveBool(side, entry.passiveName, entry.enabled);
        break;
      case "passiveNumber":
        await sandbox.overridePassiveNumber(side, entry.passiveName, entry.value);
        break;
      case "breath": {
        const profile = entry.breathName ? buildBreathProfileByName(entry.breathName) : null;
        await sandbox.overrideBreath(side, profile);
        break;
      }
      case "resist":
        await sandbox.overrideResist(side, entry.statusId, entry.fraction);
        break;
      case "offensiveStatus":
        await sandbox.overrideOffensiveStatus(side, entry.statusId, entry.stacks);
        break;
      case "defensiveStatus":
        await sandbox.overrideDefensiveStatus(side, entry.statusId, entry.stacks);
        break;
    }
  }

  // Per-entry remove. For non-stat overrides the engine APIs already
  // support "remove" semantics — pass `false` for abilities, `0` for
  // resist / offensive / defensive (the Rust side treats those as
  // deletion). For stat overrides we have to re-clear ALL overrides
  // on the side and re-apply the survivors via their stored values
  // because individual stat overrides are stamped as modifier.* extras
  // and clear_overrides() is the only path that yanks them.
  async function removeOverrideAt(side: SandboxSide, index: number) {
    const prev = overridesFor(side);
    const target = prev[index];
    if (!target) return;
    const survivors = [...prev.slice(0, index), ...prev.slice(index + 1)];
    switch (target.kind) {
      case "ability":
        await sandbox.overrideAbility(side, target.abilityName, false);
        break;
      case "abilityNumber":
        // 0 disables — engine gates each value ability on `> 0`.
        await sandbox.overrideAbilityNumber(side, target.abilityName, 0);
        break;
      case "abilityString":
        // null clears — engine gates string-valued abilities on `Some(_)`.
        await sandbox.overrideAbilityString(side, target.abilityName, null);
        break;
      case "passiveBool":
        await sandbox.overridePassiveBool(side, target.passiveName, false);
        break;
      case "passiveNumber":
        // 0 disables — engine gates each number-valued passive on `> 0`.
        await sandbox.overridePassiveNumber(side, target.passiveName, 0);
        break;
      case "breath":
        // Null profile clears the side's breath.
        await sandbox.overrideBreath(side, null);
        break;
      case "resist":
        await sandbox.overrideResist(side, target.statusId, 0);
        break;
      case "offensiveStatus":
        await sandbox.overrideOffensiveStatus(side, target.statusId, 0);
        break;
      case "defensiveStatus":
        await sandbox.overrideDefensiveStatus(side, target.statusId, 0);
        break;
      case "stat": {
        // Stat overrides are modifier.* extras — the engine has no
        // per-stat remove path. Clear all overrides on the side and
        // re-apply each survivor (preserves order + values).
        await sandbox.clearOverrides(side);
        for (const surv of survivors) {
          await applyOverrideEntryToSession(side, surv);
        }
        break;
      }
    }
    setOverridesFor(side, survivors);
  }

  const onNextEvent = (filter: SandboxEventFilter) => void sandbox.stepUntilEvent(filter);
  const onNextReady = (side: SandboxSide, kind: SandboxReadyKind) =>
    void sandbox.stepUntilReady(side, kind);

  return (
    <section className="panel">
      <div className="layout-grid">
        <div className="panel-grid">
          <CreatureSelectorCard
            label="Creature A"
            name={nameA}
            creatureNames={creatureNames}
            getIcon={getCreatureIcon}
            onNameChange={onNameAChange}
            build={buildA}
            onBuildChange={onBuildAChange}
          />
          <CreatureSelectorCard
            label="Creature B"
            name={nameB}
            creatureNames={creatureNames}
            getIcon={getCreatureIcon}
            onNameChange={onNameBChange}
            build={buildB}
            onBuildChange={onBuildBChange}
          />

          <SandboxControlsPanel
            battleSettingsControl={
              <BestBuildsBattleSettingsPanel
                sourceName={nameA}
                opponentNames={nameB ? [nameB] : []}
              />
            }
            automationMode={automationMode}
            setAutomationMode={setAutomationMode}
            abilityPolicy={abilityPolicy}
            setAbilityPolicy={setAbilityPolicy}
            activesOn={activesOn}
            setActivesOn={setActivesOn}
            breathOn={breathOn}
            setBreathOn={setBreathOn}
            loading={sandbox.loading}
            onReset={() => void onResetWithClear()}
            onNextEvent={onNextEvent}
            view={sandbox.view}
            timeStep={timeStep}
            setTimeStep={setTimeStep}
            jumpTarget={jumpTarget}
            setJumpTarget={setJumpTarget}
            onNudge={nudge}
            onSeek={seek}
          />

          <SandboxOverridesPanel
            editor={overrideEditor}
            setEditor={setOverrideEditor}
            statusOptions={statusOptions}
            abilityOptions={mergedAbilityOptions}
            abilityValueSpecs={abilityValueSpecs}
            passiveSpecs={passiveSpecs}
            breathOptions={breathOptionList}
            overridesA={overridesA}
            overridesB={overridesB}
            onApply={(mode) => void applyOverride(mode)}
            onClear={(side) => void clearOverridesForSide(side)}
            onRemove={(side, index) => void removeOverrideAt(side, index)}
          />

          <SideSetupCard
            label="Start Setup A"
            startHp={startHpA}
            statusOptions={statusOptions}
            onStartHpChange={setStartHpA}
            onApplyHpNow={(hp) => onApplyHp("A", hp)}
            onApplyStatusNow={(statusId, stacks) => onApplyStatus("A", statusId, stacks)}
          />
          <SideSetupCard
            label="Start Setup B"
            startHp={startHpB}
            statusOptions={statusOptions}
            onStartHpChange={setStartHpB}
            onApplyHpNow={(hp) => onApplyHp("B", hp)}
            onApplyStatusNow={(statusId, stacks) => onApplyStatus("B", statusId, stacks)}
          />
        </div>
      </div>

      <div className="results-grid">
        {sandbox.bridgeUnavailable ? (
          <div className="panel-block">
            <div className="note">
              Sandbox bindings missing from the loaded WASM bundle. Run <code>npm run rust:build</code> and reload.
            </div>
          </div>
        ) : null}
        {sandbox.error ? (
          <div className="panel-block">
            <div className="note">{sandbox.error}</div>
          </div>
        ) : null}
        {sandbox.view ? (
          <>
            <SideStateCard
              label="Side A State"
              side="A"
              creatureName={nameA}
              view={sandbox.view.sideA}
              onNextBiteReady={() => onNextReady("A", "bite")}
              onNextBreathReady={() => onNextReady("A", "breath")}
              onNextAbilityReady={() => onNextReady("A", "ability")}
              onManualBite={() => onManualBite("A")}
              onManualBreath={() => onManualBreath("A")}
              onManualAbility={(name) => void onManualAbility("A", name)}
            />
            <SideStateCard
              label="Side B State"
              side="B"
              creatureName={nameB}
              view={sandbox.view.sideB}
              onNextBiteReady={() => onNextReady("B", "bite")}
              onNextBreathReady={() => onNextReady("B", "breath")}
              onNextAbilityReady={() => onNextReady("B", "ability")}
              onManualBite={() => onManualBite("B")}
              onManualBreath={() => onManualBreath("B")}
              onManualAbility={(name) => void onManualAbility("B", name)}
            />
            <div className="panel-block">
              <h3>Event Log</h3>
              {/* Live log: announce only when new entries land (additions),
               * not on every reflow. The list is virtually long, so
               * `aria-atomic="false"` keeps the announcement scoped to the
               * newly-inserted item. */}
              <div className="sandbox-log" role="log" aria-live="polite" aria-atomic="false" aria-relevant="additions">
                {actionLog.map((entry, index) => (
                  <div key={`a-${index}`} className="sandbox-log-item">
                    <strong>{entry.description}</strong>
                    <div className="note">{formatRoundedSeconds(entry.time)}</div>
                  </div>
                ))}
                {[...sandbox.view.log]
                  .reverse()
                  .slice(0, 60)
                  .map((entry, index) => (
                    <div key={`${entry.time}-${index}`} className="sandbox-log-item">
                      <strong>{logEntryTitle(entry.eventType)}</strong>
                      <div className="note">
                        {formatRoundedSeconds(entry.time)} — Side {entry.side || "—"}
                      </div>
                      {entry.description ? (
                        <ul className="stat-list">
                          <li>{entry.description}</li>
                        </ul>
                      ) : null}
                    </div>
                  ))}
                <div className="sandbox-log-item">
                  <strong>Sandbox initialized</strong>
                  <div className="note">0s</div>
                  <ul className="stat-list">
                    <li>
                      A {nameA || "—"} starts at {formatRoundedNumber(sandbox.view.sideA.maxHp)} /{" "}
                      {formatRoundedNumber(sandbox.view.sideA.maxHp)}
                    </li>
                    <li>
                      B {nameB || "—"} starts at {formatRoundedNumber(sandbox.view.sideB.maxHp)} /{" "}
                      {formatRoundedNumber(sandbox.view.sideB.maxHp)}
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="panel-block muted">
            {sandbox.loading ? "Loading sandbox..." : "Select both creatures to initialize the sandbox."}
          </div>
        )}
      </div>
    </section>
  );
}
