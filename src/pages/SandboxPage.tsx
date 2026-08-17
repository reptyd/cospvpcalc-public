import { useState, type ReactNode } from "react";
import type { AbilityTimingMode, BuildOptions, CreatureRuntime } from "../engine";
import { CreatureSelectorCard } from "../components/compare/CreatureSelectorCard";
import {
  formatBreathCapacity,
  formatRoundedNumber,
  formatRoundedPercent,
  formatRoundedSeconds,
} from "../shared/displayFormat";
import { BestBuildsBattleSettingsPanel } from "../components/bestBuilds/BestBuildsBattleSettings";
import type {
  SandboxAbilityValueKind,
  SandboxAbilityView,
  SandboxBiteVariant,
  SandboxEventFilter,
  SandboxPassiveKind,
  SandboxMeter,
  SandboxPosture,
  SandboxSide,
  SandboxSideView,
  SandboxView,
} from "../engine/sandboxBridge";
import { getAbilityValueOptions, type AbilityValueOption } from "../engine/abilityValueOptions";
import {
  DEFAULT_SEED_STATUS_ID,
  POSTURE_LABEL,
  STAT_FIELD_OPTIONS,
  describeOverride,
  logEntryTitle,
  prettyStatusName,
  useSandboxPageController,
  type SandboxOverrideCategory,
  type SandboxOverrideEditorState,
  type SandboxOverrideEntry,
  type SandboxOverrideMode,
  type SandboxStatField,
} from "./useSandboxPageController";

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

export function SideSetupCard({
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
  onForcePosture,
  onApplyMeter,
}: {
  label: string;
  side: SandboxSide;
  creatureName: string;
  view: SandboxSideView;
  onNextBiteReady: () => void;
  onNextBreathReady: () => void;
  onNextAbilityReady: () => void;
  onManualBite: (variant: SandboxBiteVariant) => void;
  onManualBreath: () => void;
  onManualAbility: (abilityName: string) => void;
  onForcePosture: (target: SandboxPosture) => void;
  onApplyMeter: (meter: SandboxMeter, value: number) => void;
}) {
  const [biteVariant, setBiteVariant] = useState<SandboxBiteVariant>("primary");
  const settledNonStanding = !view.postureTransitioning && view.postureCurrent !== "standing";
  const biteBase = view.hasSecondary && biteVariant === "secondary" ? "Bite · Secondary" : "Bite";
  return (
    <div className="panel-block">
      <h3>{label}</h3>
      <div className="sandbox-summary" aria-live="polite" aria-atomic="true">
        <div>
          <strong>{creatureName || `Side ${side}`}</strong>
        </div>
        <div>
          HP: {view.hp.toFixed(1)} / {formatRoundedNumber(view.maxHp)} ({formatRoundedPercent(view.hpPct)})
        </div>
        <div>
          Breath: {formatBreathCapacity(view.breathCapacityLeft, view.breathCapacityMax)} / {formatRoundedNumber(view.breathCapacityMax)} ({formatRoundedPercent(view.breathCapacityPct)})
        </div>
        <div>Next bite at: {formatRoundedSeconds(view.nextHitAt)}</div>
        <div>
          Next breath at: {view.nextBreathAt == null ? "-" : formatRoundedSeconds(view.nextBreathAt)}
        </div>
        {view.hunger != null ? <MeterLine label="Hunger" value={view.hunger} base={view.appetiteBase} /> : null}
        {view.thirst != null ? <MeterLine label="Thirst" value={view.thirst} base={view.appetiteBase} /> : null}
        {view.deathTime != null ? <div className="muted">Dead at {formatRoundedSeconds(view.deathTime)}</div> : null}
      </div>

      {view.hunger != null || view.thirst != null ? (
        <div className="field sandbox-meters">
          <label>Meters</label>
          {view.hunger != null ? (
            <MeterControl
              label="Hunger"
              value={view.hunger}
              base={view.appetiteBase}
              onChange={(next) => onApplyMeter("hunger", next)}
            />
          ) : null}
          {view.thirst != null ? (
            <MeterControl
              label="Thirst"
              value={view.thirst}
              base={view.appetiteBase}
              onChange={(next) => onApplyMeter("thirst", next)}
            />
          ) : null}
          <span className="note">
            Every 36 seconds after a bar reaches zero the creature gains another stack. Each stack
            deals 0.5% max health in damage every 3 seconds, and health regeneration stops
            entirely. Set a bar to 0 to start already starving.
          </span>
        </div>
      ) : null}

      <div className="field sandbox-posture">
        <label>Posture</label>
        <div className="sandbox-posture-control" role="group" aria-label={`Posture (Side ${side})`}>
          {(["standing", "sitting", "laying"] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={view.postureCurrent === p ? "active" : ""}
              aria-pressed={view.postureCurrent === p}
              onClick={() => onForcePosture(p)}
              disabled={view.deathTime != null}
            >
              {POSTURE_LABEL[p]}
            </button>
          ))}
        </div>
        {view.postureTransitioning ? (
          <div className="sandbox-posture-transition" aria-live="polite">
            {POSTURE_LABEL[view.posturePending]} in progress
            {view.postureTransitionRemaining == null
              ? ""
              : ` - ${formatRoundedSeconds(view.postureTransitionRemaining)} left`}
          </div>
        ) : view.postureCurrent !== "standing" ? (
          <div className="sandbox-posture-mults muted">
            Regen &times;{view.postureRegenMult} &middot; Decay &times;{view.postureDecayMult} &middot;
            Incoming dmg &times;{view.postureIncomingDamageMult}
          </div>
        ) : null}
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
        <button
          className="primary"
          type="button"
          onClick={() => onManualBite(view.hasSecondary ? biteVariant : "primary")}
          disabled={!view.biteReady || view.deathTime != null || settledNonStanding}
          title={settledNonStanding ? "Stand up to bite - a sitting / laying creature can't attack" : undefined}
        >
          {view.biteReady ? biteBase : `${biteBase} (${formatRoundedSeconds(view.biteCooldownLeft)})`}
        </button>
        {view.hasSecondary ? (
          <div className="sandbox-bite-variant" role="group" aria-label={`Bite attack (Side ${side})`}>
            <button
              type="button"
              className={biteVariant === "primary" ? "active" : ""}
              aria-pressed={biteVariant === "primary"}
              onClick={() => setBiteVariant("primary")}
            >
              Primary
            </button>
            <button
              type="button"
              className={biteVariant === "secondary" ? "active" : ""}
              aria-pressed={biteVariant === "secondary"}
              onClick={() => setBiteVariant("secondary")}
            >
              Secondary
            </button>
          </div>
        ) : null}
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

export function SandboxOverridesPanel({
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
          <option value="extreme">Extreme</option>
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

export default function SandboxPage(props: SandboxPageProps) {
  const {
    nameA,
    nameB,
    buildA,
    buildB,
    creatureNames,
    getCreatureIcon,
    onNameAChange,
    onNameBChange,
    onBuildAChange,
    onBuildBChange,
  } = props;
  const c = useSandboxPageController(props);
  const sandbox = c.sandbox;

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
              <BestBuildsBattleSettingsPanel sourceName={nameA} opponentNames={nameB ? [nameB] : []} allowIdealBreath />
            }
            automationMode={c.automationMode}
            setAutomationMode={c.setAutomationMode}
            abilityPolicy={c.abilityPolicy}
            setAbilityPolicy={c.setAbilityPolicy}
            activesOn={c.activesOn}
            setActivesOn={c.setActivesOn}
            breathOn={c.breathOn}
            setBreathOn={c.setBreathOn}
            loading={sandbox.loading}
            onReset={() => void c.onResetWithClear()}
            onNextEvent={c.onNextEvent}
            view={sandbox.view}
            timeStep={c.timeStep}
            setTimeStep={c.setTimeStep}
            jumpTarget={c.jumpTarget}
            setJumpTarget={c.setJumpTarget}
            onNudge={c.nudge}
            onSeek={c.seek}
          />

          <SandboxOverridesPanel
            editor={c.overrideEditor}
            setEditor={c.setOverrideEditor}
            statusOptions={c.statusOptions}
            abilityOptions={c.mergedAbilityOptions}
            abilityValueSpecs={c.abilityValueSpecs}
            passiveSpecs={c.passiveSpecs}
            breathOptions={c.breathOptionList}
            overridesA={c.overridesA}
            overridesB={c.overridesB}
            onApply={(mode) => void c.applyOverride(mode)}
            onClear={(side) => void c.clearOverridesForSide(side)}
            onRemove={(side, index) => void c.removeOverrideAt(side, index)}
          />

          <SideSetupCard
            label="Start Setup A"
            startHp={c.startHpA}
            statusOptions={c.statusOptions}
            onStartHpChange={c.setStartHpA}
            onApplyHpNow={(hp) => c.onApplyHp("A", hp)}
            onApplyStatusNow={(statusId, stacks) => c.onApplyStatus("A", statusId, stacks)}
          />
          <SideSetupCard
            label="Start Setup B"
            startHp={c.startHpB}
            statusOptions={c.statusOptions}
            onStartHpChange={c.setStartHpB}
            onApplyHpNow={(hp) => c.onApplyHp("B", hp)}
            onApplyStatusNow={(statusId, stacks) => c.onApplyStatus("B", statusId, stacks)}
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
              onNextBiteReady={() => c.onNextReady("A", "bite")}
              onNextBreathReady={() => c.onNextReady("A", "breath")}
              onNextAbilityReady={() => c.onNextReady("A", "ability")}
              onManualBite={(variant) => c.onManualBite("A", variant)}
              onManualBreath={() => c.onManualBreath("A")}
              onManualAbility={(name) => void c.onManualAbility("A", name)}
              onForcePosture={(target) => c.onForcePosture("A", target)}
              onApplyMeter={(meter, value) => c.onApplyMeter("A", meter, value)}
            />
            <SideStateCard
              label="Side B State"
              side="B"
              creatureName={nameB}
              view={sandbox.view.sideB}
              onNextBiteReady={() => c.onNextReady("B", "bite")}
              onNextBreathReady={() => c.onNextReady("B", "breath")}
              onNextAbilityReady={() => c.onNextReady("B", "ability")}
              onManualBite={(variant) => c.onManualBite("B", variant)}
              onManualBreath={() => c.onManualBreath("B")}
              onManualAbility={(name) => void c.onManualAbility("B", name)}
              onForcePosture={(target) => c.onForcePosture("B", target)}
              onApplyMeter={(meter, value) => c.onApplyMeter("B", meter, value)}
            />
            <div className="panel-block">
              <h3>Event Log</h3>
              <div className="sandbox-log" role="log" aria-live="polite" aria-atomic="false" aria-relevant="additions">
                {c.actionLog.map((entry, index) => (
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
                        {formatRoundedSeconds(entry.time)} - Side {entry.side || "-"}
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
                      A {nameA || "-"} starts at {formatRoundedNumber(sandbox.view.sideA.maxHp)} /{" "}
                      {formatRoundedNumber(sandbox.view.sideA.maxHp)}
                    </li>
                    <li>
                      B {nameB || "-"} starts at {formatRoundedNumber(sandbox.view.sideB.maxHp)} /{" "}
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

/** One meter's current reading, as fill percent plus how much is left. */
function MeterLine({ label, value, base }: { label: string; value: number; base: number }) {
  const pct = base > 0 ? (value / base) * 100 : 0;
  const starving = value <= 0;
  return (
    <div className={starving ? "sandbox-meter-line starving" : "sandbox-meter-line"}>
      {label}: {value.toFixed(1)} / {formatRoundedNumber(base)} ({formatRoundedPercent(pct)})
      {starving ? " - starving" : ""}
    </div>
  );
}

/** Set a meter outright. Zero is the floor, and a bar sitting there starves. */
function MeterControl({
  label,
  value,
  base,
  onChange,
}: {
  label: string;
  value: number;
  base: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string>("");
  const shown = draft === "" ? value.toFixed(1) : draft;
  const commit = () => {
    const parsed = Number(draft);
    if (draft !== "" && Number.isFinite(parsed)) onChange(parsed);
    setDraft("");
  };
  return (
    <div className="sandbox-meter-control">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={`${label} in appetite units`}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      <button type="button" onClick={() => onChange(base)}>
        Full
      </button>
      <button type="button" onClick={() => onChange(0)}>
        Empty
      </button>
    </div>
  );
}
