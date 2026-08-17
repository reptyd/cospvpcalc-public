// Beta "Combat Lab" view of the Sandbox. Dev-gated (iddqd + Settings beta
// toggle), routed in place of the default SandboxPage when the beta design is
// active. Shares useSandboxPageController, so the engine session + override
// machinery are identical - only the presentation differs.
//
// Design: the Sandbox is a HANDS-ON step-through. So unlike Compare's passive
// playback, the hero here is the LIVE, INTERACTIVE battle state - two fighter
// cards you bite / breath / posture / cast from directly - plus a stepper
// transport (advance to next event, nudge time, jump). The heavy config (full
// builds, battle settings, the big override editor, seed HP/status) lives in a
// tabbed Setup overlay, the same "hybrid" split as the other beta pages.

import { memo, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, RotateCcw, Settings2, SlidersHorizontal, X } from "lucide-react";
import type { BuildOptions, CreatureRuntime } from "../engine";
import { IconImg } from "../components/IconImg";
import { CreatureNameInput } from "../components/CreatureNameInput";
import { CreatureSelectorCard } from "../components/compare/CreatureSelectorCard";
import { BestBuildsBattleSettingsPanel } from "../components/bestBuilds/BestBuildsBattleSettings";
import { formatBreathCapacity, formatRoundedNumber, formatRoundedSeconds } from "../shared/displayFormat";
import type {
  SandboxAbilityValueKind,
  SandboxAbilityView,
  SandboxBiteVariant,
  SandboxEventFilter,
  SandboxLogEntryView,
  SandboxMeter,
  SandboxPassiveKind,
  SandboxPosture,
  SandboxSide,
  SandboxSideView,
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
import "./compareBeta.css";
import "./optimizerBeta.css";
import "./sandboxBeta.css";

type SandboxPageBetaProps = {
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

const EVENT_FILTERS: Array<{ id: SandboxEventFilter; label: string }> = [
  { id: "any", label: "Any" },
  { id: "damage", label: "Damage" },
  { id: "effects", label: "Effects" },
  { id: "ability", label: "Ability" },
];

// Interactive fighter card: live HP/breath bars, posture control, and the
// manual action surface (bite / breath / abilities / next-ready). The Sandbox
// is hands-on, so the actions live ON the fighter.
function SbFighter({
  side,
  name,
  icon,
  view,
  onBite,
  onBreath,
  onAbility,
  onPosture,
  onNextReady,
  onPick,
}: {
  side: SandboxSide;
  name: string;
  icon: string | null;
  view: SandboxSideView;
  onBite: (variant: SandboxBiteVariant) => void;
  onBreath: () => void;
  onAbility: (abilityName: string) => void;
  onPosture: (target: SandboxPosture) => void;
  onNextReady: (kind: "bite" | "breath" | "ability") => void;
  onPick: () => void;
}) {
  const [biteVariant, setBiteVariant] = useState<SandboxBiteVariant>("primary");
  const dead = view.deathTime != null;
  const settledNonStanding = !view.postureTransitioning && view.postureCurrent !== "standing";
  const biteLabel = view.hasSecondary && biteVariant === "secondary" ? "Bite · 2nd" : "Bite";
  return (
    <div className={`sb-fighter sb-fighter--${side.toLowerCase()}${dead ? " is-dead" : ""}`}>
      <div className="sb-fighter__head">
        <button
          type="button"
          className="sb-fighter__pick"
          onClick={onPick}
          title={`Change Side ${side} creature`}
          aria-label={`Change Side ${side} creature (currently ${name || `Side ${side}`})`}
        >
          <IconImg src={icon} alt={name} size={40} />
          <span className="sb-fighter__id">
            <span className="sb-fighter__name">{name || `Side ${side}`}</span>
            <span className="sb-fighter__sub">side {side}{dead ? ` · dead ${formatRoundedSeconds(view.deathTime!)}` : ""}</span>
          </span>
        </button>
        <div className="sb-posture" role="group" aria-label={`Posture (Side ${side})`}>
          {(["standing", "sitting", "laying"] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`sb-posture__opt${view.postureCurrent === p ? " is-active" : ""}`}
              aria-pressed={view.postureCurrent === p}
              onClick={() => onPosture(p)}
              disabled={dead}
            >
              {POSTURE_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {/* HP + breath bars */}
      <div className="sb-bars">
        <div className="sb-bar2">
          <span className="sb-bar2__cap">HP</span>
          <div className="sb-bar2__track">
            <i className={`sb-bar2__fill sb-bar2__fill--hp${dead ? " is-dead" : ""}`} style={{ width: `${Math.max(0, Math.min(100, view.hpPct))}%` }} />
          </div>
          <span className="sb-bar2__val">{view.hp.toFixed(0)}<em> / {formatRoundedNumber(view.maxHp)}</em></span>
        </div>
        <div className="sb-bar2">
          <span className="sb-bar2__cap">Breath</span>
          <div className="sb-bar2__track">
            <i className="sb-bar2__fill sb-bar2__fill--breath" style={{ width: `${Math.max(0, Math.min(100, view.breathCapacityPct))}%` }} />
          </div>
          <span className="sb-bar2__val">{formatBreathCapacity(view.breathCapacityLeft, view.breathCapacityMax)}<em> / {formatRoundedNumber(view.breathCapacityMax)}</em></span>
        </div>
        {view.hunger != null ? (
          <MeterBar label="Hunger" meter="hunger" value={view.hunger} base={view.appetiteBase} />
        ) : null}
        {view.thirst != null ? (
          <MeterBar label="Thirst" meter="thirst" value={view.thirst} base={view.appetiteBase} />
        ) : null}
      </div>

      {/* Timing readout */}
      <div className="sb-fighter__timing">
        <span>Next bite <b>{formatRoundedSeconds(view.nextHitAt)}</b></span>
        <span>Next breath <b>{view.nextBreathAt == null ? "—" : formatRoundedSeconds(view.nextBreathAt)}</b></span>
      </div>

      {view.postureTransitioning ? (
        <div className="sb-posture-note" aria-live="polite">
          {POSTURE_LABEL[view.posturePending]} in progress{view.postureTransitionRemaining == null ? "" : ` · ${formatRoundedSeconds(view.postureTransitionRemaining)} left`}
        </div>
      ) : view.postureCurrent !== "standing" ? (
        <div className="sb-posture-note">Regen ×{view.postureRegenMult} · Decay ×{view.postureDecayMult} · Incoming ×{view.postureIncomingDamageMult}</div>
      ) : null}

      {/* Manual actions */}
      <div className="sb-actions">
        <button
          type="button"
          className="sb-act sb-act--bite"
          onClick={() => onBite(view.hasSecondary ? biteVariant : "primary")}
          disabled={!view.biteReady || dead || settledNonStanding}
          title={settledNonStanding ? "Stand up to bite — a sitting / laying creature can't attack" : undefined}
        >
          {view.biteReady ? biteLabel : `${biteLabel} (${formatRoundedSeconds(view.biteCooldownLeft)})`}
        </button>
        {view.hasSecondary ? (
          <div className="sb-variant" role="group" aria-label={`Bite variant (Side ${side})`}>
            <button type="button" className={biteVariant === "primary" ? "is-active" : ""} aria-pressed={biteVariant === "primary"} onClick={() => setBiteVariant("primary")}>1st</button>
            <button type="button" className={biteVariant === "secondary" ? "is-active" : ""} aria-pressed={biteVariant === "secondary"} onClick={() => setBiteVariant("secondary")}>2nd</button>
          </div>
        ) : null}
        <button type="button" className="sb-act sb-act--breath" onClick={onBreath} disabled={!view.breathReady || dead}>
          {view.breathReady ? "Breath" : `Breath (${view.breathCooldownLeft == null ? "—" : formatRoundedSeconds(view.breathCooldownLeft)})`}
        </button>
      </div>

      {/* Step-to-ready shortcuts */}
      <div className="sb-readyrow">
        <span className="sb-readyrow__cap">Skip to ready</span>
        <button type="button" className="sb-ready" onClick={() => onNextReady("bite")} disabled={dead}>Bite</button>
        <button type="button" className="sb-ready" onClick={() => onNextReady("breath")} disabled={dead}>Breath</button>
        <button type="button" className="sb-ready" onClick={() => onNextReady("ability")} disabled={dead}>Ability</button>
      </div>

      {/* Manual abilities */}
      {view.abilities.length > 0 ? (
        <div className="sb-abilities">
          {view.abilities.map((ability: SandboxAbilityView) => (
            <button
              key={ability.name}
              type="button"
              className={`sb-ability${ability.ready ? "" : " is-cooldown"}`}
              onClick={() => onAbility(ability.name)}
              disabled={dead || !ability.ready}
            >
              {ability.ready ? ability.actionLabel : `${ability.actionLabel} (${formatRoundedSeconds(ability.cooldownLeft)})`}
            </button>
          ))}
        </div>
      ) : null}

      {/* Statuses */}
      <div className="sb-statuses" aria-live="polite" aria-relevant="additions removals">
        {view.statuses.length === 0 ? (
          <span className="sb-statuses__none">No active statuses</span>
        ) : (
          view.statuses.map((status) => (
            <span key={status.id} className="sb-status" title={`${prettyStatusName(status.id)} · ${formatRoundedNumber(status.stacks)} stacks · ${formatRoundedSeconds(status.remainingSec)} left`}>
              {prettyStatusName(status.id)} <b>×{formatRoundedNumber(status.stacks)}</b>
              <em>{formatRoundedSeconds(status.remainingSec)}</em>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

// Timeline event kind -> category badge, mirroring Compare's timeline so the
// Sandbox reads the same way (a chronological event list, NOT a chart).
type TlKind = "damage" | "ability" | "status" | "decay" | "heal" | "death" | "manual" | "utility";
function tlKind(eventType: string): TlKind {
  switch (eventType) {
    case "bite":
    case "breath":
    case "dot":
      return "damage";
    case "ability":
    case "self_destruct":
      return "ability";
    case "status_apply":
      return "status";
    case "status_decay":
      return "decay";
    case "regen":
      return "heal";
    case "death":
      return "death";
    case "manualAction":
      return "manual";
    default:
      return "utility";
  }
}
const TL_BADGE: Record<TlKind, string> = {
  damage: "Damage", ability: "Ability", status: "Status", decay: "Decay",
  heal: "Heal", death: "Death", manual: "Action", utility: "Event",
};

// Compare-style event timeline for the Sandbox: a chronological list (oldest ->
// newest, like Compare's Timeline) where each row carries time, actor + HP,
// category badge + title + detail, and the HP swing ("N dmg" / "No HP swing").
// Reads the engine combat log (now carrying damage / actorHpAfter / detail).
// memo: every manual bite/breath/ability/step mutates the log and re-renders
// the page; without this the whole (up to 300-row) timeline re-sorts and
// reconciles on each click. Memoized + the sort cached on `log`, it only
// re-renders when the log actually changes.
const SbEventTimeline = memo(function SbEventTimeline({ log, nameA, nameB }: {
  log: SandboxLogEntryView[];
  nameA: string;
  nameB: string;
}) {
  const actorName = (side: string) => (side === "A" ? nameA || "A" : side === "B" ? nameB || "B" : side || "—");
  // Chronological (oldest -> newest) like Compare's Timeline. The engine log is
  // mostly insertion-ordered but forced/scheduled entries can land out of time
  // order, so sort by time (stable for ties). Cap to the most recent slice for
  // perf on long sessions.
  const entries = useMemo(() => [...log].sort((a, b) => a.time - b.time).slice(-300), [log]);
  if (entries.length === 0) {
    return (
      <div className="sb-tlx">
        <div className="sb-tlx-empty">No events yet — advance the timeline to see actions.</div>
      </div>
    );
  }
  return (
    <div className="sb-tlx" role="list">
      {entries.map((e, i) => {
        const kind = tlKind(e.eventType);
        const dmg = e.damage ?? 0;
        const heal = e.healing ?? 0;
        const title = e.description || logEntryTitle(e.eventType);
        return (
          <div key={`${e.time}-${i}`} className={`sb-tlx-entry sb-tlx-entry--${kind} sb-tlx-entry--side-${(e.side || "").toLowerCase()}`} role="listitem">
            <span className="sb-tlx-time">{formatRoundedSeconds(e.time)}</span>
            <div className="sb-tlx-actor">
              <strong>{actorName(e.side)}</strong>
              {e.actorHpAfter != null ? <div className="sb-tlx-hp">HP {formatRoundedNumber(e.actorHpAfter)}</div> : null}
            </div>
            <div className="sb-tlx-copy">
              <div className="sb-tlx-copy-top">
                <span className={`sb-tlx-badge sb-tlx-badge--${kind}`}>{TL_BADGE[kind]}</span>
                <span>{title}</span>
              </div>
              {e.detail ? <div className="sb-tlx-why">{e.detail}</div> : null}
            </div>
            {dmg > 0 || heal > 0 ? (
              <div className="sb-tlx-result">
                {dmg > 0 ? <span className="sb-tlx-dmg">{formatRoundedNumber(dmg)} dmg</span> : null}
                {heal > 0 ? <span className="sb-tlx-heal">{formatRoundedNumber(heal)} heal</span> : null}
              </div>
            ) : (
              <div className="sb-tlx-result sb-tlx-result--muted">No HP swing</div>
            )}
          </div>
        );
      })}
    </div>
  );
});

// A/B side toggle reused by Start Setup + Overrides so both read the same way.
function SbSideToggle({ side, onChange, label }: { side: SandboxSide; onChange: (s: SandboxSide) => void; label: string }) {
  return (
    <div className="cb-seg sb-sidetoggle" role="tablist" aria-label={label}>
      {(["A", "B"] as const).map((s) => (
        <button key={s} type="button" role="tab" aria-selected={side === s} className={`cb-seg__opt sb-sidetoggle__opt sb-sidetoggle__opt--${s.toLowerCase()}${side === s ? " is-active" : ""}`} onClick={() => onChange(s)}>
          Side {s}
        </button>
      ))}
    </div>
  );
}

// Merged Start Setup - one card with an A/B side toggle + a leading-label form
// so the two Apply buttons line up in a column (the legacy two-card layout left
// the button drifting above its field).
function SbStartSetup({
  startHpA, startHpB, appetiteA, appetiteB, statusOptions, setStartHpA, setStartHpB, onApplyHp, onApplyStatus, onApplyMeter,
}: {
  startHpA: number;
  startHpB: number;
  appetiteA: number;
  appetiteB: number;
  statusOptions: { id: string; name: string }[];
  setStartHpA: (v: number) => void;
  setStartHpB: (v: number) => void;
  onApplyHp: (side: SandboxSide, hp: number) => void;
  onApplyStatus: (side: SandboxSide, statusId: string, stacks: number) => void;
  onApplyMeter: (side: SandboxSide, meter: SandboxMeter, value: number) => void;
}) {
  const [side, setSide] = useState<SandboxSide>("A");
  const [statusId, setStatusId] = useState(DEFAULT_SEED_STATUS_ID);
  const [stacks, setStacks] = useState(10);
  const [meter, setMeter] = useState<SandboxMeter>("hunger");
  // Left alone, the field offers a full bar for whichever side is selected -
  // the meters are sized off the creature's appetite, not off a flat hundred.
  const [meterDraft, setMeterDraft] = useState<number | null>(null);
  const startHp = side === "A" ? startHpA : startHpB;
  const setStartHp = side === "A" ? setStartHpA : setStartHpB;
  const appetite = side === "A" ? appetiteA : appetiteB;
  const meterValue = meterDraft ?? appetite;
  return (
    <div className="sb-form">
      <div className="sb-form__head">
        <h3>Start setup</h3>
        <SbSideToggle side={side} onChange={setSide} label="Side to configure" />
      </div>
      <div className="sb-form__row">
        <span className="sb-form__lbl">HP</span>
        <input className="sb-form__field" aria-label={`Side ${side} start HP`} type="number" min={0} value={startHp} onChange={(e) => setStartHp(Number(e.target.value) || 0)} />
        <button className="sb-form__apply" type="button" onClick={() => onApplyHp(side, startHp)}>Apply HP</button>
      </div>
      <div className="sb-form__row">
        <span className="sb-form__lbl">Status</span>
        <div className="sb-form__field sb-form__statusctl">
          <select aria-label={`Side ${side} seed status`} value={statusId} onChange={(e) => setStatusId(e.target.value)}>
            {statusOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input aria-label={`Side ${side} seed stacks`} type="number" value={stacks} onChange={(e) => setStacks(Number(e.target.value) || 0)} placeholder="Stacks" title="Stacks" />
        </div>
        <button className="sb-form__apply" type="button" onClick={() => onApplyStatus(side, statusId, stacks)}>Apply</button>
      </div>
      <div className="sb-form__row">
        <span className="sb-form__lbl">Meter</span>
        <div className="sb-form__field sb-form__statusctl">
          <select aria-label={`Side ${side} meter`} value={meter} onChange={(e) => setMeter(e.target.value as SandboxMeter)}>
            <option value="hunger">Hunger</option>
            <option value="thirst">Thirst</option>
          </select>
          <input
            aria-label={`Side ${side} meter value in appetite units`}
            type="number"
            value={meterValue}
            onChange={(e) => setMeterDraft(Number(e.target.value) || 0)}
            placeholder="Units"
            title="Appetite units. Below zero the creature starves, one stack per unit."
          />
        </div>
        <button className="sb-form__apply" type="button" onClick={() => onApplyMeter(side, meter, meterValue)}>Apply</button>
      </div>
    </div>
  );
}

// Override category options for the Overrides builder.
const OVERRIDE_CATEGORY_OPTIONS: Array<{ id: SandboxOverrideCategory; label: string }> = [
  { id: "stat", label: "Stat" },
  { id: "ability", label: "Ability / Effect" },
  { id: "passive", label: "Passive" },
  { id: "breath", label: "Breath" },
  { id: "resist", label: "Resist" },
  { id: "offensiveStatus", label: "Offensive status" },
  { id: "defensiveStatus", label: "Defensive status" },
];

// Beta-native Overrides editor: a labelled builder (side toggle + category +
// the type-specific fields + Set/Add) above two columns of removable chips for
// the active overrides per side. Replaces the legacy stacked-select panel.
function SbOverrides({
  editor, setEditor, statusOptions, abilityOptions, abilityValueSpecs, passiveSpecs, breathOptions,
  overridesA, overridesB, onApply, onClear, onRemove,
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
  const valueKind = abilityValueSpecs.get(editor.abilityName) ?? null;
  const stringOptions: AbilityValueOption[] = valueKind === "string" ? getAbilityValueOptions(editor.abilityName) : [];
  const passiveKind = editor.category === "passive" ? passiveSpecs.get(editor.passiveName) ?? null : null;
  const isStat = editor.category === "stat";
  const isStatusLike = editor.category === "resist" || editor.category === "offensiveStatus" || editor.category === "defensiveStatus";

  const renderSide = (side: SandboxSide, list: SandboxOverrideEntry[]) => (
    <div className={`sb-ov-side sb-ov-side--${side.toLowerCase()}`}>
      <div className="sb-ov-side__head">
        <span className={`sb-ov-side__name sb-ov-side__name--${side.toLowerCase()}`}>Side {side}</span>
        {list.length > 0 ? (
          <button type="button" className="sb-ov-clear" onClick={() => onClear(side)}>Clear all</button>
        ) : null}
      </div>
      {list.length === 0 ? (
        <span className="sb-ov-empty">No overrides</span>
      ) : (
        <div className="sb-ov-chips">
          {list.map((entry, index) => (
            <span key={`${side}-${index}`} className="sb-ov-chip">
              {describeOverride(entry)}
              <button type="button" className="sb-ov-chip__x" aria-label={`Remove ${describeOverride(entry)}`} title="Remove" onClick={() => onRemove(side, index)}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="sb-ov">
      <div className="sb-ov__head">
        <h3>Overrides</h3>
        <p className="sb-ov__intro">Force a stat, ability, passive, breath, resist or status onto a side. <b>Set</b> replaces; <b>Add</b> stacks (stat only).</p>
      </div>

      <div className="sb-ov-builder">
        <div className="sb-form__row">
          <span className="sb-form__lbl">Side</span>
          <SbSideToggle side={editor.side} onChange={(s) => setEditor({ ...editor, side: s })} label="Override target side" />
        </div>
        <div className="sb-form__row">
          <span className="sb-form__lbl">Type</span>
          <select className="sb-form__field" aria-label="Override type" value={editor.category} onChange={(e) => setEditor({ ...editor, category: e.target.value as SandboxOverrideCategory })}>
            {OVERRIDE_CATEGORY_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>

        {isStat ? (
          <div className="sb-form__row">
            <span className="sb-form__lbl">Stat</span>
            <div className="sb-form__field sb-ov-split">
              <select aria-label="Override stat" value={editor.statField} onChange={(e) => setEditor({ ...editor, statField: e.target.value as SandboxStatField })}>
                {STAT_FIELD_OPTIONS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <input aria-label="Override stat value" type="number" step={editor.statField === "biteCooldown" ? "0.1" : "1"} placeholder="Value" value={editor.value} onChange={(e) => setEditor({ ...editor, value: e.target.value })} />
            </div>
          </div>
        ) : null}

        {editor.category === "ability" ? (
          <div className="sb-form__row">
            <span className="sb-form__lbl">Ability</span>
            <div className="sb-form__field sb-ov-split">
              <select aria-label="Override ability" value={editor.abilityName} onChange={(e) => setEditor({ ...editor, abilityName: e.target.value, value: "" })}>
                {abilityOptions.length === 0 ? <option value="">(loading…)</option> : null}
                {abilityOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              {valueKind === "number" ? (
                <input aria-label="Override ability value" type="number" step="0.01" placeholder="0 = off" value={editor.value} onChange={(e) => setEditor({ ...editor, value: e.target.value })} />
              ) : valueKind === "string" && stringOptions.length > 0 ? (
                <select aria-label="Override ability payload" value={editor.value} onChange={(e) => setEditor({ ...editor, value: e.target.value })}>
                  <option value="">(none)</option>
                  {stringOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : valueKind === "string" ? (
                <input aria-label="Override ability value" type="text" placeholder="e.g. Disease" value={editor.value} onChange={(e) => setEditor({ ...editor, value: e.target.value })} />
              ) : null}
            </div>
          </div>
        ) : null}

        {editor.category === "passive" ? (
          <div className="sb-form__row">
            <span className="sb-form__lbl">Passive</span>
            <div className="sb-form__field sb-ov-split">
              <select aria-label="Override passive" value={editor.passiveName} onChange={(e) => setEditor({ ...editor, passiveName: e.target.value, value: "" })}>
                {passiveSpecs.size === 0 ? <option value="">(loading…)</option> : null}
                {Array.from(passiveSpecs.keys()).map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              {passiveKind === "number" ? (
                <input aria-label="Override passive value" type="number" step="0.01" placeholder="0 = off" value={editor.value} onChange={(e) => setEditor({ ...editor, value: e.target.value })} />
              ) : null}
            </div>
          </div>
        ) : null}

        {editor.category === "breath" ? (
          <div className="sb-form__row">
            <span className="sb-form__lbl">Breath</span>
            <select className="sb-form__field" aria-label="Override breath profile" value={editor.breathName} onChange={(e) => setEditor({ ...editor, breathName: e.target.value })}>
              <option value="">(clear breath)</option>
              {breathOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
        ) : null}

        {isStatusLike ? (
          <div className="sb-form__row">
            <span className="sb-form__lbl">{editor.category === "resist" ? "Resist" : "Status"}</span>
            <div className="sb-form__field sb-ov-split">
              <select aria-label="Override status" value={editor.statusId} onChange={(e) => setEditor({ ...editor, statusId: e.target.value })}>
                {statusOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input aria-label={editor.category === "resist" ? "Resist fraction (0..1)" : "Status stacks"} type="number" step="0.1" placeholder={editor.category === "resist" ? "0..1" : "Stacks"} value={editor.value} onChange={(e) => setEditor({ ...editor, value: e.target.value })} />
            </div>
          </div>
        ) : null}

        <div className="sb-form__row sb-ov-actions">
          <span className="sb-form__lbl" aria-hidden="true" />
          <div className="sb-ov-actions__btns">
            <button type="button" className="sb-ov-set" onClick={() => onApply("set")}>Set override</button>
            <button type="button" className="sb-ov-add" onClick={() => onApply("add")} disabled={!isStat} title={isStat ? "Add to the current stat value" : "Add mode only applies to stat overrides"}>Add</button>
          </div>
        </div>
        {passiveKind === "bool" ? (
          <p className="sb-ov-hint">Spec-standard activation (e.g. Berserk fires &lt; 20 % HP). Set enables; remove disables.</p>
        ) : editor.category === "breath" ? (
          <p className="sb-ov-hint">Replaces the side's breath profile (or clears it). Capacity + next-breath timer reset so it's ready immediately.</p>
        ) : null}
      </div>

      <div className="sb-ov-active">
        <div className="sb-ov-active__head">Active overrides</div>
        <div className="sb-ov-sides">
          {renderSide("A", overridesA)}
          {renderSide("B", overridesB)}
        </div>
      </div>
    </div>
  );
}

export default function SandboxPageBeta(props: SandboxPageBetaProps) {
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
  const view = sandbox.view;
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<"a" | "b" | "battle">("a");
  const canAdvance = view != null && !view.halted;
  const step = Number(c.timeStep) || 0;

  const openSetup = (tab: "a" | "b" | "battle") => {
    setSetupTab(tab);
    setSetupOpen(true);
  };

  return (
    <section className="sb">
      {/* Stepper bar - the always-visible control surface. */}
      <div className="sb-bar">
        <div className="sb-now">
          <span className="sb-now__t">{view ? Math.max(0, view.time).toFixed(1) : "0.0"}<em>s</em></span>
          <span className={`sb-now__state${view?.halted ? " is-halted" : ""}`}>{view?.halted ? "halted" : c.automationMode === "manual" ? "manual" : "semi-auto"}</span>
        </div>

        <div className="cb-seg sb-mode" role="tablist" aria-label="Sandbox mode">
          {(["manual", "semiAuto"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={c.automationMode === m}
              className={`cb-seg__opt${c.automationMode === m ? " is-active" : ""}`}
              onClick={() => c.setAutomationMode(m)}
            >
              {m === "manual" ? "Manual" : "Semi-Auto"}
            </button>
          ))}
        </div>

        <div className="sb-bar__actions">
          <button className="cb-ghostbtn" type="button" onClick={() => openSetup("a")}>
            <Settings2 size={15} strokeWidth={2} aria-hidden="true" /> Configure
          </button>
          <button className="cb-ghostbtn sb-reset" type="button" onClick={() => void c.onResetWithClear()} disabled={sandbox.loading}>
            <RotateCcw size={15} strokeWidth={2} aria-hidden="true" /> {sandbox.loading ? "Resetting…" : "Reset"}
          </button>
        </div>
      </div>

      {/* Transport - three clearly-delineated controls: a connected "next event"
          group, a number-stepper (- [amount] +) with size presets, and a jump
          field. Replaces the old flat row of ~14 identical pills. */}
      {view ? (
        <div className="sb-transport">
          <div className="sb-transport__grp">
            <span className="sb-transport__cap">Next event</span>
            <div className="sb-evgroup" role="group" aria-label="Advance to next event">
              {EVENT_FILTERS.map((f) => (
                <button key={f.id} type="button" className="sb-evgroup__btn" onClick={() => c.onNextEvent(f.id)} disabled={!canAdvance}>{f.label}</button>
              ))}
            </div>
          </div>

          <span className="sb-transport__sep" aria-hidden="true" />

          <div className="sb-transport__grp">
            <span className="sb-transport__cap">Step</span>
            {/* Custom amount (the essential bit) is the site's standard input
                box; - / + are matched buttons that nudge time by it. No wrapping
                pill, so no nested box. */}
            <button type="button" className="sb-ctl sb-ctl--sq" onClick={() => c.nudge(-step)} disabled={!step} aria-label={`Back ${step || ""} seconds`}><Minus size={15} strokeWidth={2.4} aria-hidden="true" /></button>
            <span className="sb-amount">
              <input className="sb-num" aria-label="Step size (seconds)" type="number" step="0.1" min="0.1" value={c.timeStep} onChange={(e) => c.setTimeStep(e.target.value)} />
              <span className="sb-unit">s</span>
            </span>
            <button type="button" className="sb-ctl sb-ctl--sq" onClick={() => c.nudge(step)} disabled={!step} aria-label={`Forward ${step || ""} seconds`}><Plus size={15} strokeWidth={2.4} aria-hidden="true" /></button>
          </div>

          <span className="sb-transport__sep" aria-hidden="true" />

          <div className="sb-transport__grp">
            <span className="sb-transport__cap">Jump to</span>
            <span className="sb-amount">
              <input className="sb-num" aria-label="Jump to time (sec)" type="number" step="0.1" min="0" value={c.jumpTarget} onChange={(e) => c.setJumpTarget(e.target.value)} />
              <span className="sb-unit">s</span>
            </span>
            <button type="button" className="sb-ctl sb-ctl--go" onClick={() => c.seek(Number(c.jumpTarget) || 0)}>Go</button>
            <button type="button" className="sb-ctl" onClick={() => c.seek(0)} title="Back to start (t = 0)">
              <RotateCcw size={13} strokeWidth={2} aria-hidden="true" /> Start
            </button>
          </div>
        </div>
      ) : null}

      {sandbox.bridgeUnavailable ? (
        <div className="ob-error">Sandbox bindings missing from the loaded WASM bundle. Run <code>npm run rust:build</code> and reload.</div>
      ) : null}
      {sandbox.error ? <div className="ob-error">{sandbox.error}</div> : null}

      {/* Interactive HUD + log, or empty state. */}
      {view ? (
        <>
          <div className="sb-hud">
            <SbFighter
              side="A"
              name={nameA}
              icon={getCreatureIcon(nameA)}
              view={view.sideA}
              onBite={(variant) => c.onManualBite("A", variant)}
              onBreath={() => c.onManualBreath("A")}
              onAbility={(abilityName) => void c.onManualAbility("A", abilityName)}
              onPosture={(target) => c.onForcePosture("A", target)}
              onNextReady={(kind) => c.onNextReady("A", kind)}
              onPick={() => openSetup("a")}
            />
            <SbFighter
              side="B"
              name={nameB}
              icon={getCreatureIcon(nameB)}
              view={view.sideB}
              onBite={(variant) => c.onManualBite("B", variant)}
              onBreath={() => c.onManualBreath("B")}
              onAbility={(abilityName) => void c.onManualAbility("B", abilityName)}
              onPosture={(target) => c.onForcePosture("B", target)}
              onNextReady={(kind) => c.onNextReady("B", kind)}
              onPick={() => openSetup("b")}
            />
          </div>

          <div className="sb-logwrap">
            <div className="sb-logwrap__head">
              <span className="sb-logwrap__title">Combat timeline</span>
              <span className="sb-logwrap__hint">{view.log.length} events · oldest first, like Compare.</span>
            </div>
            <div className="sb-tlx-scroll" role="region" aria-label="Combat event timeline" aria-live="polite" aria-relevant="additions">
              <SbEventTimeline log={view.log} nameA={nameA} nameB={nameB} />
            </div>
          </div>

          {/* Live tools - Start setup + Overrides on the page (not buried in the
              Configure modal), so you can seed HP/status and force stats mid-run
              and step again without opening a window, like the classic Sandbox.
              Open by default; collapsible to reclaim space for the timeline. */}
          <details className="sb-tools" open>
            <summary className="sb-tools__summary">
              <SlidersHorizontal size={15} strokeWidth={2} aria-hidden="true" />
              <span>Overrides &amp; start setup</span>
              <span className="sb-tools__hint">apply mid-run, then step</span>
            </summary>
            <div className="sb-tools__body">
              <SbStartSetup
                startHpA={c.startHpA}
                startHpB={c.startHpB}
                appetiteA={c.sandbox.view?.sideA.appetiteBase ?? 100}
                appetiteB={c.sandbox.view?.sideB.appetiteBase ?? 100}
                statusOptions={c.statusOptions}
                setStartHpA={c.setStartHpA}
                setStartHpB={c.setStartHpB}
                onApplyHp={c.onApplyHp}
                onApplyStatus={c.onApplyStatus}
                onApplyMeter={c.onApplyMeter}
              />
              <SbOverrides
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
            </div>
          </details>
        </>
      ) : (
        <div className="cb-empty">{sandbox.loading ? "Loading sandbox…" : "Pick both creatures (Configure) to initialize the sandbox."}</div>
      )}

      {/* Setup overlay - Creature A / Creature B / Battle (Overrides + Start
          setup now live on the page, below the timeline). */}
      {setupOpen ? createPortal(
        <div className="beta-portal">
          <div className="cb-scrim" onClick={() => setSetupOpen(false)} />
          <aside className="cb-modal" role="dialog" aria-label="Sandbox setup" aria-modal="true">
            <div className="cb-modal__head">
              <h3>Configure</h3>
              <div className="cb-modal__head-actions">
                <button className="cb-icon" aria-label="Close setup" onClick={() => setSetupOpen(false)}><X size={16} strokeWidth={2} /></button>
              </div>
            </div>
            <div className="cb-modal__tabs" role="tablist">
              <button type="button" role="tab" aria-selected={setupTab === "a"} className={`cb-modal__tab cb-modal__tab--a${setupTab === "a" ? " is-active" : ""}`} onClick={() => setSetupTab("a")}>
                <IconImg src={getCreatureIcon(nameA)} alt="" size={20} /><span>{nameA || "Creature A"}</span>
              </button>
              <button type="button" role="tab" aria-selected={setupTab === "b"} className={`cb-modal__tab cb-modal__tab--b${setupTab === "b" ? " is-active" : ""}`} onClick={() => setSetupTab("b")}>
                <IconImg src={getCreatureIcon(nameB)} alt="" size={20} /><span>{nameB || "Creature B"}</span>
              </button>
              <button type="button" role="tab" aria-selected={setupTab === "battle"} className={`cb-modal__tab${setupTab === "battle" ? " is-active" : ""}`} onClick={() => setSetupTab("battle")}>
                <Settings2 size={15} strokeWidth={2} aria-hidden="true" /><span>Battle</span>
              </button>
            </div>
            <div className="cb-modal__body">
              <div className="cb-tabpane cb-tabpane--creature cb-tabpane--a" hidden={setupTab !== "a"}>
                {/* Creature picker - hideIdentity strips the card's own name
                    field, so the overlay must supply it (this is what was
                    missing: no way to change the creature). It sits ABOVE the
                    build panel so the five build fields map 1:1 to the
                    cb-tabpane--creature grid areas (Elder gets its full row). */}
                <div className="field cb-setup-creature">
                  <label>Creature A</label>
                  <div className="icon-input">
                    <IconImg src={getCreatureIcon(nameA)} alt={nameA} size={36} />
                    <CreatureNameInput ariaLabel="Sandbox creature A" value={nameA} onChange={onNameAChange} creatureNames={creatureNames} />
                  </div>
                </div>
                <CreatureSelectorCard label="Creature A" name={nameA} creatureNames={creatureNames} getIcon={getCreatureIcon} onNameChange={onNameAChange} build={buildA} onBuildChange={onBuildAChange} hideIdentity elderDeltaChips betaPlushiePicker />
              </div>
              <div className="cb-tabpane cb-tabpane--creature cb-tabpane--b" hidden={setupTab !== "b"}>
                <div className="field cb-setup-creature">
                  <label>Creature B</label>
                  <div className="icon-input">
                    <IconImg src={getCreatureIcon(nameB)} alt={nameB} size={36} />
                    <CreatureNameInput ariaLabel="Sandbox creature B" value={nameB} onChange={onNameBChange} creatureNames={creatureNames} />
                  </div>
                </div>
                <CreatureSelectorCard label="Creature B" name={nameB} creatureNames={creatureNames} getIcon={getCreatureIcon} onNameChange={onNameBChange} build={buildB} onBuildChange={onBuildBChange} hideIdentity elderDeltaChips betaPlushiePicker />
              </div>

              <div className="cb-tabpane cb-tabpane--search" hidden={setupTab !== "battle"}>
                <div className="panel-block">
                  <h3>Battle settings</h3>
                  <BestBuildsBattleSettingsPanel sourceName={nameA} opponentNames={nameB ? [nameB] : []} betaSkin inline allowIdealBreath />
                  {/* Policy / Actives / Breath grouped in one compact row rather
                      than three full-width stacked selects. */}
                  <div className="sb-policy-grid">
                    <div className="field">
                      <label>Ability policy</label>
                      <select aria-label="Ability Policy" value={c.abilityPolicy} onChange={(e) => c.setAbilityPolicy(e.target.value as typeof c.abilityPolicy)}>
                        <option value="reallyFast">Really fast</option>
                        <option value="fast">Fast</option>
                        <option value="semiIdeal">Semi-Ideal</option>
                        <option value="ideal">Ideal</option>
                        <option value="extreme">Extreme</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Actives</label>
                      <select aria-label="Actives" value={c.activesOn ? "on" : "off"} onChange={(e) => c.setActivesOn(e.target.value === "on")}>
                        <option value="on">On</option>
                        <option value="off">Off</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Breath</label>
                      <select aria-label="Breath" value={c.breathOn ? "on" : "off"} onChange={(e) => c.setBreathOn(e.target.value === "on")}>
                        <option value="on">On</option>
                        <option value="off">Off</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}

/**
 * One survival meter as a read-only bar. A meter stops at zero and stays
 * there while the creature starves; the stacks it is taking for that are in
 * the status list. Setting a meter belongs to Start setup and Overrides, not
 * to the live gauge.
 */
function MeterBar({
  label,
  meter,
  value,
  base,
}: {
  label: string;
  meter: SandboxMeter;
  value: number;
  base: number;
}) {
  const pct = base > 0 ? (value / base) * 100 : 0;
  const starving = value <= 0;
  return (
    <div className="sb-bar2">
      <span className="sb-bar2__cap">{label}</span>
      <div className="sb-bar2__track">
        <i
          className={`sb-bar2__fill sb-bar2__fill--${meter}${starving ? " is-dead" : ""}`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
      <span className="sb-bar2__val">
        {starving ? "starving" : value.toFixed(0)}
        <em> / {formatRoundedNumber(base)}</em>
      </span>
    </div>
  );
}
