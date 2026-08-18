// Shared, React-free model for the custom-creature builder. Both the classic
// editor (`CustomCreaturesPage`) and the bespoke beta editor
// (`components/custom/CustomCreaturesBeta`) consume this so the builder LOGIC
// (state shape, catalog scans, validation, record assembly) lives in exactly
// one place - only the markup differs between the two designs.

import { creatureByName, creaturesData, normalizeCreatureSearchName } from "./creatureData";
import { effectsCatalog } from "./data";
import type { CreatureRuntime, EffectsCatalogByCreature, AbilityRef, CustomBreathProfile } from "./types";
import { getCompareAppetiteEntry, type CompareAppetiteEntry } from "./compareAppetiteData";
import { synthesizeCustomCreatureEffects } from "./customCreatureEffectSynthesis";
import { isStatusApplierAbilityName } from "./effectDerivation";
import {
  canonicalizeAbilityValue,
  getAbilityValueOptions,
  type AbilityValueOption,
} from "./abilityValueOptions";
import { STATUS_CATALOG } from "./statusCatalog";
import type { CustomCreatureRecord } from "./customCreatures";

export type EditableAbilityRef = {
  name: string;
  valueInput: string;
  semantics: string;
  subtype: string | null;
};

export type EditableOtherAbility = {
  name: string;
  valueInput: string;
  semantics: string;
};

export type EditableStatusEffect = {
  statusId: string;
  valueInput: string;
  sourceAbility: string;
};

export type BuilderState = {
  editingOriginalName: string | null;
  name: string;
  iconName: string;
  // A user-uploaded icon as an image data URL, or null to fall back to iconName.
  iconDataUrl: string | null;
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

export type AbilityOption = {
  name: string;
  semantics: string;
  subtype: string | null;
  defaultValue: number | string | null;
  valueOptions: AbilityValueOption[];
};

export type AbilityLibraryKind = "passive" | "activated" | "breath" | "other" | "user";

export type AbilityLibraryOption = AbilityOption & {
  kind: AbilityLibraryKind;
  searchText: string;
  /** Set for `kind: "user"` entries - the engine id (`user.<name>`)
   * the row writes into `builder.userAbilityIds` when added. Other
   * kinds attach via `passiveAbilities` / `activatedAbilities` etc.
   * and don't need it. */
  userAbilityId?: string;
};

export type SelectedAbilityEntry = EditableAbilityRef & {
  kind: AbilityLibraryKind;
};

export type StatusApplicationKind = "onHit" | "onHitTaken" | "resist";

export type SelectedStatusEntry = EditableStatusEffect & {
  kind: StatusApplicationKind;
  index: number;
};

export type StatusPickerOption = {
  id: string;
  name: string;
  summary: string;
  details: string[];
  status: "Modeled" | "Partial";
  searchText: string;
};

export type MessageState =
  | {
      kind: "success" | "error" | "warning";
      lines: string[];
    }
  | null;

export const REQUIRED_STAT_FIELDS = [
  ["tier", "Tier"],
  ["health", "Health"],
  ["weight", "Weight"],
  ["damage", "Damage"],
  ["biteCooldown", "Bite Cooldown"],
  ["healthRegen", "Health Regen"],
] as const;

export const OPTIONAL_STAT_FIELDS = [
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

export const ABILITY_KIND_LABELS: Record<AbilityLibraryKind, string> = {
  passive: "Passive",
  activated: "Activated",
  breath: "Breath",
  other: "Effect",
  user: "Custom",
};

export const ABILITY_KIND_PRIORITY: Record<AbilityLibraryKind, number> = {
  passive: 0,
  activated: 1,
  breath: 2,
  other: 3,
  user: 4,
};

export const STATUS_KIND_LABELS: Record<StatusApplicationKind, string> = {
  onHit: "Offensive",
  onHitTaken: "Defensive",
  resist: "Block / Resist",
};

export const EMPTY_STATS: BuilderState["stats"] = {
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

export function normalizeKey(value: string): string {
  return normalizeCreatureSearchName(value);
}

export function formatValueInput(value: number | string | null | undefined): string {
  if (value == null) return "";
  return String(value);
}

export function parseValueInput(value: string): number | string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(trimmed) ? parsed : trimmed;
}

export function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function mergeAbilityValueOptions(
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

export function makeAbilityRef(option: AbilityOption, valueInput?: string): EditableAbilityRef {
  const defaultValue = option.defaultValue ?? option.valueOptions[0]?.value ?? null;
  return {
    name: option.name,
    valueInput: valueInput ?? formatValueInput(defaultValue),
    semantics: option.semantics,
    subtype: option.subtype,
  };
}

export function toEditableAbilityRef(ref: AbilityRef): EditableAbilityRef {
  return {
    name: ref.name,
    valueInput: formatValueInput(ref.value),
    semantics: ref.semantics,
    subtype: ref.subtype,
  };
}

export function fromEditableAbilityRef(ref: EditableAbilityRef): AbilityRef {
  const parsedValue = parseValueInput(ref.valueInput);
  return {
    abilityId: ref.name,
    name: ref.name,
    value: canonicalizeAbilityValue(ref.name, parsedValue),
    semantics: ref.semantics,
    subtype: ref.subtype,
  };
}

export function toEditableOtherAbility(entry: NonNullable<EffectsCatalogByCreature["otherAbilities"]>[number]): EditableOtherAbility {
  return {
    name: entry.name,
    valueInput: formatValueInput(entry.value),
    semantics: entry.semantics,
  };
}

export function toEditableStatusEffect(
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

export function createEmptyBuilderState(): BuilderState {
  return {
    editingOriginalName: null,
    name: "",
    iconName: "",
    iconDataUrl: null,
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

export function buildBuilderStateFromRecord(record: CustomCreatureRecord): BuilderState {
  const { creature, effects, appetite, iconName, iconDataUrl } = record;
  const mirroredAbilityNames = new Set(
    [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? []), ...(creature.breathAbilities ?? [])].map((entry) =>
      normalizeKey(entry.name),
    ),
  );
  return {
    editingOriginalName: creature.name,
    name: creature.name,
    iconName: iconName ?? "",
    iconDataUrl: iconDataUrl ?? null,
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

export function createRecordFromExistingCreature(name: string): CustomCreatureRecord | null {
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

export function collectSupportedAbilityOptions(): AbilityLibraryOption[] {
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

export function collectStatusOptions(): StatusPickerOption[] {
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

export function addOrIgnoreAbility(current: EditableAbilityRef[], next: EditableAbilityRef): EditableAbilityRef[] {
  if (current.some((entry) => normalizeKey(entry.name) === normalizeKey(next.name))) return current;
  return [...current, next].sort((left, right) => left.name.localeCompare(right.name));
}

export function removeAbilityByName(current: EditableAbilityRef[], name: string): EditableAbilityRef[] {
  return current.filter((entry) => normalizeKey(entry.name) !== normalizeKey(name));
}

export function hasAbilityInBuilder(builder: BuilderState, name: string): boolean {
  const key = normalizeKey(name);
  return (
    builder.passiveAbilities.some((entry) => normalizeKey(entry.name) === key) ||
    builder.activatedAbilities.some((entry) => normalizeKey(entry.name) === key) ||
    builder.breathAbilities.some((entry) => normalizeKey(entry.name) === key) ||
    builder.otherAbilities.some((entry) => normalizeKey(entry.name) === key)
  );
}

export function collectSelectedAbilities(builder: BuilderState): SelectedAbilityEntry[] {
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

export function collectSelectedStatuses(builder: BuilderState): SelectedStatusEntry[] {
  return [
    ...builder.onHitStatuses.map((entry, index) => ({ ...entry, kind: "onHit" as const, index })),
    ...builder.onHitTakenStatuses.map((entry, index) => ({ ...entry, kind: "onHitTaken" as const, index })),
    ...builder.resistStatuses.map((entry, index) => ({ ...entry, kind: "resist" as const, index })),
  ];
}

export function buildAbilityMetaText(entry: {
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

export function mergeNamedOtherAbilities(
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

export function mergeStatusEntries(
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

export function buildRecordFromBuilder(builder: BuilderState): {
  record?: {
    creature: CreatureRuntime;
    effects: EffectsCatalogByCreature;
    appetite: CompareAppetiteEntry | null;
    iconName: string | null;
    iconDataUrl: string | null;
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

  return {
    record: {
      creature,
      effects,
      appetite,
      iconName: builder.iconName.trim() || null,
      iconDataUrl: builder.iconDataUrl,
    },
  };
}

export function findStatusName(statusOptions: StatusPickerOption[], statusId: string): string {
  return statusOptions.find((status) => status.id === statusId)?.name ?? statusId;
}

// Value options for a SELECTED ability row: prefer the discovered/curated
// options for that ability; if none exist, return [] so the caller renders a
// free-form numeric input instead of locking the field to a bogus single
// option. A current free-text value not in the list is appended so it stays
// selectable.
export function getSelectedAbilityValueOptions(
  entry: SelectedAbilityEntry,
  abilityValueOptionsByName: Map<string, AbilityValueOption[]>,
): AbilityValueOption[] {
  const base = abilityValueOptionsByName.get(normalizeKey(entry.name)) ?? getAbilityValueOptions(entry.name);
  if (base.length === 0) return [];
  if (!entry.valueInput.trim() || base.some((option) => option.value === entry.valueInput)) return base;
  return mergeAbilityValueOptions(base, [{ value: entry.valueInput, label: entry.valueInput }]);
}
