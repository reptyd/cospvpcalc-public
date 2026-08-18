import { useEffect, useId, useMemo, useState } from "react";
import { Copy, PawPrint, Pencil, Plus, Trash2 } from "lucide-react";
import {
  listCustomAbilityRecords,
  subscribeCustomAbilityRegistry,
  type CustomAbilityRecord,
} from "../shared/customAbilities";
import { CreatureNameInput } from "../components/CreatureNameInput";
import { IconImg } from "../components/IconImg";
import {
  decodeCustomCreatureCode,
  encodeCustomCreatureCode,
  getCustomCreatureRecord,
  registerCustomCreatureRecord,
  unregisterCustomCreatureRecord,
  clearCustomCreatureRecords,
  type CustomCreatureRecord,
} from "../engine/customCreatures";
import { creatureByName, creaturesData, normalizeCreatureSearchName } from "../engine/creatureData";
import { effectsCatalog } from "../engine/data";
import type { CreatureRuntime, EffectsCatalogByCreature, AbilityRef, CustomBreathProfile } from "../engine/types";
import { BreathProfileEditor, makeBlankBreathProfile } from "../components/custom/BreathProfileEditor";
import { getCompareAppetiteEntry, type CompareAppetiteEntry } from "../engine/compareAppetiteData";
import { synthesizeCustomCreatureEffects } from "../engine/customCreatureEffectSynthesis";
import { isStatusApplierAbilityName } from "../engine/effectDerivation";
import {
  canonicalizeAbilityValue,
  getAbilityValueOptions,
  type AbilityValueOption,
} from "../engine/abilityValueOptions";
import { STATUS_CATALOG } from "../engine/statusCatalog";

export type CustomCreaturesPageProps = {
  creatureNames: string[];
  getCreatureIcon: (name: string) => string | null;
  onNameAChange: (value: string) => void;
  onNameBChange: (value: string) => void;
  customCreatures: CustomCreatureRecord[];
};

// Editor steps (beta only). Each step shows one focused panel instead of the
// whole form at once, so the builder reads as a designed flow rather than a
// dump of every ability + status inline.
type EditorStep = "basics" | "abilities" | "statuses";
const EDITOR_STEP_DEFS: ReadonlyArray<{ key: EditorStep; label: string }> = [
  { key: "basics", label: "Basics" },
  { key: "abilities", label: "Abilities" },
  { key: "statuses", label: "Statuses" },
];

type EditableAbilityRef = {
  name: string;
  valueInput: string;
  semantics: string;
  subtype: string | null;
};

type EditableOtherAbility = {
  name: string;
  valueInput: string;
  semantics: string;
};

type EditableStatusEffect = {
  statusId: string;
  valueInput: string;
  sourceAbility: string;
};

type BuilderState = {
  editingOriginalName: string | null;
  name: string;
  iconName: string;
  stats: Record<
    | "tier"
    | "health"
    | "weight"
    | "damage"
    | "biteCooldown"
    | "damage2"
    | "healthRegen"
    | "stamina"
    | "stamRegen"
    | "walkAndSwimSpeed"
    | "sprintSpeed"
    | "turn"
    | "venerationRate"
    | "diet"
    | "type"
    | "mobilityOverride"
    | "breath"
    | "breathResistance",
    string
  >;
  passiveAbilities: EditableAbilityRef[];
  activatedAbilities: EditableAbilityRef[];
  breathAbilities: EditableAbilityRef[];
  otherAbilities: EditableOtherAbility[];
  /**
   * Custom-ability ids attached to this creature. Each one resolves
   * against the global user-ability registry at simulation start;
   * unknown ids drop silently. The engine consults
   * these per side) lives in the policy bridge.
   */
  userAbilityIds: string[];
  /** User-authored breath profile. null = use the named
   * breath (or none); non-null = custom breath, overrides the name lookup. */
  customBreathProfile: CustomBreathProfile | null;
  onHitStatuses: EditableStatusEffect[];
  onHitTakenStatuses: EditableStatusEffect[];
  resistStatuses: EditableStatusEffect[];
  preservedSpecialAbilitiesDetailed: NonNullable<EffectsCatalogByCreature["specialAbilitiesDetailed"]>;
  preservedSpecialAbilities: NonNullable<EffectsCatalogByCreature["specialAbilities"]>;
  appetiteValue: string;
};

type AbilityOption = {
  name: string;
  semantics: string;
  subtype: string | null;
  defaultValue: number | string | null;
  valueOptions: AbilityValueOption[];
};

type AbilityLibraryKind = "passive" | "activated" | "breath" | "other" | "user";

type AbilityLibraryOption = AbilityOption & {
  kind: AbilityLibraryKind;
  searchText: string;
  /** Set for `kind: "user"` entries - the engine id (`user.<name>`)
   * the row writes into `builder.userAbilityIds` when added. Other
   * kinds attach via `passiveAbilities` / `activatedAbilities` etc.
   * and don't need it. */
  userAbilityId?: string;
};

type SelectedAbilityEntry = EditableAbilityRef & {
  kind: AbilityLibraryKind;
};

type StatusApplicationKind = "onHit" | "onHitTaken" | "resist";

type SelectedStatusEntry = EditableStatusEffect & {
  kind: StatusApplicationKind;
  index: number;
};

type StatusPickerOption = {
  id: string;
  name: string;
  summary: string;
  details: string[];
  status: "Modeled" | "Partial";
  searchText: string;
};

type MessageState =
  | {
      kind: "success" | "error" | "warning";
      lines: string[];
    }
  | null;

const REQUIRED_STAT_FIELDS = [
  ["tier", "Tier"],
  ["health", "Health"],
  ["weight", "Weight"],
  ["damage", "Damage"],
  ["biteCooldown", "Bite Cooldown"],
  ["healthRegen", "Health Regen"],
] as const;

const OPTIONAL_STAT_FIELDS = [
  ["damage2", "Second Damage"],
  ["stamina", "Stamina"],
  ["stamRegen", "Stamina Regen"],
  ["walkAndSwimSpeed", "Walk / Swim Speed"],
  ["sprintSpeed", "Sprint Speed"],
  ["turn", "Turn"],
  ["venerationRate", "Veneration Rate"],
  ["diet", "Diet"],
  ["type", "Type"],
  ["mobilityOverride", "Mobility Override"],
  ["breath", "Breath"],
  ["breathResistance", "Breath Resistance"],
] as const;

const ABILITY_KIND_LABELS: Record<AbilityLibraryKind, string> = {
  passive: "Passive",
  activated: "Activated",
  breath: "Breath",
  other: "Effect",
  user: "Custom",
};

const ABILITY_KIND_PRIORITY: Record<AbilityLibraryKind, number> = {
  passive: 0,
  activated: 1,
  breath: 2,
  other: 3,
  user: 4,
};

const STATUS_KIND_LABELS: Record<StatusApplicationKind, string> = {
  onHit: "Offensive",
  onHitTaken: "Defensive",
  resist: "Block / Resist",
};

const EMPTY_STATS: BuilderState["stats"] = {
  tier: "1",
  health: "10000",
  weight: "10000",
  damage: "100",
  biteCooldown: "2",
  damage2: "",
  healthRegen: "",
  stamina: "",
  stamRegen: "",
  walkAndSwimSpeed: "",
  sprintSpeed: "",
  turn: "",
  venerationRate: "",
  diet: "",
  type: "",
  mobilityOverride: "",
  breath: "",
  breathResistance: "",
};

function normalizeKey(value: string): string {
  return normalizeCreatureSearchName(value);
}

function formatValueInput(value: number | string | null | undefined): string {
  if (value == null) return "";
  return String(value);
}

function parseValueInput(value: string): number | string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(trimmed) ? parsed : trimmed;
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mergeAbilityValueOptions(
  left: AbilityValueOption[],
  right: AbilityValueOption[],
): AbilityValueOption[] {
  const byValue = new Map<string, AbilityValueOption>();
  for (const option of [...left, ...right]) {
    const value = option.value.trim();
    if (!value) continue;
    byValue.set(value, option);
  }
  return [...byValue.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function makeAbilityRef(option: AbilityOption, valueInput?: string): EditableAbilityRef {
  const defaultValue = option.defaultValue ?? option.valueOptions[0]?.value ?? null;
  return {
    name: option.name,
    valueInput: valueInput ?? formatValueInput(defaultValue),
    semantics: option.semantics,
    subtype: option.subtype,
  };
}

function toEditableAbilityRef(ref: AbilityRef): EditableAbilityRef {
  return {
    name: ref.name,
    valueInput: formatValueInput(ref.value),
    semantics: ref.semantics,
    subtype: ref.subtype,
  };
}

function fromEditableAbilityRef(ref: EditableAbilityRef): AbilityRef {
  const parsedValue = parseValueInput(ref.valueInput);
  return {
    abilityId: ref.name,
    name: ref.name,
    value: canonicalizeAbilityValue(ref.name, parsedValue),
    semantics: ref.semantics,
    subtype: ref.subtype,
  };
}

function toEditableOtherAbility(entry: NonNullable<EffectsCatalogByCreature["otherAbilities"]>[number]): EditableOtherAbility {
  return {
    name: entry.name,
    valueInput: formatValueInput(entry.value),
    semantics: entry.semantics,
  };
}

function toEditableStatusEffect(
  entry:
    | NonNullable<EffectsCatalogByCreature["applyStatusOnHit"]>[number]
    | NonNullable<EffectsCatalogByCreature["applyStatusOnHitTaken"]>[number]
    | NonNullable<EffectsCatalogByCreature["resistStatus"]>[number],
): EditableStatusEffect {
  return {
    statusId: entry.statusId,
    valueInput: "stacks" in entry ? formatValueInput(entry.stacks) : formatValueInput(entry.fraction),
    sourceAbility: entry.sourceAbility,
  };
}

function createEmptyBuilderState(): BuilderState {
  return {
    editingOriginalName: null,
    name: "",
    iconName: "",
    stats: { ...EMPTY_STATS },
    passiveAbilities: [],
    activatedAbilities: [],
    breathAbilities: [],
    otherAbilities: [],
    userAbilityIds: [],
    customBreathProfile: null,
    onHitStatuses: [],
    onHitTakenStatuses: [],
    resistStatuses: [],
    preservedSpecialAbilitiesDetailed: [],
    preservedSpecialAbilities: [],
    appetiteValue: "",
  };
}

function buildBuilderStateFromRecord(record: CustomCreatureRecord): BuilderState {
  const { creature, effects, appetite, iconName } = record;
  const mirroredAbilityNames = new Set(
    [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? []), ...(creature.breathAbilities ?? [])].map((entry) =>
      normalizeKey(entry.name),
    ),
  );
  return {
    editingOriginalName: creature.name,
    name: creature.name,
    iconName: iconName ?? "",
    stats: {
      tier: formatValueInput(creature.stats.tier),
      health: formatValueInput(creature.stats.health),
      weight: formatValueInput(creature.stats.weight),
      damage: formatValueInput(creature.stats.damage),
      biteCooldown: formatValueInput(creature.stats.biteCooldown),
      damage2: formatValueInput(creature.stats.damage2),
      healthRegen: formatValueInput(creature.stats.healthRegen),
      stamina: formatValueInput(creature.stats.stamina),
      stamRegen: formatValueInput(creature.stats.stamRegen),
      walkAndSwimSpeed: formatValueInput(creature.stats.walkAndSwimSpeed),
      sprintSpeed: formatValueInput(creature.stats.sprintSpeed),
      turn: formatValueInput(creature.stats.turn),
      venerationRate: formatValueInput(creature.stats.venerationRate),
      diet: creature.stats.diet ?? "",
      type: creature.stats.type ?? "",
      mobilityOverride: creature.stats.mobilityOverride ?? "",
      breath: creature.stats.breath ?? "",
      breathResistance: formatValueInput(creature.stats.breathResistance),
    },
    // Status-applier abilities (Bleed Attack / Defensive X / Block X) are hidden
    // from the ability lists on load: their effect is already carried by the
    // derived status rows below (present for both saved customs and built-in
    // bases, which both go through status derivation). So a loaded creature has
    // one canonical entry per effect, matching what the picker now allows.
    passiveAbilities: (creature.passiveAbilities ?? []).filter((e) => !isStatusApplierAbilityName(e.name)).map(toEditableAbilityRef),
    activatedAbilities: (creature.activatedAbilities ?? []).filter((e) => !isStatusApplierAbilityName(e.name)).map(toEditableAbilityRef),
    breathAbilities: (creature.breathAbilities ?? []).filter((e) => !isStatusApplierAbilityName(e.name)).map(toEditableAbilityRef),
    userAbilityIds: [...(creature.userAbilityIds ?? [])],
    customBreathProfile: creature.customBreathProfile ?? null,
    otherAbilities: (effects.otherAbilities ?? [])
      .filter((entry) => !mirroredAbilityNames.has(normalizeKey(entry.name)) && !isStatusApplierAbilityName(entry.name))
      .map(toEditableOtherAbility),
    onHitStatuses: (effects.applyStatusOnHit ?? []).map(toEditableStatusEffect),
    onHitTakenStatuses: (effects.applyStatusOnHitTaken ?? []).map(toEditableStatusEffect),
    resistStatuses: (effects.resistStatus ?? []).map(toEditableStatusEffect),
    preservedSpecialAbilitiesDetailed: [...(effects.specialAbilitiesDetailed ?? [])],
    preservedSpecialAbilities: [...(effects.specialAbilities ?? [])],
    appetiteValue: appetite ? formatValueInput(appetite.appetite) : "",
  };
}

function createRecordFromExistingCreature(name: string): CustomCreatureRecord | null {
  const creature = creatureByName[name];
  if (!creature) return null;
  return {
    creature,
    effects: effectsCatalog[name] ?? {},
    appetite: getCompareAppetiteEntry(name),
    iconName: name,
    iconDataUrl: null,
    createdAt: Date.now(),
  };
}

function collectSupportedAbilityOptions(): AbilityLibraryOption[] {
  const byKey = new Map<string, AbilityLibraryOption>();
  const addOption = (
    kind: AbilityLibraryKind,
    option: {
      name: string;
      semantics: string;
      subtype?: string | null;
      defaultValue?: number | string | null;
    },
  ) => {
    // Status-applier abilities are entered canonically in the Statuses tab, not
    // here - keeps one effect from being addable as both an ability and a status.
    if (isStatusApplierAbilityName(option.name)) return;
    const normalizedName = normalizeKey(option.name);
    const existing = byKey.get(normalizedName);
    const valueOptions = getAbilityValueOptions(
      option.name,
      typeof option.defaultValue === "string" ? [option.defaultValue] : [],
    );
    if (existing && ABILITY_KIND_PRIORITY[existing.kind] <= ABILITY_KIND_PRIORITY[kind]) {
      existing.valueOptions = mergeAbilityValueOptions(existing.valueOptions, valueOptions);
      if (existing.defaultValue == null && option.defaultValue != null) {
        existing.defaultValue = option.defaultValue;
      }
      existing.searchText = `${existing.searchText} ${valueOptions.map((value) => value.label).join(" ")}`.toLowerCase();
      return;
    }
    byKey.set(normalizedName, {
      name: option.name,
      semantics: option.semantics,
      subtype: option.subtype ?? null,
      defaultValue: option.defaultValue ?? null,
      valueOptions,
      kind,
      searchText: `${option.name} ${ABILITY_KIND_LABELS[kind]} ${option.semantics} ${option.subtype ?? ""} ${valueOptions.map((value) => value.label).join(" ")}`.toLowerCase(),
    });
  };

  for (const creature of creaturesData) {
    for (const entry of creature.passiveAbilities ?? []) {
      addOption("passive", {
        name: entry.name,
        semantics: entry.semantics,
        subtype: entry.subtype,
        defaultValue: entry.value,
      });
    }
    for (const entry of creature.activatedAbilities ?? []) {
      addOption("activated", {
        name: entry.name,
        semantics: entry.semantics,
        subtype: entry.subtype,
        defaultValue: entry.value,
      });
    }
    for (const entry of creature.breathAbilities ?? []) {
      addOption("breath", {
        name: entry.name,
        semantics: entry.semantics,
        subtype: entry.subtype,
        defaultValue: entry.value,
      });
    }
  }

  for (const effects of Object.values(effectsCatalog)) {
    for (const entry of effects.otherAbilities ?? []) {
      addOption("other", {
        name: entry.name,
        semantics: entry.semantics,
        defaultValue: entry.value,
      });
    }
    for (const entry of effects.specialAbilities ?? []) {
      addOption("other", {
        name: entry.name,
        semantics: "neutral",
        defaultValue: entry.value,
      });
    }
    for (const entry of effects.specialAbilitiesDetailed ?? []) {
      addOption("other", {
        name: entry.name,
        semantics: "neutral",
        defaultValue: entry.value,
      });
    }
  }

  return [...byKey.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function collectStatusOptions(): StatusPickerOption[] {
  // (2026-05-18): consume the shared `statusCatalog` directly.
  // Before this refactor the picker maintained its own two-stage
  // filter (Reference modeled/partial x runtime catalog membership)
  // which silently dropped statuses whose wiki-sync runtime entry
  // was missing - exactly the symptom reported on the
  // Lich Mark dropdown (engine knew Burn, but the picker didn't).
  // The catalog is the single source of truth: every entry there
  // has a resolved engine id by construction.
  return STATUS_CATALOG.map((entry) => ({
    id: entry.id,
    name: entry.name,
    summary: entry.summary,
    details: (entry.mechanics ?? []).slice(0, 2),
    status: entry.referenceStatus,
    searchText: `${entry.name} ${entry.summary} ${(entry.mechanics ?? []).join(" ")}`.toLowerCase(),
  }));
}

function addOrIgnoreAbility(current: EditableAbilityRef[], next: EditableAbilityRef): EditableAbilityRef[] {
  if (current.some((entry) => normalizeKey(entry.name) === normalizeKey(next.name))) return current;
  return [...current, next].sort((left, right) => left.name.localeCompare(right.name));
}

function removeAbilityByName(current: EditableAbilityRef[], name: string): EditableAbilityRef[] {
  return current.filter((entry) => normalizeKey(entry.name) !== normalizeKey(name));
}

function hasAbilityInBuilder(builder: BuilderState, name: string): boolean {
  const key = normalizeKey(name);
  return (
    builder.passiveAbilities.some((entry) => normalizeKey(entry.name) === key) ||
    builder.activatedAbilities.some((entry) => normalizeKey(entry.name) === key) ||
    builder.breathAbilities.some((entry) => normalizeKey(entry.name) === key) ||
    builder.otherAbilities.some((entry) => normalizeKey(entry.name) === key)
  );
}

function collectSelectedAbilities(builder: BuilderState): SelectedAbilityEntry[] {
  return [
    ...builder.passiveAbilities.map((entry) => ({ ...entry, kind: "passive" as const })),
    ...builder.activatedAbilities.map((entry) => ({ ...entry, kind: "activated" as const })),
    ...builder.breathAbilities.map((entry) => ({ ...entry, kind: "breath" as const })),
    ...builder.otherAbilities.map((entry) => ({
      name: entry.name,
      valueInput: entry.valueInput,
      semantics: entry.semantics,
      subtype: null,
      kind: "other" as const,
    })),
  ].sort((left, right) =>
    left.name === right.name
      ? ABILITY_KIND_LABELS[left.kind].localeCompare(ABILITY_KIND_LABELS[right.kind])
      : left.name.localeCompare(right.name),
  );
}

function collectSelectedStatuses(builder: BuilderState): SelectedStatusEntry[] {
  return [
    ...builder.onHitStatuses.map((entry, index) => ({ ...entry, kind: "onHit" as const, index })),
    ...builder.onHitTakenStatuses.map((entry, index) => ({ ...entry, kind: "onHitTaken" as const, index })),
    ...builder.resistStatuses.map((entry, index) => ({ ...entry, kind: "resist" as const, index })),
  ];
}

function buildAbilityMetaText(entry: {
  kind: AbilityLibraryKind;
  semantics: string;
  subtype: string | null;
  defaultValue?: number | string | null;
  valueOptions?: AbilityValueOption[];
}): string {
  const parts: string[] = [];
  if (entry.kind !== "other") parts.push(ABILITY_KIND_LABELS[entry.kind]);
  if (entry.semantics) parts.push(entry.semantics);
  if (entry.subtype) parts.push(entry.subtype);
  if (entry.defaultValue != null && entry.defaultValue !== "") parts.push(`default ${String(entry.defaultValue)}`);
  if (entry.valueOptions && entry.valueOptions.length > 0) parts.push(`${entry.valueOptions.length} selectable values`);
  return parts.join(" | ");
}

function mergeNamedOtherAbilities(
  autoEntries: Array<{ name: string; value: number | string | null; semantics: string }>,
  manualEntries: EditableOtherAbility[],
): NonNullable<EffectsCatalogByCreature["otherAbilities"]> {
  const byName = new Map<string, { name: string; value: number | string | null; semantics: string }>();
  for (const entry of autoEntries) byName.set(normalizeKey(entry.name), entry);
  for (const entry of manualEntries) {
    const parsedValue = parseValueInput(entry.valueInput);
    byName.set(normalizeKey(entry.name), {
      name: entry.name,
      value: canonicalizeAbilityValue(entry.name, parsedValue),
      semantics: entry.semantics,
    });
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function mergeStatusEntries(
  autoEntries: Array<{ statusId: string; value: number; sourceAbility: string }>,
  manualEntries: EditableStatusEffect[],
  keyLabel: "stacks" | "fraction",
): Array<{ statusId: string; sourceAbility: string } & ({ stacks: number } | { fraction: number })> {
  const byKey = new Map<string, { statusId: string; sourceAbility: string } & ({ stacks: number } | { fraction: number })>();
  for (const entry of autoEntries) {
    byKey.set(`${entry.statusId}::${normalizeKey(entry.sourceAbility)}`, {
      statusId: entry.statusId,
      sourceAbility: entry.sourceAbility,
      [keyLabel]: entry.value,
    } as { statusId: string; sourceAbility: string } & ({ stacks: number } | { fraction: number }));
  }
  for (const entry of manualEntries) {
    const parsed = Number(entry.valueInput);
    if (!Number.isFinite(parsed)) continue;
    byKey.set(`${entry.statusId}::${normalizeKey(entry.sourceAbility)}`, {
      statusId: entry.statusId,
      sourceAbility: entry.sourceAbility,
      [keyLabel]: parsed,
    } as { statusId: string; sourceAbility: string } & ({ stacks: number } | { fraction: number }));
  }
  return [...byKey.values()];
}

function buildRecordFromBuilder(builder: BuilderState): {
  record?: {
    creature: CreatureRuntime;
    effects: EffectsCatalogByCreature;
    appetite: CompareAppetiteEntry | null;
    iconName: string | null;
  };
  error?: string;
} {
  const name = builder.name.trim();
  if (!name) return { error: "Creature name is required." };

  const tier = Number(builder.stats.tier);
  const health = Number(builder.stats.health);
  const weight = Number(builder.stats.weight);
  const damage = Number(builder.stats.damage);
  const biteCooldown = Number(builder.stats.biteCooldown);
  if (![tier, health, weight, damage, biteCooldown].every(Number.isFinite)) {
    return { error: "Tier, health, weight, damage, and bite cooldown are required." };
  }

  const passiveAbilities = builder.passiveAbilities.map(fromEditableAbilityRef);
  const activatedAbilities = builder.activatedAbilities.map(fromEditableAbilityRef);
  const breathAbilities = builder.breathAbilities.map(fromEditableAbilityRef);
  // A custom breath profile forces a non-empty breath name (so `hasBreath`
  // is true and the sim fires breath); the name itself is irrelevant -
  // `toRustBreathProfile` early-returns the custom profile before the
  // breath-type lookup. Falls back to "Custom" if the user left it blank.
  const resolvedBreath = builder.customBreathProfile
    ? builder.stats.breath.trim() || "Custom"
    : builder.stats.breath.trim() || (breathAbilities.length === 1 ? breathAbilities[0].name : "");

  const creature: CreatureRuntime = {
    name,
    stats: {
      tier,
      health,
      weight,
      damage,
      biteCooldown,
      ...(parseOptionalNumber(builder.stats.damage2) != null ? { damage2: parseOptionalNumber(builder.stats.damage2) } : {}),
      ...(parseOptionalNumber(builder.stats.healthRegen) != null ? { healthRegen: parseOptionalNumber(builder.stats.healthRegen) } : {}),
      ...(parseOptionalNumber(builder.stats.stamina) != null ? { stamina: parseOptionalNumber(builder.stats.stamina) } : {}),
      ...(parseOptionalNumber(builder.stats.stamRegen) != null ? { stamRegen: parseOptionalNumber(builder.stats.stamRegen) } : {}),
      ...(parseOptionalNumber(builder.stats.walkAndSwimSpeed) != null ? { walkAndSwimSpeed: parseOptionalNumber(builder.stats.walkAndSwimSpeed) } : {}),
      ...(parseOptionalNumber(builder.stats.sprintSpeed) != null ? { sprintSpeed: parseOptionalNumber(builder.stats.sprintSpeed) } : {}),
      ...(parseOptionalNumber(builder.stats.turn) != null ? { turn: parseOptionalNumber(builder.stats.turn) } : {}),
      ...(parseOptionalNumber(builder.stats.venerationRate) != null ? { venerationRate: parseOptionalNumber(builder.stats.venerationRate) } : {}),
      ...(builder.stats.diet.trim() ? { diet: builder.stats.diet.trim() } : {}),
      ...(builder.stats.type.trim() ? { type: builder.stats.type.trim() } : {}),
      ...(builder.stats.mobilityOverride.trim() ? { mobilityOverride: builder.stats.mobilityOverride.trim() } : {}),
      ...(resolvedBreath ? { breath: resolvedBreath } : {}),
      ...(parseOptionalNumber(builder.stats.breathResistance) != null ? { breathResistance: parseOptionalNumber(builder.stats.breathResistance) } : {}),
    },
    ...(passiveAbilities.length > 0 ? { passiveAbilities } : {}),
    ...(activatedAbilities.length > 0 ? { activatedAbilities } : {}),
    ...(breathAbilities.length > 0 ? { breathAbilities } : {}),
    ...(builder.userAbilityIds.length > 0
      ? { userAbilityIds: [...builder.userAbilityIds] }
      : {}),
    ...(builder.customBreathProfile
      ? { customBreathProfile: builder.customBreathProfile }
      : {}),
  };

  // Canonical creatures keep their modeled abilities (passive AND activated)
  // in effects.otherAbilities with this exact shape. Coverage and the engine
  // both read from there. Mirroring all three kinds keeps custom creatures on
  // the same path so a picked activated ability like Hunters Curse is found
  // and shown as modeled instead of falling through to "not-modeled".
  const mirroredAbilityOtherEntries = [
    ...passiveAbilities,
    ...activatedAbilities,
    ...breathAbilities,
  ].map((entry) => ({
    name: entry.name,
    value: entry.value,
    semantics: entry.semantics,
  }));
  const allowedPreservedAbilityNames = new Set(
    [
      ...passiveAbilities.map((entry) => normalizeKey(entry.name)),
      ...activatedAbilities.map((entry) => normalizeKey(entry.name)),
      ...breathAbilities.map((entry) => normalizeKey(entry.name)),
      ...builder.otherAbilities.map((entry) => normalizeKey(entry.name)),
    ],
  );

  const effects: EffectsCatalogByCreature = synthesizeCustomCreatureEffects(creature, {
    ...(builder.preservedSpecialAbilitiesDetailed.length > 0
      ? {
          specialAbilitiesDetailed: builder.preservedSpecialAbilitiesDetailed.filter(
            (entry: NonNullable<EffectsCatalogByCreature["specialAbilitiesDetailed"]>[number]) =>
              allowedPreservedAbilityNames.has(normalizeKey(entry.name)),
          ),
        }
      : {}),
    ...(builder.preservedSpecialAbilities.length > 0
      ? {
          specialAbilities: builder.preservedSpecialAbilities.filter(
            (entry: NonNullable<EffectsCatalogByCreature["specialAbilities"]>[number]) =>
              allowedPreservedAbilityNames.has(normalizeKey(entry.name)),
          ),
        }
      : {}),
    otherAbilities: mergeNamedOtherAbilities(mirroredAbilityOtherEntries, builder.otherAbilities),
    applyStatusOnHit: mergeStatusEntries([], builder.onHitStatuses, "stacks") as NonNullable<EffectsCatalogByCreature["applyStatusOnHit"]>,
    applyStatusOnHitTaken: mergeStatusEntries([], builder.onHitTakenStatuses, "stacks") as NonNullable<EffectsCatalogByCreature["applyStatusOnHitTaken"]>,
    resistStatus: mergeStatusEntries([], builder.resistStatuses, "fraction") as NonNullable<EffectsCatalogByCreature["resistStatus"]>,
  });

  const appetiteParsed = Number(builder.appetiteValue);
  const appetite =
    builder.appetiteValue.trim() && Number.isFinite(appetiteParsed)
      ? { appetite: appetiteParsed }
      : null;

  return { record: { creature, effects, appetite, iconName: builder.iconName.trim() || null } };
}

function findStatusName(statusOptions: StatusPickerOption[], statusId: string): string {
  return statusOptions.find((status) => status.id === statusId)?.name ?? statusId;
}

export default function CustomCreaturesPage({
  creatureNames,
  getCreatureIcon,
  onNameAChange,
  onNameBChange,
  customCreatures,
}: CustomCreaturesPageProps) {
  const templateNameId = useId();
  const customNameId = useId();
  const iconSourceId = useId();
  const lastCodeId = useId();
  const importCodeId = useId();
  const [builder, setBuilder] = useState<BuilderState>(createEmptyBuilderState());
  // Landing (list of created creatures) vs the editor (the builder form), so the
  // Creatures tab matches the Abilities / Timings / Statuses flow.
  const [view, setView] = useState<"list" | "editor">("list");
  // Beta editor only: which focused step is showing. Classic ignores this and
  // renders every section at once (see `stepped` below).
  const [step, setStep] = useState<EditorStep>("basics");
  // Classic editor renders every section at once (no stepping). The step
  // machinery is retained but inert; the beta editor (CustomCreaturesBeta) owns
  // the stepped flow.
  const stepped = false;
  const showStep = (key: EditorStep) => !stepped || step === key;
  const [message, setMessage] = useState<MessageState>(null);
  const openNewCreature = () => {
    setBuilder(createEmptyBuilderState());
    setMessage(null);
    setStep("basics");
    setView("editor");
  };
  const openEditCreature = (record: CustomCreatureRecord) => {
    setBuilder(buildBuilderStateFromRecord(record));
    setMessage(null);
    setStep("basics");
    setView("editor");
  };
  const [templateName, setTemplateName] = useState("");
  const [showAdvancedStats, setShowAdvancedStats] = useState(false);
  const [lastCode, setLastCode] = useState("");
  const [importCode, setImportCode] = useState("");
  const [abilitySearch, setAbilitySearch] = useState("");
  const [abilityKindFilter, setAbilityKindFilter] = useState<AbilityLibraryKind | "all">("all");
  const [statusSearch, setStatusSearch] = useState("");
  const [statusDraft, setStatusDraft] = useState({
    kind: "onHit" as StatusApplicationKind,
    value: "1",
  });
  const [customAbilityRecords, setCustomAbilityRecords] = useState<
    CustomAbilityRecord[]
  >(() => listCustomAbilityRecords());
  useEffect(() => {
    return subscribeCustomAbilityRegistry(() => {
      setCustomAbilityRecords(listCustomAbilityRecords());
    });
  }, []);

  const abilityOptions = useMemo(() => {
    const builtIn = collectSupportedAbilityOptions();
    // Append user-authored abilities so they appear in the same
    // picker. Their `kind: "user"` flag drives both the filter chip
    // and the add-handler branch (writes to userAbilityIds instead
    // of the kind-bucketed ability lists).
    const userOptions: AbilityLibraryOption[] = customAbilityRecords.map((record) => {
      const id = record.spec.id;
      const name = record.spec.display_name || id;
      const semantics =
        "Custom-authored ability - runs through the engine's user-ability dispatch.";
      return {
        name,
        semantics,
        subtype: null,
        defaultValue: null,
        valueOptions: [],
        kind: "user",
        userAbilityId: id,
        searchText: `${name} ${id} custom user`.toLowerCase(),
      };
    });
    return [...builtIn, ...userOptions];
  }, [customAbilityRecords]);
  const abilityValueOptionsByName = useMemo(
    () => new Map(abilityOptions.map((option) => [normalizeKey(option.name), option.valueOptions])),
    [abilityOptions],
  );
  const statusOptions = useMemo(() => collectStatusOptions(), []);
  const selectedAbilities = useMemo(() => collectSelectedAbilities(builder), [builder]);
  const selectedStatuses = useMemo(() => collectSelectedStatuses(builder), [builder]);
  const appetiteRequired =
    builder.passiveAbilities.some((entry) => entry.name === "Gourmandizer") ||
    builder.activatedAbilities.some((entry) => entry.name === "Reflux");
  const filteredAbilityOptions = useMemo(() => {
    const query = abilitySearch.trim().toLowerCase();
    return abilityOptions
      .filter((entry) => abilityKindFilter === "all" || entry.kind === abilityKindFilter)
      .filter((entry) => {
        // User-kind options de-dup by id (name may collide); other
        // kinds use the legacy name-based check.
        if (entry.kind === "user") {
          return entry.userAbilityId
            ? !builder.userAbilityIds.includes(entry.userAbilityId)
            : true;
        }
        return !hasAbilityInBuilder(builder, entry.name);
      })
      .filter((entry) => !query || entry.searchText.includes(query));
  }, [abilityKindFilter, abilityOptions, abilitySearch, builder]);
  const filteredStatusOptions = useMemo(() => {
    const query = statusSearch.trim().toLowerCase();
    return statusOptions.filter((entry) => !query || entry.searchText.includes(query));
  }, [statusOptions, statusSearch]);

  const loadTemplate = (name: string) => {
    const customRecord = getCustomCreatureRecord(name);
    const templateRecord = customRecord ?? createRecordFromExistingCreature(name);
    if (!templateRecord) {
      setMessage({ kind: "error", lines: [`Could not load template "${name}".`] });
      return;
    }
    setBuilder(buildBuilderStateFromRecord(templateRecord));
    setTemplateName(name);
    setMessage({ kind: "success", lines: [`Loaded "${name}" into the editor.`] });
  };

  const addAbilityOption = (option: AbilityLibraryOption) => {
    // User-authored abilities live on a separate field
    // (`builder.userAbilityIds`). They share the same picker UI but
    // a different attach path. Bail early once they're attached.
    if (option.kind === "user" && option.userAbilityId) {
      if (builder.userAbilityIds.includes(option.userAbilityId)) {
        setMessage({ kind: "warning", lines: [`"${option.name}" is already attached.`] });
        return;
      }
      setBuilder((current) => ({
        ...current,
        userAbilityIds: [...current.userAbilityIds, option.userAbilityId!],
      }));
      setMessage(null);
      return;
    }
    if (hasAbilityInBuilder(builder, option.name)) {
      setMessage({ kind: "warning", lines: [`"${option.name}" is already added.`] });
      return;
    }
    setBuilder((current) => ({
      ...current,
      passiveAbilities:
        option.kind === "passive" ? addOrIgnoreAbility(current.passiveAbilities, makeAbilityRef(option)) : current.passiveAbilities,
      activatedAbilities:
        option.kind === "activated" ? addOrIgnoreAbility(current.activatedAbilities, makeAbilityRef(option)) : current.activatedAbilities,
      breathAbilities:
        option.kind === "breath" ? addOrIgnoreAbility(current.breathAbilities, makeAbilityRef(option)) : current.breathAbilities,
      otherAbilities:
        option.kind === "other"
          ? current.otherAbilities.some((entry) => normalizeKey(entry.name) === normalizeKey(option.name))
            ? current.otherAbilities
            : [
                ...current.otherAbilities,
                {
                  name: option.name,
                  valueInput: formatValueInput(option.defaultValue ?? option.valueOptions[0]?.value ?? null),
                  semantics: option.semantics,
                },
              ].sort((left, right) => left.name.localeCompare(right.name))
          : current.otherAbilities,
      stats:
        option.kind === "breath" && !current.stats.breath.trim() && current.breathAbilities.length === 0
          ? { ...current.stats, breath: option.name }
          : current.stats,
    }));
    setMessage(null);
  };

  const updateSelectedAbilityValue = (entry: SelectedAbilityEntry, nextValue: string) => {
    setBuilder((current) => ({
      ...current,
      passiveAbilities:
        entry.kind === "passive"
          ? current.passiveAbilities.map((item) => (item.name === entry.name ? { ...item, valueInput: nextValue } : item))
          : current.passiveAbilities,
      activatedAbilities:
        entry.kind === "activated"
          ? current.activatedAbilities.map((item) => (item.name === entry.name ? { ...item, valueInput: nextValue } : item))
          : current.activatedAbilities,
      breathAbilities:
        entry.kind === "breath"
          ? current.breathAbilities.map((item) => (item.name === entry.name ? { ...item, valueInput: nextValue } : item))
          : current.breathAbilities,
      otherAbilities:
        entry.kind === "other"
          ? current.otherAbilities.map((item) => (item.name === entry.name ? { ...item, valueInput: nextValue } : item))
          : current.otherAbilities,
    }));
  };

  const removeSelectedAbility = (entry: SelectedAbilityEntry) => {
    setBuilder((current) => ({
      ...current,
      passiveAbilities: entry.kind === "passive" ? removeAbilityByName(current.passiveAbilities, entry.name) : current.passiveAbilities,
      activatedAbilities:
        entry.kind === "activated" ? removeAbilityByName(current.activatedAbilities, entry.name) : current.activatedAbilities,
      breathAbilities: entry.kind === "breath" ? removeAbilityByName(current.breathAbilities, entry.name) : current.breathAbilities,
      otherAbilities:
        entry.kind === "other"
          ? current.otherAbilities.filter((item) => normalizeKey(item.name) !== normalizeKey(entry.name))
          : current.otherAbilities,
    }));
  };

  const getSelectedAbilityValueOptions = (entry: SelectedAbilityEntry): AbilityValueOption[] => {
    const base = abilityValueOptionsByName.get(normalizeKey(entry.name)) ?? getAbilityValueOptions(entry.name);
    // If the ability has no curated or discovered options (everything outside
    // the Yolk Bomb curated list - First Strike, Block_*, Defensive_Burn,
    // numeric-value abilities, etc.), do NOT synthesize a single dropdown
    // option from `entry.valueInput`. Returning [] keeps free-form numeric
    // entry via the <input> branch instead of locking the field into a
    // <select> with one bogus item ("0", "0.2", whatever the default
    // happened to be).
    if (base.length === 0) return [];
    if (!entry.valueInput.trim() || base.some((option) => option.value === entry.valueInput)) return base;
    return mergeAbilityValueOptions(base, [{ value: entry.valueInput, label: entry.valueInput }]);
  };

  const addStatusEffect = (statusId: string) => {
    const kind = statusDraft.kind;
    const valueInput = statusDraft.value;
    // Intrinsic by default (empty source = always applied, not bound to any one
    // ability toggle). Previously every effect was silently stamped with the
    // first ability alphabetically, so a creature's whole status kit hung off
    // one ability - disabling that ability stripped everything. The user now
    // assigns a source per effect via the Source picker on each row below.
    const sourceAbility = "";
    if (!statusId) {
      setMessage({ kind: "error", lines: ["Pick a status first."] });
      return;
    }
    const nextEntry = { statusId, valueInput, sourceAbility };
    const currentEntries =
      kind === "onHit" ? builder.onHitStatuses : kind === "onHitTaken" ? builder.onHitTakenStatuses : builder.resistStatuses;
    if (
      currentEntries.some(
        (entry) =>
          entry.statusId === nextEntry.statusId && normalizeKey(entry.sourceAbility) === normalizeKey(nextEntry.sourceAbility),
      )
    ) {
      setMessage({ kind: "warning", lines: [`"${findStatusName(statusOptions, statusId)}" is already added for this application type.`] });
      return;
    }
    setBuilder((current) =>
      kind === "onHit"
        ? { ...current, onHitStatuses: [...current.onHitStatuses, nextEntry] }
        : kind === "onHitTaken"
          ? { ...current, onHitTakenStatuses: [...current.onHitTakenStatuses, nextEntry] }
          : { ...current, resistStatuses: [...current.resistStatuses, nextEntry] },
    );
    setMessage(null);
  };

  const updateSelectedStatus = (entry: SelectedStatusEntry, patch: Partial<EditableStatusEffect>) => {
    setBuilder((current) => ({
      ...current,
      onHitStatuses:
        entry.kind === "onHit"
          ? current.onHitStatuses.map((item, index) => (index === entry.index ? { ...item, ...patch } : item))
          : current.onHitStatuses,
      onHitTakenStatuses:
        entry.kind === "onHitTaken"
          ? current.onHitTakenStatuses.map((item, index) => (index === entry.index ? { ...item, ...patch } : item))
          : current.onHitTakenStatuses,
      resistStatuses:
        entry.kind === "resist"
          ? current.resistStatuses.map((item, index) => (index === entry.index ? { ...item, ...patch } : item))
          : current.resistStatuses,
    }));
  };

  const removeSelectedStatus = (entry: SelectedStatusEntry) => {
    setBuilder((current) => ({
      ...current,
      onHitStatuses:
        entry.kind === "onHit" ? current.onHitStatuses.filter((_, index) => index !== entry.index) : current.onHitStatuses,
      onHitTakenStatuses:
        entry.kind === "onHitTaken"
          ? current.onHitTakenStatuses.filter((_, index) => index !== entry.index)
          : current.onHitTakenStatuses,
      resistStatuses:
        entry.kind === "resist" ? current.resistStatuses.filter((_, index) => index !== entry.index) : current.resistStatuses,
    }));
  };

  const createOrUpdate = async () => {
    const built = buildRecordFromBuilder(builder);
    if (!built.record) {
      setMessage({ kind: "error", lines: [built.error ?? "Custom creature could not be built."] });
      return;
    }
    const originalName = builder.editingOriginalName;
    if (originalName && originalName !== built.record.creature.name) {
      unregisterCustomCreatureRecord(originalName);
    }
    const result = await registerCustomCreatureRecord(built.record, {
      replace: Boolean(originalName && originalName === built.record.creature.name),
    });
    if (!result.ok) {
      setMessage({ kind: "error", lines: [result.error ?? "Custom creature could not be registered."] });
      return;
    }
    const code = encodeCustomCreatureCode(built.record);
    setLastCode(code);
    try {
      await navigator.clipboard.writeText(code);
      setMessage({
        kind: result.warnings.length > 0 ? "warning" : "success",
        lines: [
          `${originalName ? "Updated" : "Created"} "${built.record.creature.name}".`,
          "Saved to this browser - it stays after a reload. Its code is for sharing the creature or moving it to another device.",
          "The code was also copied to your clipboard.",
          ...result.warnings,
        ],
      });
    } catch {
      setMessage({
        kind: result.warnings.length > 0 ? "warning" : "success",
        lines: [
          `${originalName ? "Updated" : "Created"} "${built.record.creature.name}".`,
          "Saved to this browser - it stays after a reload. Its code is for sharing the creature or moving it to another device.",
          ...result.warnings,
        ],
      });
    }
    setBuilder((current) => ({ ...current, editingOriginalName: built.record!.creature.name }));
    // Saved -> back to the landing, where the new/updated creature now appears.
    setView("list");
  };

  // Copy a shareable code for the *current* builder without saving first, so the
  // export action in the preview pane works even before the first Save.
  const copyCurrentCode = async () => {
    const built = buildRecordFromBuilder(builder);
    if (!built.record) {
      setMessage({ kind: "error", lines: [built.error ?? "Custom creature could not be built."] });
      return;
    }
    const code = encodeCustomCreatureCode(built.record);
    setLastCode(code);
    try {
      await navigator.clipboard.writeText(code);
      setMessage({ kind: "success", lines: ["Creature code copied to your clipboard."] });
    } catch {
      setMessage({ kind: "warning", lines: ["Could not copy automatically — copy it from the code box below the preview."] });
    }
  };

  const importCreatureCode = async () => {
    const decoded = decodeCustomCreatureCode(importCode);
    if (!decoded.ok || !decoded.payload) {
      setMessage({ kind: "error", lines: [decoded.error ?? "Custom creature code is invalid."] });
      return;
    }
    const result = await registerCustomCreatureRecord(decoded.payload, {
      replace: Boolean(getCustomCreatureRecord(decoded.payload.creature.name)),
    });
    if (!result.ok) {
      setMessage({ kind: "error", lines: [result.error ?? "Custom creature could not be imported."] });
      return;
    }
    setBuilder(
      buildBuilderStateFromRecord({
        creature: decoded.payload.creature,
        effects: decoded.payload.effects,
        appetite: decoded.payload.appetite,
        iconName: decoded.payload.iconName,
        iconDataUrl: null,
        createdAt: Date.now(),
      }),
    );
    setLastCode(importCode.trim());
    setMessage({
      kind: result.warnings.length > 0 ? "warning" : "success",
      lines: [
        `Imported "${decoded.payload.creature.name}".`,
        "Saved to this browser. Keep its code to share it or move it to another device.",
        ...result.warnings,
      ],
    });
  };

  return (
    <section className="panel custom-creatures-builder">
      {message ? (
        <div className={`custom-creature-message ${message.kind}`}>
          {message.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : null}

      {view === "editor" ? (
        <div className="cc-editor">
          <div className="cc-editor__bar">
            <button type="button" className="secondary cc-editor__back" onClick={() => setView("list")}>
              ← Back to creatures
            </button>
            <span className="cc-editor__title">
              {builder.editingOriginalName ? `Editing “${builder.editingOriginalName}”` : "New creature"}
            </span>
            <button type="button" className="primary cc-editor__save" onClick={() => void createOrUpdate()}>
              {builder.editingOriginalName ? "Save changes" : "Add creature"}
            </button>
          </div>
          {stepped ? (
            <nav className="cc-steps" aria-label="Creature editor sections">
              {EDITOR_STEP_DEFS.map((def) => {
                const count =
                  def.key === "abilities"
                    ? selectedAbilities.length + builder.userAbilityIds.length
                    : def.key === "statuses"
                      ? selectedStatuses.length
                      : null;
                return (
                  <button
                    key={def.key}
                    type="button"
                    className={step === def.key ? "cc-step active" : "cc-step"}
                    onClick={() => setStep(def.key)}
                    aria-current={step === def.key ? "step" : undefined}
                  >
                    <span className="cc-step__label">{def.label}</span>
                    {count != null && count > 0 ? <span className="cc-step__count">{count}</span> : null}
                  </button>
                );
              })}
            </nav>
          ) : null}
          <div className="cc-editor__panes">
          <div className="cc-editor__form">
          <div className="panel-block">
          {showStep("basics") ? (
          <div className="cc-editor__top">
            <div className="custom-creature-editor-section cc-section--identity">
              <h4>Identity</h4>
              <div className="cc-identity-grid">
                <div className="field">
                  <label htmlFor={customNameId}>Creature name</label>
                  <input
                    id={customNameId}
                    value={builder.name}
                    onChange={(event) => setBuilder((current) => ({ ...current, name: event.target.value }))}
                    placeholder="My Custom Creature"
                  />
                </div>
                <div className="field">
                  <label htmlFor={iconSourceId}>Icon source</label>
                  <CreatureNameInput
                    id={iconSourceId}
                    value={builder.iconName}
                    onChange={(value) => setBuilder((current) => ({ ...current, iconName: value }))}
                    creatureNames={creatureNames}
                    placeholder="Borrow an existing creature's icon (optional)"
                    maxSuggestions={6}
                  />
                </div>
              </div>
              {/* Template loader demoted to a clearly-framed "start from" helper -
                  it's a convenience, not the primary identity field. */}
              <div className="cc-template">
                <div className="cc-template__head">
                  <span className="cc-template__title">Start from a template</span>
                  <span className="muted">Copy an existing creature's stats &amp; kit as a base, then tweak.</span>
                </div>
                <div className="cc-template__row">
                  <div className="icon-input">
                    <IconImg src={getCreatureIcon(templateName)} alt={templateName || "template"} size={32} />
                    <CreatureNameInput
                      id={templateNameId}
                      value={templateName}
                      onChange={setTemplateName}
                      creatureNames={creatureNames}
                      placeholder="Search existing creature..."
                    />
                  </div>
                  <div className="row-actions">
                    <button type="button" className="secondary" onClick={() => loadTemplate(templateName)} disabled={!templateName.trim()}>
                      Load
                    </button>
                    <button type="button" className="secondary" onClick={() => { setBuilder(createEmptyBuilderState()); setMessage(null); }}>
                      Blank
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="custom-creature-editor-section cc-section--stats">
              <h4>Core stats</h4>
              <p className="muted cc-section__hint">
                Only Tier, Health, Weight, Damage, and Bite Cooldown are required — everything else is optional.
              </p>
              <div className="custom-creature-stats-grid">
                {REQUIRED_STAT_FIELDS.map(([field, label]) => (
                  <div key={field} className="field">
                    <label>{label}</label>
                    <input aria-label={label} value={builder.stats[field]} onChange={(event) => setBuilder((current) => ({ ...current, stats: { ...current.stats, [field]: event.target.value } }))} />
                  </div>
                ))}
              </div>
              <div className="row-actions">
                <button type="button" className="secondary" onClick={() => setShowAdvancedStats((current) => !current)}>
                  {showAdvancedStats ? "Hide optional stats" : "Show optional stats"}
                </button>
              </div>
              {showAdvancedStats ? (
                <>
                  <div className="custom-creature-stats-grid">
                    {OPTIONAL_STAT_FIELDS.map(([field, label]) => (
                      <div key={field} className="field">
                        <label>{label}</label>
                        <input aria-label={label} value={builder.stats[field]} onChange={(event) => setBuilder((current) => ({ ...current, stats: { ...current.stats, [field]: event.target.value } }))} />
                      </div>
                    ))}
                  </div>
                  {/* Appetite only feeds Gourmandizer / Reflux, so the field
                      only appears once one of those is attached - instead of a
                      permanent "only needed for..." block cluttering every
                      creature's optional stats. */}
                  {appetiteRequired ? (
                    <div className="custom-creature-optional-section cc-appetite">
                      <div className="custom-creature-optional-head">
                        <strong>Appetite base</strong>
                        <span className="muted">Needed for the Gourmandizer / Reflux you attached.</span>
                      </div>
                      <input
                        aria-label="Appetite base"
                        value={builder.appetiteValue}
                        onChange={(event) => setBuilder((current) => ({ ...current, appetiteValue: event.target.value }))}
                        placeholder="e.g. 1200"
                      />
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
          ) : null}

          {showStep("abilities") ? (
          <>
          <div className="custom-creature-editor-section">
            <h4>Supported abilities</h4>
            <p className="muted">
              All abilities the engine recognises - built-in modeled / partial
              entries plus any custom abilities you authored under{" "}
              <em>Custom &gt; Abilities</em>. Click a tile to attach it. Use the{" "}
              <strong>Custom</strong> filter chip to narrow to your own.
            </p>
            <div className="custom-creature-picker-toolbar">
              <input
                value={abilitySearch}
                onChange={(event) => setAbilitySearch(event.target.value)}
                placeholder="Search abilities by name or type..."
                aria-label="Search abilities by name or type"
              />
              <div className="custom-creature-chip-row">
                <button type="button" className={abilityKindFilter === "all" ? "reference-chip active" : "reference-chip"} onClick={() => setAbilityKindFilter("all")}>All</button>
                {(["passive", "activated", "breath", "user"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={abilityKindFilter === kind ? "reference-chip active" : "reference-chip"}
                    onClick={() => setAbilityKindFilter(kind)}
                  >
                    {ABILITY_KIND_LABELS[kind]}
                  </button>
                ))}
              </div>
            </div>
            <div className="custom-creature-picker-list custom-creature-picker-list-abilities">
              {filteredAbilityOptions.length === 0 ? <div className="muted">No supported abilities match the current search.</div> : null}
              {filteredAbilityOptions.map((option) => (
                <button key={`${option.kind}-${option.name}`} type="button" className="custom-creature-picker-item" onClick={() => addAbilityOption(option)}>
                  <div className="custom-creature-picker-copy">
                    <strong>{option.name}</strong>
                    <span className="muted">
                      {buildAbilityMetaText(option)}
                    </span>
                  </div>
                  <span className="custom-creature-picker-action">Add</span>
                </button>
              ))}
            </div>
            <div className="custom-creature-selection-list">
              <label>Selected abilities</label>
              {selectedAbilities.length === 0 && builder.userAbilityIds.length === 0 ? (
                <div className="muted">None selected.</div>
              ) : null}
              {selectedAbilities.map((entry) => {
                const valueOptions = getSelectedAbilityValueOptions(entry);
                return (
                  <div key={`${entry.kind}-${entry.name}`} className="custom-creature-selected-row">
                    <div>
                      <strong>{entry.name}</strong>
                      <div className="muted">{buildAbilityMetaText({ ...entry, valueOptions })}</div>
                    </div>
                    {valueOptions.length > 0 ? (
                      <select value={entry.valueInput} onChange={(event) => updateSelectedAbilityValue(entry, event.target.value)}>
                        <option value="">Pick value...</option>
                        {valueOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input value={entry.valueInput} onChange={(event) => updateSelectedAbilityValue(entry, event.target.value)} placeholder="value" />
                    )}
                    <span className="muted">
                      {entry.kind === "other"
                        ? "Uses the modeled passive runtime for this ability."
                        : entry.kind === "breath"
                          ? "Will also set Breath automatically if Breath stat is blank."
                          : "Uses the normal ability runtime for this type."}
                    </span>
                    <button type="button" className="secondary" onClick={() => removeSelectedAbility(entry)}>
                      Remove
                    </button>
                  </div>
                );
              })}
              {builder.userAbilityIds.map((id) => {
                const record = customAbilityRecords.find((r) => r.spec.id === id);
                const displayName = record?.spec.display_name ?? id;
                return (
                  <div key={`user-${id}`} className="custom-creature-selected-row">
                    <div>
                      <strong>{displayName}</strong>
                      <div className="muted" style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11 }}>
                        {id}
                      </div>
                    </div>
                    <span className="reference-chip" style={{ alignSelf: "center" }}>Custom</span>
                    <span className="muted">
                      Runs through the engine's user-ability dispatch.
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setBuilder((current) => ({
                          ...current,
                          userAbilityIds: current.userAbilityIds.filter((existingId) => existingId !== id),
                        }));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="custom-creature-editor-section">
            <h4>Custom breath profile</h4>
            <p className="muted">
              Author a breath weapon directly instead of picking a known
              type. When set, this overrides the Breath name - the engine runs your
              profile as-is (build buffs still apply on top). Special-kind picker
              covers lance / plasma / auto-fire / heal / cloud, plus on-tick status
              procs that can reference your custom statuses.
            </p>
            {builder.customBreathProfile ? (
              <>
                <BreathProfileEditor
                  value={builder.customBreathProfile}
                  onChange={(next) =>
                    setBuilder((current) => ({ ...current, customBreathProfile: next }))
                  }
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setBuilder((current) => ({ ...current, customBreathProfile: null }))
                  }
                >
                  Remove custom breath
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setBuilder((current) => ({
                    ...current,
                    customBreathProfile: makeBlankBreathProfile(),
                  }))
                }
              >
                + Author custom breath profile
              </button>
            )}
          </div>
          </>
          ) : null}

          {showStep("statuses") ? (
          <div className="custom-creature-editor-section">
            <h4>Supported statuses</h4>
            <p className="muted">
              This picker shows only statuses that currently have at least some implementation on the site: modeled or partial.
            </p>
            <div className="custom-creature-picker-toolbar">
              <input
                value={statusSearch}
                onChange={(event) => setStatusSearch(event.target.value)}
                placeholder="Search supported statuses..."
                aria-label="Search supported statuses"
              />
              <div className="custom-status-inline-row">
                <div className="custom-creature-chip-row">
                  {(["onHit", "onHitTaken", "resist"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={statusDraft.kind === kind ? "reference-chip active" : "reference-chip"}
                      onClick={() =>
                        setStatusDraft((current) => ({
                          ...current,
                          kind,
                          value:
                            current.value === "" ||
                            (current.kind === "resist" && current.value === "0.25") ||
                            (current.kind !== "resist" && current.value === "1")
                              ? kind === "resist"
                                ? "0.25"
                                : "1"
                              : current.value,
                        }))
                      }
                    >
                      {STATUS_KIND_LABELS[kind]}
                    </button>
                  ))}
                </div>
                <label className="custom-status-inline-value">
                  <span>{statusDraft.kind === "resist" ? "Default Fraction" : "Default Stacks"}</span>
                  <input
                    value={statusDraft.value}
                    onChange={(event) => setStatusDraft((current) => ({ ...current, value: event.target.value }))}
                  />
                </label>
              </div>
            </div>
            <div className="custom-creature-picker-list custom-creature-picker-list-statuses">
              {filteredStatusOptions.length === 0 ? <div className="muted">No supported statuses match the current search.</div> : null}
              {filteredStatusOptions.map((status) => (
                <button
                  key={status.id}
                  type="button"
                  className="custom-creature-picker-item custom-creature-picker-item-status"
                  onClick={() => addStatusEffect(status.id)}
                >
                  <div className="custom-creature-picker-copy">
                    <div className="custom-status-inline-head">
                    <strong>{status.name}</strong>
                      <span className="custom-status-row-badge" data-status={status.status === "Modeled" ? "modeled" : "partial"}>{status.status}</span>
                    </div>
                    <span className="muted">{status.summary}</span>
                    {status.details.length > 0 ? (
                      <span className="muted custom-status-inline-details">
                        {/* Visible bullet separator. Pre-2026-05-18
                            details joined with a single space ran on
                            as a wall of text - on narrow viewports the
                            wrapped lines crowded the next card's title,
                            producing the reported "overlap". */}
                        {status.details.join(" • ")}
                      </span>
                    ) : null}
                  </div>
                  <span className="custom-creature-picker-action">Add</span>
                </button>
              ))}
            </div>
            <div className="custom-creature-selection-list">
              <label>Selected statuses</label>
              {selectedStatuses.length === 0 ? <div className="muted">None selected.</div> : null}
              {selectedStatuses.map((entry) => {
                const statusMeta = statusOptions.find((status) => status.id === entry.statusId);
                return (
                <div key={`${entry.kind}-${entry.statusId}-${entry.index}`} className="custom-creature-selected-row custom-creature-selected-row-status">
                  <div>
                    <strong>{findStatusName(statusOptions, entry.statusId)}</strong>
                    <div className="muted">{STATUS_KIND_LABELS[entry.kind]}</div>
                    {statusMeta ? <div className="muted">{statusMeta.summary}</div> : null}
                    <label className="custom-creature-status-source">
                      <span className="muted">Source</span>
                      <select
                        value={entry.sourceAbility}
                        onChange={(event) => updateSelectedStatus(entry, { sourceAbility: event.target.value })}
                        aria-label="Status source ability"
                      >
                        <option value="">Intrinsic (always on)</option>
                        {entry.sourceAbility && !selectedAbilities.some((ability) => ability.name === entry.sourceAbility) ? (
                          <option value={entry.sourceAbility}>{entry.sourceAbility}</option>
                        ) : null}
                        {selectedAbilities.map((ability) => (
                          <option key={`${ability.kind}-${ability.name}`} value={ability.name}>
                            {ability.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <input value={entry.valueInput} onChange={(event) => updateSelectedStatus(entry, { valueInput: event.target.value })} placeholder={entry.kind === "resist" ? "fraction" : "stacks"} />
                  <span className="muted">{entry.kind === "resist" ? "Fraction" : "Stacks"}</span>
                  <button type="button" className="secondary" onClick={() => removeSelectedStatus(entry)}>
                    Remove
                  </button>
                </div>
              )})}
            </div>
          </div>
          ) : null}
          </div>
          </div>
          <aside className="cc-editor__preview-pane">
            <CreaturePreviewCard builder={builder} getCreatureIcon={getCreatureIcon} />
            <div className="cc-preview-code">
              <button
                type="button"
                className="cc-preview-code__copy"
                onClick={() => void copyCurrentCode()}
              >
                <Copy size={14} strokeWidth={2} aria-hidden="true" /> Copy creature code
              </button>
              {lastCode ? (
                <details className="cc-preview-code__details">
                  <summary>View / edit code</summary>
                  <textarea
                    id={lastCodeId}
                    value={lastCode}
                    onChange={(event) => setLastCode(event.target.value)}
                    rows={4}
                    aria-label="Current creature code"
                  />
                </details>
              ) : (
                <p className="cc-preview-code__hint">
                  Builds a shareable, compressed creature code you can paste back in.
                </p>
              )}
            </div>
          </aside>
          </div>
        </div>
      ) : (
        <div className="cc-landing">
          <section className="custom-hero">
            <div className="custom-hero-text">
              <h2 className="custom-hero-title">Custom Creatures</h2>
              <p className="custom-hero-desc muted">
                Build creatures and use them anywhere — they're saved in this browser. Copy a creature's
                code to share it or move it to another device. Pick any as Compare / Best Builds A or B.
              </p>
            </div>
            <div className="custom-hero-actions">
              <button type="button" className="primary cc-new-btn" onClick={openNewCreature}>
                <Plus size={16} strokeWidth={2.6} aria-hidden="true" /> New creature
              </button>
            </div>
          </section>

          {customCreatures.length === 0 ? (
            <div className="creg-empty">
              <span className="creg-empty__icon">
                <PawPrint size={26} strokeWidth={1.7} aria-hidden="true" />
              </span>
              <div className="creg-empty__title">No creatures created yet</div>
              <p className="creg-empty__hint">
                Click <em>New creature</em> to build one from scratch or an existing template, or paste a
                shared creature code below.
              </p>
              <button type="button" className="primary creg-empty__cta" onClick={openNewCreature}>
                <Plus size={15} strokeWidth={2.4} aria-hidden="true" /> New creature
              </button>
            </div>
          ) : (
            <div className="creg">
              <div className="creg-count">
                {customCreatures.length} saved creature{customCreatures.length === 1 ? "" : "s"}
              </div>
              <div className="creg-grid">
                {customCreatures.map((record) => {
                  const code = encodeCustomCreatureCode(record);
                  return (
                    <article key={record.creature.name} className="creg-card cc-creature-card">
                      <div className="cc-creature-card__head">
                        <IconImg
                          src={getCreatureIcon(record.creature.name) ?? getCreatureIcon(record.iconName ?? "")}
                          alt={record.creature.name}
                          size={42}
                        />
                        <div className="cc-creature-card__id">
                          <h4 className="creg-card__name">{record.creature.name}</h4>
                          <div className="cc-creature-card__sub">
                            Tier {record.creature.stats.tier} · {record.creature.passiveAbilities?.length ?? 0}P ·{" "}
                            {record.creature.activatedAbilities?.length ?? 0}A ·{" "}
                            {record.creature.breathAbilities?.length ?? 0}B
                          </div>
                        </div>
                      </div>
                      <div className="creg-card__foot">
                        <button type="button" className="creg-card__btn" onClick={() => openEditCreature(record)}>
                          <Pencil size={13} strokeWidth={2} aria-hidden="true" /> Edit
                        </button>
                        <div className="creg-card__actions">
                          <button type="button" className="creg-card__btn" onClick={() => onNameAChange(record.creature.name)} title="Use as Compare/Best Builds A">
                            Use A
                          </button>
                          <button type="button" className="creg-card__btn" onClick={() => onNameBChange(record.creature.name)} title="Use as Compare B">
                            Use B
                          </button>
                          <button
                            type="button"
                            className="creg-card__btn"
                            aria-label={`Copy code for ${record.creature.name}`}
                            onClick={async () => {
                              setLastCode(code);
                              try {
                                await navigator.clipboard.writeText(code);
                                setMessage({ kind: "success", lines: [`Copied code for "${record.creature.name}".`] });
                              } catch {
                                setMessage({ kind: "warning", lines: [`Could not copy "${record.creature.name}" automatically.`] });
                              }
                            }}
                          >
                            <Copy size={13} strokeWidth={2} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="creg-card__btn creg-card__btn--danger"
                            aria-label={`Remove ${record.creature.name}`}
                            onClick={() => {
                              if (!window.confirm(`Remove "${record.creature.name}"? This cannot be undone.`)) return;
                              unregisterCustomCreatureRecord(record.creature.name);
                              setMessage({ kind: "success", lines: [`Removed "${record.creature.name}".`] });
                            }}
                          >
                            <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (!window.confirm(`Remove all ${customCreatures.length} custom creatures? This cannot be undone.`)) return;
                    clearCustomCreatureRecords();
                    setMessage({ kind: "success", lines: ["Removed all custom creatures."] });
                  }}
                >
                  Clear all
                </button>
              </div>
            </div>
          )}

          <div className="cc-import">
            <label htmlFor={importCodeId} className="cc-import__label">Import a creature from a shared code</label>
            <textarea
              id={importCodeId}
              value={importCode}
              onChange={(event) => setImportCode(event.target.value)}
              rows={3}
              placeholder="Paste a creature code here."
            />
            <div className="row-actions">
              <button type="button" className="secondary" onClick={importCreatureCode} disabled={!importCode.trim()}>
                Import code
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const PREVIEW_STAT_TILES: Array<[keyof BuilderState["stats"], string, string?]> = [
  ["health", "HP"],
  ["damage", "Damage"],
  ["weight", "Weight"],
  ["biteCooldown", "Bite CD", "s"],
  ["healthRegen", "HP Regen"],
  ["stamRegen", "Stam Regen"],
];

function prettyStatusId(statusId: string): string {
  return statusId.replace(/_Status$/i, "").replace(/_/g, " ").trim() || statusId;
}

// Live preview of the creature being edited - updates as the form is filled,
// mirroring the beta creature-card aesthetic (icon + name + tier, stat tiles,
// ability / status chips). Reads the builder state directly (no engine build),
// so it shows even a partially-filled creature.
function CreaturePreviewCard({
  builder,
  getCreatureIcon,
}: {
  builder: BuilderState;
  getCreatureIcon: (name: string) => string | null;
}) {
  const abilities = collectSelectedAbilities(builder);
  const statuses = collectSelectedStatuses(builder);
  const name = builder.name.trim();
  const iconName = builder.iconName.trim() || name;
  const tier = builder.stats.tier.trim();
  return (
    <div className="cc-preview">
      <div className="cc-preview__head">
        <IconImg src={getCreatureIcon(iconName)} alt={name || "preview"} size={48} />
        <div className="cc-preview__id">
          <strong className="cc-preview__name">{name || "Unnamed creature"}</strong>
          <span className="cc-preview__tier">Tier {tier || "—"}</span>
        </div>
      </div>
      <div className="cc-preview__stats">
        {PREVIEW_STAT_TILES.map(([field, label, suffix]) => {
          const value = (builder.stats[field] ?? "").trim();
          return (
            <div key={field} className="cc-preview__stat">
              <span className="cc-preview__stat-label">{label}</span>
              <span className="cc-preview__stat-value">{value ? `${value}${suffix ?? ""}` : "—"}</span>
            </div>
          );
        })}
      </div>
      <div className="cc-preview__section">
        <span className="cc-preview__section-label">Abilities · {abilities.length}</span>
        {abilities.length === 0 ? (
          <span className="cc-preview__empty">None selected yet</span>
        ) : (
          <div className="cc-preview__chips">
            {abilities.map((ability) => (
              <span key={`${ability.kind}-${ability.name}`} className="cc-preview__chip">
                {ability.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="cc-preview__section">
        <span className="cc-preview__section-label">Statuses · {statuses.length}</span>
        {statuses.length === 0 ? (
          <span className="cc-preview__empty">None selected yet</span>
        ) : (
          <div className="cc-preview__chips">
            {statuses.map((status, index) => (
              <span
                key={`${status.kind}-${status.statusId}-${index}`}
                className="cc-preview__chip cc-preview__chip--status"
              >
                {prettyStatusId(status.statusId)}
                {status.valueInput ? ` ${status.valueInput}` : ""}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
