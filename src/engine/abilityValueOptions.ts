import { STATUS_CATALOG, type EffectSource } from "./statusCatalog";

export type AbilityValueOption = {
  value: string;
  label: string;
};

function normalizeAbilityKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeValueKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function humanizeCompactValue(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Yolk Bomb value options. The Rust engine
// (`wasm-engine/src/composable/abilities.rs::resolve_yolk_bomb_routing`)
// routes each value to either SELF (positive: heals, buffs, regen-
// likes) or ENEMY (negative: debuffs / DOTs / disables). This list
// is the union of two sources:
//
//   1. **Catalog-derived (Phase 2b)** — entries marked with
//      `yolk_bomb_self` / `yolk_bomb_enemy` in STATUS_CATALOG sources.
//      Adding a new Reference status with the right `sources` entry
//      surfaces it here automatically; no edit to this file needed.
//
//   2. **Supplemental (hand-maintained)** — Yolk Bomb targets that
//      don't yet have a Reference status entry:
//        - SELF: Healing Pulse / Stamina Boost / Fortify are inline
//          ability effects, not standalone statuses.
//        - ENEMY: Aftershock is an engine status not yet in Reference.
//        - Legacy CamelCase (BadOmen / BlurredVision / Heatwave) —
//          existing `creatures.runtime.json` data stores values in
//          this format. The Rust engine accepts both forms; this
//          list keeps the picker showing them until the data is
//          migrated to display names.
//      When any of these gets a proper Reference entry +
//      NAME_TO_EFFECT_META row with the right `sources`, drop it
//      from the supplemental list — catalog derivation takes over.
const SUPPLEMENTAL_YOLK_BOMB_SELF: AbilityValueOption[] = [
  { value: "Healing Pulse", label: "Healing Pulse" },
  { value: "Stamina Boost", label: "Stamina Boost" },
  { value: "Fortify", label: "Fortify" },
];

const SUPPLEMENTAL_YOLK_BOMB_ENEMY: AbilityValueOption[] = [
  { value: "Aftershock", label: "Aftershock" },
  { value: "BadOmen", label: "Bad Omen" },
  { value: "BlurredVision", label: "Blurred Vision" },
  { value: "Heatwave", label: "Heatwave" },
];

function catalogYolkBombTargets(direction: EffectSource): AbilityValueOption[] {
  return STATUS_CATALOG
    .filter((entry) => entry.sources.includes(direction))
    .map((entry) => ({ value: entry.name, label: entry.name }));
}

export const YOLK_BOMB_VALUE_OPTIONS: AbilityValueOption[] = [
  ...SUPPLEMENTAL_YOLK_BOMB_SELF,
  ...catalogYolkBombTargets("yolk_bomb_self"),
  ...SUPPLEMENTAL_YOLK_BOMB_ENEMY,
  ...catalogYolkBombTargets("yolk_bomb_enemy"),
];

/**
 * Lich Mark payload options — derived from the shared `statusCatalog`.
 * The engine accepts any Reference display name as a payload value
 * (`hitStatusRuntime.ts::getLichMarkPayloadStatusId` resolves via
 * `statusEngineIdMap()` plus `resolveStatusId` plus a generic
 * `<Name>_Status` fallback), so widening the dropdown to the full
 * modeled/partial catalog produces no engine breakage. Adding a new
 * status to the catalog automatically surfaces it here.
 */
export const LICH_MARK_VALUE_OPTIONS: AbilityValueOption[] = STATUS_CATALOG
  .map((entry) => ({ value: entry.name, label: entry.name }))
  .sort((a, b) => a.label.localeCompare(b.label));

const CURATED_VALUE_OPTIONS_BY_ABILITY = new Map<string, AbilityValueOption[]>([
  [normalizeAbilityKey("Yolk Bomb"), YOLK_BOMB_VALUE_OPTIONS],
  [normalizeAbilityKey("Lich Mark"), LICH_MARK_VALUE_OPTIONS],
]);

function mergeValueOptions(
  left: AbilityValueOption[],
  right: AbilityValueOption[],
): AbilityValueOption[] {
  const byValue = new Map<string, AbilityValueOption>();
  for (const option of [...left, ...right]) {
    const value = option.value.trim();
    if (!value) continue;
    byValue.set(value, { value, label: option.label || humanizeCompactValue(value) });
  }
  return [...byValue.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function getAbilityValueOptions(
  abilityName: string,
  discoveredValues: Array<string | null | undefined> = [],
): AbilityValueOption[] {
  const curated = CURATED_VALUE_OPTIONS_BY_ABILITY.get(normalizeAbilityKey(abilityName)) ?? [];
  const discovered = discoveredValues
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => ({ value: value.trim(), label: humanizeCompactValue(value) }));
  return mergeValueOptions(curated, discovered);
}

export function canonicalizeAbilityValue(
  abilityName: string,
  value: number | string | null,
): number | string | null {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (normalizeAbilityKey(abilityName) !== normalizeAbilityKey("Yolk Bomb")) return trimmed;

  const lookup = new Map<string, string>();
  for (const option of YOLK_BOMB_VALUE_OPTIONS) {
    lookup.set(normalizeValueKey(option.value), option.value);
    lookup.set(normalizeValueKey(option.label), option.value);
  }
  return lookup.get(normalizeValueKey(trimmed)) ?? trimmed;
}
