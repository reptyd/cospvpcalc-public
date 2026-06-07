import { useEffect, useId, useMemo, useState } from "react";
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
    passiveAbilities: (creature.passiveAbilities ?? []).map(toEditableAbilityRef),
    activatedAbilities: (creature.activatedAbilities ?? []).map(toEditableAbilityRef),
    breathAbilities: (creature.breathAbilities ?? []).map(toEditableAbilityRef),
    userAbilityIds: [...(creature.userAbilityIds ?? [])],
    customBreathProfile: creature.customBreathProfile ?? null,
    otherAbilities: (effects.otherAbilities ?? [])
      .filter((entry) => !mirroredAbilityNames.has(normalizeKey(entry.name)))
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
  // filter (Reference modeled/partial × runtime catalog membership)
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

function getDefaultStatusSource(builder: BuilderState): string {
  const selectedAbilities = collectSelectedAbilities(builder);
  return selectedAbilities[0]?.name ?? "Custom Creature";
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
  const [message, setMessage] = useState<MessageState>(null);
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
    const sourceAbility = getDefaultStatusSource(builder);
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
    const result = registerCustomCreatureRecord(built.record, {
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
          "This creature is temporary and will disappear after page reload. Copy its code if you want to add it again later.",
          "The code was also copied to your clipboard.",
          ...result.warnings,
        ],
      });
    } catch {
      setMessage({
        kind: result.warnings.length > 0 ? "warning" : "success",
        lines: [
          `${originalName ? "Updated" : "Created"} "${built.record.creature.name}".`,
          "This creature is temporary and will disappear after page reload. Copy its code if you want to add it again later.",
          ...result.warnings,
        ],
      });
    }
    setBuilder((current) => ({ ...current, editingOriginalName: built.record!.creature.name }));
  };

  const importCreatureCode = () => {
    const decoded = decodeCustomCreatureCode(importCode);
    if (!decoded.ok || !decoded.payload) {
      setMessage({ kind: "error", lines: [decoded.error ?? "Custom creature code is invalid."] });
      return;
    }
    const result = registerCustomCreatureRecord(decoded.payload, {
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
        createdAt: Date.now(),
      }),
    );
    setLastCode(importCode.trim());
    setMessage({
      kind: result.warnings.length > 0 ? "warning" : "success",
      lines: [
        `Imported "${decoded.payload.creature.name}".`,
        "It is temporary and will disappear after page reload unless you keep the code.",
        ...result.warnings,
      ],
    });
  };

  return (
    <section className="panel">
      <div className="panel-grid">
        <div className="panel-block">
          <h3>Custom Creatures</h3>
          <p className="muted">
            These creatures are temporary. They exist only until page reload. Copy their code if you want to add them again later.
          </p>
          {message ? (
            <div className={`custom-creature-message ${message.kind}`}>
              {message.lines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          ) : null}

          <div className="field">
            <label htmlFor={templateNameId}>Start from existing creature</label>
            <div className="icon-input">
              <IconImg src={getCreatureIcon(templateName)} alt={templateName || "template"} size={36} />
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
                Load Template
              </button>
              <button type="button" className="secondary" onClick={() => { setBuilder(createEmptyBuilderState()); setMessage(null); }}>
                Blank Template
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor={customNameId}>Custom creature name</label>
            <input
              id={customNameId}
              value={builder.name}
              onChange={(event) => setBuilder((current) => ({ ...current, name: event.target.value }))}
              placeholder="My Custom Creature"
            />
          </div>
          <div className="field">
            <label htmlFor={iconSourceId}>Icon source name</label>
            <CreatureNameInput
              id={iconSourceId}
              value={builder.iconName}
              onChange={(value) => setBuilder((current) => ({ ...current, iconName: value }))}
              creatureNames={creatureNames}
              placeholder="Optional existing creature name"
              maxSuggestions={6}
            />
          </div>

          <div className="custom-creature-helper">
            <strong>Core stats</strong>
            <div className="muted">
              Only Tier, Health, Weight, Damage, and Bite Cooldown are required. Everything else below is optional and can stay blank if the current model does not use it for your creature.
            </div>
          </div>
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
              <div className="custom-creature-optional-section">
                <div className="custom-creature-optional-head">
                  <strong>Compare appetite profile</strong>
                  <span className="muted">Only needed for Gourmandizer or Reflux.</span>
                </div>
                {appetiteRequired ? (
                  <div className="custom-creature-helper">
                    <strong>Appetite profile needed</strong>
                    <div className="muted">
                      This creature currently has Gourmandizer or Reflux selected, so you should set Appetite base and choose whether that meter is hunger or thirst.
                    </div>
                  </div>
                ) : null}
                <div className="custom-creature-stats-grid">
                  <div className="field"><label>Appetite base</label><input aria-label="Appetite base" value={builder.appetiteValue} onChange={(event) => setBuilder((current) => ({ ...current, appetiteValue: event.target.value }))} placeholder={appetiteRequired ? "Required for Gourmandizer/Reflux" : "Optional"} /></div>
                </div>
              </div>
            </>
          ) : null}

          <div className="custom-creature-editor-section">
            <h4>Supported abilities</h4>
            <p className="muted">
              All abilities the engine recognises - built-in modeled / partial
              entries plus any custom abilities you authored under{" "}
              <em>Custom &gt; Abilities</em>. Click <strong>Add</strong> to
              attach. Use the <strong>Custom</strong> filter chip to narrow to
              your own.
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


          <div className="row-actions custom-creature-primary-actions">
            <button type="button" className="primary" onClick={() => void createOrUpdate()}>{builder.editingOriginalName ? "Save Creature Changes" : "Add Creature"}</button>
            <button type="button" className="secondary" onClick={async () => { if (!lastCode) return; try { await navigator.clipboard.writeText(lastCode); setMessage({ kind: "success", lines: ["Custom creature code copied."] }); } catch { setMessage({ kind: "warning", lines: ["Could not copy automatically. Copy the code manually below."] }); } }} disabled={!lastCode}>Copy Creature Code</button>
          </div>
          <div className="field">
            <label htmlFor={lastCodeId}>Current creature code</label>
            <textarea
              id={lastCodeId}
              value={lastCode}
              onChange={(event) => setLastCode(event.target.value)}
              rows={5}
              placeholder="The latest created or updated creature code appears here."
            />
          </div>
          <div className="field">
            <label htmlFor={importCodeId}>Import creature code</label>
            <textarea
              id={importCodeId}
              value={importCode}
              onChange={(event) => setImportCode(event.target.value)}
              rows={5}
              placeholder="Paste COSC1:... code here."
            />
          </div>
          <div className="row-actions"><button type="button" className="secondary" onClick={importCreatureCode} disabled={!importCode.trim()}>Import Code</button></div>
        </div>

        <div className="panel-block">
          <h3>Temporary session creatures</h3>
          <p className="muted">These entries can be selected in Compare and Best Builds until the page is reloaded. Copy the code for anything you want to keep.</p>
          {customCreatures.length === 0 ? <div className="muted">No temporary creatures created yet.</div> : null}
          <div className="custom-creature-record-list">
            {customCreatures.map((record) => {
              const code = encodeCustomCreatureCode(record);
              return (
                <div key={record.creature.name} className="custom-creature-record-card">
                  <div className="custom-creature-record-head">
                    <div className="icon-input">
                      <IconImg src={getCreatureIcon(record.creature.name) ?? getCreatureIcon(record.iconName ?? "")} alt={record.creature.name} size={36} />
                      <div>
                        <strong>{record.creature.name}</strong>
                        <div className="muted">Tier {record.creature.stats.tier} | {record.creature.passiveAbilities?.length ?? 0} passive | {record.creature.activatedAbilities?.length ?? 0} active | {record.creature.breathAbilities?.length ?? 0} breath</div>
                      </div>
                    </div>
                    <div className="row-actions">
                      <button type="button" className="secondary" onClick={() => setBuilder(buildBuilderStateFromRecord(record))}>Edit</button>
                      <button type="button" className="secondary" onClick={() => onNameAChange(record.creature.name)}>Use as A</button>
                      <button type="button" className="secondary" onClick={() => onNameBChange(record.creature.name)}>Use as B</button>
                    </div>
                  </div>
                  <div className="row-actions">
                    <button type="button" className="secondary" onClick={async () => { setLastCode(code); try { await navigator.clipboard.writeText(code); setMessage({ kind: "success", lines: [`Copied code for "${record.creature.name}".`] }); } catch { setMessage({ kind: "warning", lines: [`Could not copy "${record.creature.name}" automatically. The code is shown below.`] }); } }}>Copy Code</button>
                    <button type="button" className="secondary" onClick={() => { unregisterCustomCreatureRecord(record.creature.name); setMessage({ kind: "success", lines: [`Removed "${record.creature.name}" from this session.`] }); if (builder.editingOriginalName === record.creature.name) setBuilder(createEmptyBuilderState()); }}>Remove</button>
                  </div>
                </div>
              );
            })}
          </div>
          {customCreatures.length > 0 ? (
            <div className="row-actions">
              <button type="button" className="secondary" onClick={() => { clearCustomCreatureRecords(); setMessage({ kind: "success", lines: ["Cleared all temporary custom creatures from this session."] }); setBuilder(createEmptyBuilderState()); }}>
                Clear All Temporary Creatures
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
