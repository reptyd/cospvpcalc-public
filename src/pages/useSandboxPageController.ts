// Page-level orchestration for the Sandbox, shared by the default SandboxPage
// and the beta SandboxPageBeta (same pattern as useOptimizerPageController /
// useBestBuildsPageController). Wraps the engine hook (useSandboxSimulation),
// owns the override editor + per-side override lists + start-HP/seed, the
// manual-action handlers, the time-stepping helpers, the action log, and the
// Share-Match snapshot. Both pages render their own layout from this.

import { useEffect, useMemo, useRef, useState } from "react";
import type { AbilityTimingMode, BuildOptions, CreatureRuntime } from "../engine";
import { statusById, statusEffects } from "../engine/data";
import { formatRoundedNumber } from "../shared/displayFormat";
import { useSandboxSimulation } from "../hooks/useSandboxSimulation";
import { useBestBuildsBattleSettings } from "../components/bestBuilds/BestBuildsBattleSettingsContext";
import type {
  SandboxAbilityValueKind,
  SandboxAbilityValueSpec,
  SandboxBiteVariant,
  SandboxEventFilter,
  SandboxLogEntryView,
  SandboxMeter,
  SandboxOverrideField,
  SandboxPassiveKind,
  SandboxPassiveSpec,
  SandboxPosture,
  SandboxReadyKind,
  SandboxSide,
} from "../engine/sandboxBridge";
import { buildBreathProfileByName, listAvailableBreathNames } from "../optimizer/rustBestBuildsRuntime";
import { registerMatchSnapshotProvider } from "../shared/matchSnapshot";

export const DEFAULT_SEED_STATUS_ID = "Poison_Status";

// Action labels for the posture segmented control (clicking transitions TO
// that posture; the active highlight shows the current settled posture).
export const POSTURE_LABEL: Record<SandboxPosture, string> = {
  standing: "Stand",
  sitting: "Sit",
  laying: "Lay",
};

export type SandboxOverrideCategory =
  | "stat"
  | "ability"
  | "passive"
  | "breath"
  | "resist"
  | "offensiveStatus"
  | "defensiveStatus";
export type SandboxOverrideMode = "set" | "add";
export type SandboxStatField = "health" | "weight" | "damage" | "biteCooldown" | "healthRegen" | "appetite";

export const STAT_FIELD_OPTIONS: { id: SandboxStatField; label: string; engineKey: SandboxOverrideField }[] = [
  { id: "health", label: "Health", engineKey: "health" },
  { id: "healthRegen", label: "Health Regen", engineKey: "health_regen" },
  { id: "weight", label: "Weight", engineKey: "weight" },
  { id: "damage", label: "Damage", engineKey: "damage" },
  { id: "biteCooldown", label: "Bite Cooldown", engineKey: "bite_cooldown" },
  // Sizes both meters - the game reads thirst capacity off the same stat.
  { id: "appetite", label: "Appetite", engineKey: "appetite" },
];

// Ability list is sourced from the Rust engine via
// `sandboxListOverridableAbilities()` on mount - single source of truth in
// `composable/sandbox.rs::OVERRIDABLE_ABILITY_FLAGS`. The empty-array fallback
// is for the first render before the WASM-sourced list resolves.
const ABILITY_OPTIONS_FALLBACK: string[] = [];

export type SandboxOverrideEntry =
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

export type SandboxOverrideEditorState = {
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
  abilityName: ABILITY_OPTIONS_FALLBACK[0] ?? "",
  passiveName: "",
  breathName: "",
  statusId: DEFAULT_SEED_STATUS_ID,
  value: "",
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

export function prettyStatusName(id: string): string {
  return statusById[id]?.name ?? id;
}

export function describeOverride(entry: SandboxOverrideEntry): string {
  switch (entry.kind) {
    case "stat":
      return `${entry.mode === "set" ? "Set" : "Add"} ${entry.field}: ${formatRoundedNumber(entry.value)}`;
    case "ability":
      return `Ability ${entry.abilityName} ${entry.enabled ? "on" : "off"}`;
    case "abilityNumber":
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

export function logEntryTitle(eventType: string): string {
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
    case "dodge":
      return "Dodged";
    default:
      return eventType
        .split("_")
        .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
        .join(" ");
  }
}

export function statusOptionsList(): { id: string; name: string }[] {
  return statusEffects
    .map((s) => ({ id: s.id, name: s.name ?? s.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type SandboxPageControllerProps = {
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  buildB: BuildOptions;
  creatureA?: CreatureRuntime;
  creatureB?: CreatureRuntime;
  onNameAChange: (value: string) => void;
  onNameBChange: (value: string) => void;
  onBuildAChange: (value: BuildOptions) => void;
  onBuildBChange: (value: BuildOptions) => void;
};

export function useSandboxPageController({
  nameA,
  nameB,
  buildA,
  buildB,
  creatureA,
  creatureB,
  onNameAChange,
  onNameBChange,
  onBuildAChange,
  onBuildBChange,
}: SandboxPageControllerProps) {
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
      ({ sandboxListOverridableAbilities, sandboxListOverridableAbilityValues, sandboxListOverridablePassives }) => {
        void sandboxListOverridableAbilities().then((names) => {
          if (cancelled || names.length === 0) return;
          setAbilityOptions(names);
          setOverrideEditor((prev) => (prev.abilityName ? prev : { ...prev, abilityName: names[0] }));
        });
        void sandboxListOverridableAbilityValues().then((specs: SandboxAbilityValueSpec[]) => {
          if (cancelled) return;
          setAbilityValueSpecs(new Map(specs.map((s) => [s.name, s.kind])));
        });
        void sandboxListOverridablePassives().then((specs: SandboxPassiveSpec[]) => {
          if (cancelled || specs.length === 0) return;
          setPassiveSpecs(new Map(specs.map((s) => [s.name, s.kind])));
          setOverrideEditor((prev) => (prev.passiveName ? prev : { ...prev, passiveName: specs[0].name }));
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

  // Seeking backwards past a mode switch puts the run back in the mode it was
  // in at that time, so the control follows the sandbox rather than leading it.
  const viewAutomationMode = sandbox.view?.automationMode;
  useEffect(() => {
    if (viewAutomationMode != null) setAutomationMode(viewAutomationMode);
  }, [viewAutomationMode]);

  const statusOptions = useMemo(statusOptionsList, []);

  // Sync Start HP fields with view max HP whenever the sandbox rebuilds.
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

  // Share-Match snapshot provider.
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

  // Apply imported overrides + start HP once the session has rebuilt.
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
    void sandbox.stepToTime(Math.max(0, target));
  };

  const breathOptionList = useMemo(() => listAvailableBreathNames(), []);

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

  const overridesFor = (side: SandboxSide): SandboxOverrideEntry[] => (side === "A" ? overridesA : overridesB);
  const setOverridesFor = (side: SandboxSide, next: SandboxOverrideEntry[]) => {
    if (side === "A") setOverridesA(next);
    else setOverridesB(next);
  };

  const logAction = (side: SandboxSide, description: string) => {
    prependAction({ time: sandbox.view?.time ?? 0, side, eventType: "manualAction", description });
  };

  const onApplyHp = (side: SandboxSide, hp: number) => {
    void sandbox.applyHp(side, hp);
    logAction(side, `${side} set HP to ${hp.toFixed(1)}`);
  };
  const onApplyStatus = (side: SandboxSide, statusId: string, stacks: number) => {
    void sandbox.applyStatus(side, statusId, stacks);
    logAction(side, `${side} apply ${prettyStatusName(statusId)} x${stacks}`);
  };
  const onManualBite = (side: SandboxSide, variant: SandboxBiteVariant) => {
    void sandbox.forceBite(side, variant);
    logAction(side, `${side} manual bite${variant === "secondary" ? " (secondary)" : ""}`);
  };
  const onManualBreath = (side: SandboxSide) => {
    void sandbox.forceBreath(side);
    logAction(side, `${side} manual breath`);
  };
  const onManualAbility = async (side: SandboxSide, name: string) => {
    const recognised = await sandbox.forceAbility(side, name);
    logAction(side, recognised ? `${side} manual ${name}` : `${side} ${name} on cooldown`);
  };
  const onForcePosture = (side: SandboxSide, target: SandboxPosture) => {
    void sandbox.forcePosture(side, target);
    logAction(side, `${side} ${POSTURE_LABEL[target].toLowerCase()}`);
  };
  const onApplyMeter = (side: SandboxSide, meter: SandboxMeter, value: number) => {
    void sandbox.applyMeter(side, meter, value);
    logAction(side, `${side} ${meter} set to ${value.toFixed(1)}`);
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
        const engineField = STAT_FIELD_OPTIONS.find((f) => f.id === editor.statField)?.engineKey ?? "damage";
        const finalValue =
          mode === "add"
            ? (() => {
                const baseEntry = prev.find((e) => e.kind === "stat" && e.field === editor.statField) as
                  | { kind: "stat"; field: SandboxStatField; value: number; mode: SandboxOverrideMode }
                  | undefined;
                return (baseEntry?.value ?? 0) + numericValue;
              })()
            : numericValue;
        await sandbox.overrideStat(side, engineField, finalValue);
        if (editor.statField === "health") {
          await sandbox.applyHp(side, finalValue);
        }
        entry = { kind: "stat", field: editor.statField, value: finalValue, mode };
        break;
      }
      case "breath": {
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
        const valueKind = abilityValueSpecs.get(editor.abilityName) ?? null;
        if (valueKind === "number") {
          const recognised = await sandbox.overrideAbilityNumber(side, editor.abilityName, validNumeric ? numericValue : 0);
          if (!recognised) return;
          entry = { kind: "abilityNumber", abilityName: editor.abilityName, value: validNumeric ? numericValue : 0 };
        } else if (valueKind === "string") {
          const trimmed = editor.value.trim();
          const payload = trimmed.length > 0 ? trimmed : null;
          const recognised = await sandbox.overrideAbilityString(side, editor.abilityName, payload);
          if (!recognised) return;
          entry = { kind: "abilityString", abilityName: editor.abilityName, value: payload };
        } else {
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
        await sandbox.overrideAbilityNumber(side, target.abilityName, 0);
        break;
      case "abilityString":
        await sandbox.overrideAbilityString(side, target.abilityName, null);
        break;
      case "passiveBool":
        await sandbox.overridePassiveBool(side, target.passiveName, false);
        break;
      case "passiveNumber":
        await sandbox.overridePassiveNumber(side, target.passiveName, 0);
        break;
      case "breath":
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
  const onNextReady = (side: SandboxSide, kind: SandboxReadyKind) => void sandbox.stepUntilReady(side, kind);

  return {
    sandbox,
    automationMode,
    setAutomationMode,
    abilityPolicy,
    setAbilityPolicy,
    activesOn,
    setActivesOn,
    breathOn,
    setBreathOn,
    timeStep,
    setTimeStep,
    jumpTarget,
    setJumpTarget,
    startHpA,
    setStartHpA,
    startHpB,
    setStartHpB,
    overrideEditor,
    setOverrideEditor,
    statusOptions,
    mergedAbilityOptions,
    abilityValueSpecs,
    passiveSpecs,
    breathOptionList,
    overridesA,
    overridesB,
    actionLog,
    nudge,
    seek,
    onApplyHp,
    onApplyStatus,
    onManualBite,
    onManualBreath,
    onManualAbility,
    onForcePosture,
    onApplyMeter,
    onResetWithClear,
    applyOverride,
    clearOverridesForSide,
    removeOverrideAt,
    onNextEvent,
    onNextReady,
  };
}

export type SandboxPageController = ReturnType<typeof useSandboxPageController>;
