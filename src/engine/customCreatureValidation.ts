// Single normalize-and-validate pass for any payload that wants to become a
// CustomCreatureRecord. Catches malformed abilities and status entries before
// they reach the runtime registries (where missing fields silently degrade
// engine behavior — strings where numbers belong, missing statusIds, unknown
// semantics enum, breath types with no spec, etc.).
//
// Three entry points feed this:
//   1. The editor save path (CustomCreaturesPage)
//   2. decodeCustomCreatureCode (paste a shared code)
//   3. restoreCustomCreatureRecords (rehydrate from localStorage on boot)
//
// Strategy: normalize what is recoverable (coerce numeric-string values,
// default missing semantics), drop what is structurally broken (status entry
// without a statusId, ability without a name, NaN values), warn on anything
// the user should know about (unknown statusId, breath without a matching
// spec). Hard-reject only the things the engine cannot handle at all.

import { breathSpecByNormalizedName, statusById } from "./data";
import { canonicalizeAbilityValue } from "./abilityValueOptions";
import type { CompareAppetiteEntry } from "./compareAppetiteData";
import { synthesizeCustomCreatureEffects } from "./customCreatureEffectSynthesis";
import type {
  AbilityRef,
  CreatureRuntime,
  CustomBreathProfile,
  EffectsCatalogByCreature,
} from "./types";

const ALLOWED_SEMANTICS = new Set(["neutral", "offensive", "defensive", "block"]);

function normalizeBreathSpecKey(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeAbilityValue(value: unknown): number | string | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const asNumber = coerceNumber(trimmed);
    if (asNumber !== null) return asNumber;
    return trimmed;
  }
  return null;
}

function normalizeAbilityRef(raw: unknown, warnings: string[], context: string): AbilityRef | null {
  if (!raw || typeof raw !== "object") {
    warnings.push(`${context}: dropped malformed ability entry.`);
    return null;
  }
  const candidate = raw as Partial<AbilityRef>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name) {
    warnings.push(`${context}: dropped ability with empty name.`);
    return null;
  }
  const abilityId = typeof candidate.abilityId === "string" && candidate.abilityId.trim() ? candidate.abilityId.trim() : name;
  const semanticsRaw = typeof candidate.semantics === "string" ? candidate.semantics : "neutral";
  const semantics = ALLOWED_SEMANTICS.has(semanticsRaw) ? semanticsRaw : "neutral";
  if (!ALLOWED_SEMANTICS.has(semanticsRaw)) {
    warnings.push(`${context}: ability "${name}" had unknown semantics "${semanticsRaw}", defaulted to "neutral".`);
  }
  const subtype = typeof candidate.subtype === "string" && candidate.subtype.trim() ? candidate.subtype.trim() : null;
  return {
    abilityId,
    name,
    value: canonicalizeAbilityValue(name, normalizeAbilityValue(candidate.value)),
    semantics,
    subtype,
  };
}

function normalizeAbilityList(
  raw: unknown,
  warnings: string[],
  context: string,
): AbilityRef[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`${context}: expected an array, ignored.`);
    return [];
  }
  const result: AbilityRef[] = [];
  for (const entry of raw) {
    const normalized = normalizeAbilityRef(entry, warnings, context);
    if (normalized) result.push(normalized);
  }
  return result;
}

type StacksEntry = { statusId: string; stacks: number; sourceAbility: string };
type FractionEntry = { statusId: string; fraction: number; sourceAbility: string };

function normalizeStatusBase(
  raw: unknown,
  kind: string,
  warnings: string[],
): { statusId: string; sourceAbility: string; numeric: number } | null {
  if (!raw || typeof raw !== "object") {
    warnings.push(`${kind}: dropped malformed entry.`);
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const statusId = typeof candidate.statusId === "string" ? candidate.statusId.trim() : "";
  if (!statusId) {
    warnings.push(`${kind}: dropped entry without statusId.`);
    return null;
  }
  if (!(statusId in statusById)) {
    warnings.push(`${kind}: statusId "${statusId}" is not in the status catalog (entry kept, engine may ignore it).`);
  }
  const sourceAbility = typeof candidate.sourceAbility === "string" ? candidate.sourceAbility.trim() : "";
  const numericKey = kind === "resistStatus" ? "fraction" : "stacks";
  const numericRaw = candidate[numericKey] ?? candidate.value;
  const numeric = coerceNumber(numericRaw);
  if (numeric === null) {
    warnings.push(`${kind}: dropped entry for "${statusId}" — ${numericKey} is not a number.`);
    return null;
  }
  return { statusId, sourceAbility, numeric };
}

function normalizeStacksList(
  raw: unknown,
  kind: "applyStatusOnHit" | "applyStatusOnHitTaken",
  warnings: string[],
): StacksEntry[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`${kind}: expected an array, ignored.`);
    return [];
  }
  const result: StacksEntry[] = [];
  for (const entry of raw) {
    const base = normalizeStatusBase(entry, kind, warnings);
    if (base) result.push({ statusId: base.statusId, stacks: base.numeric, sourceAbility: base.sourceAbility });
  }
  return result;
}

function normalizeFractionList(raw: unknown, warnings: string[]): FractionEntry[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    warnings.push("resistStatus: expected an array, ignored.");
    return [];
  }
  const result: FractionEntry[] = [];
  for (const entry of raw) {
    const base = normalizeStatusBase(entry, "resistStatus", warnings);
    if (base) result.push({ statusId: base.statusId, fraction: base.numeric, sourceAbility: base.sourceAbility });
  }
  return result;
}

function normalizeOtherAbilities(
  raw: unknown,
  warnings: string[],
): NonNullable<EffectsCatalogByCreature["otherAbilities"]> {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    warnings.push("otherAbilities: expected an array, ignored.");
    return [];
  }
  const result: NonNullable<EffectsCatalogByCreature["otherAbilities"]> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      warnings.push("otherAbilities: dropped malformed entry.");
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!name) {
      warnings.push("otherAbilities: dropped entry without name.");
      continue;
    }
    const semanticsRaw = typeof candidate.semantics === "string" ? candidate.semantics : "neutral";
    const semantics = ALLOWED_SEMANTICS.has(semanticsRaw) ? semanticsRaw : "neutral";
    if (!ALLOWED_SEMANTICS.has(semanticsRaw)) {
      warnings.push(`otherAbilities: "${name}" had unknown semantics "${semanticsRaw}", defaulted to "neutral".`);
    }
    result.push({ name, value: normalizeAbilityValue(candidate.value), semantics });
  }
  return result;
}

function normalizeFiniteNumberStat(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const coerced = coerceNumber(value);
    return coerced ?? undefined;
  }
  return undefined;
}

function normalizeRequiredStat(value: unknown): number | null {
  const result = normalizeFiniteNumberStat(value);
  return result ?? null;
}

function normalizeCreature(raw: unknown, warnings: string[]): { creature: CreatureRuntime | null; error?: string } {
  if (!raw || typeof raw !== "object") {
    return { creature: null, error: "Creature payload is missing or malformed." };
  }
  const candidate = raw as Partial<CreatureRuntime> & { stats?: Partial<CreatureRuntime["stats"]> };
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name) return { creature: null, error: "Creature name is required." };

  const statsRaw = (candidate.stats ?? {}) as Record<string, unknown>;
  const tier = normalizeRequiredStat(statsRaw.tier);
  const health = normalizeRequiredStat(statsRaw.health);
  const weight = normalizeRequiredStat(statsRaw.weight);
  const damage = normalizeRequiredStat(statsRaw.damage);
  const biteCooldown = normalizeRequiredStat(statsRaw.biteCooldown);
  if (tier === null || health === null || weight === null || damage === null || biteCooldown === null) {
    return { creature: null, error: "Tier, health, weight, damage, and bite cooldown are required numeric stats." };
  }

  const optional = <K extends string>(key: K) => {
    const v = normalizeFiniteNumberStat(statsRaw[key]);
    return v == null ? {} : ({ [key]: v } as Record<K, number>);
  };
  const optionalStr = <K extends string>(key: K) => {
    const v = statsRaw[key];
    if (typeof v !== "string") return {};
    const trimmed = v.trim();
    return trimmed ? ({ [key]: trimmed } as Record<K, string>) : {};
  };

  const breathRaw = typeof statsRaw.breath === "string" ? statsRaw.breath.trim() : "";
  // A custom breath profile (Phase 7 / G7) overrides the name lookup, so a
  // non-catalog breath name is expected — don't warn in that case.
  if (breathRaw && !candidate.customBreathProfile && !breathSpecByNormalizedName[normalizeBreathSpecKey(breathRaw)]) {
    warnings.push(`Breath spec "${breathRaw}" not found in catalog (engine may use defaults).`);
  }

  const stats: CreatureRuntime["stats"] = {
    tier,
    health,
    weight,
    damage,
    biteCooldown,
    ...optional("damage2"),
    ...optional("healthRegen"),
    ...optional("stamina"),
    ...optional("stamRegen"),
    ...optional("walkAndSwimSpeed"),
    ...optional("sprintSpeed"),
    ...optional("turn"),
    ...optional("venerationRate"),
    ...optional("breathResistance"),
    ...optionalStr("diet"),
    ...optionalStr("type"),
    ...optionalStr("mobilityOverride"),
    ...(breathRaw ? { breath: breathRaw } : {}),
  };

  const passiveAbilities = normalizeAbilityList(candidate.passiveAbilities, warnings, "passiveAbilities");
  const activatedAbilities = normalizeAbilityList(candidate.activatedAbilities, warnings, "activatedAbilities");
  const breathAbilities = normalizeAbilityList(candidate.breathAbilities, warnings, "breathAbilities");
  // 2026-05-12: preserve user-authored ability ids attached to this
  // creature. Pre-fix the normalizer silently dropped this field, so
  // saving a custom creature with custom abilities lost the
  // attachment — UI showed them attached but the saved record had no
  // userAbilityIds. Each id must start with `user.` per the engine's
  // namespace convention; malformed entries warn and drop.
  const userAbilityIds = normalizeUserAbilityIds(candidate.userAbilityIds, warnings);
  // Phase 7 / G7: carry the user-authored breath profile. Like userAbilityIds
  // above, a field-by-field rebuild silently drops anything not listed — so a
  // custom breath would be lost on save/import without this.
  const customBreathProfile = normalizeCustomBreathProfile(candidate.customBreathProfile, warnings);

  const creature: CreatureRuntime = {
    name,
    stats,
    ...(passiveAbilities.length > 0 ? { passiveAbilities } : {}),
    ...(activatedAbilities.length > 0 ? { activatedAbilities } : {}),
    ...(breathAbilities.length > 0 ? { breathAbilities } : {}),
    ...(userAbilityIds.length > 0 ? { userAbilityIds } : {}),
    ...(customBreathProfile ? { customBreathProfile } : {}),
  };

  return { creature };
}

/** Phase 7 / G7: coerce a raw custom-breath payload into a valid
 * `CustomBreathProfile` (six finite core fields + optional special-kind
 * fields + status procs), or null when absent / not an object. */
function normalizeCustomBreathProfile(
  raw: unknown,
  warnings: string[],
): CustomBreathProfile | null {
  if (raw == null) return null;
  if (typeof raw !== "object") {
    warnings.push("customBreathProfile must be an object.");
    return null;
  }
  const c = raw as Record<string, unknown>;
  const num = (key: string): number => normalizeFiniteNumberStat(c[key]) ?? 0;
  const optNum = (key: string): Record<string, number> => {
    const v = normalizeFiniteNumberStat(c[key]);
    return v == null ? {} : { [key]: v };
  };
  const specialKind =
    typeof c.specialKind === "string" && c.specialKind.trim() ? c.specialKind.trim() : null;
  const lanceStatusId =
    typeof c.lanceStatusId === "string" && c.lanceStatusId.trim() ? c.lanceStatusId.trim() : null;
  const specialStatuses: Array<{ statusId: string; stacks: number }> = [];
  if (Array.isArray(c.specialStatuses)) {
    for (const entry of c.specialStatuses) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const statusId = typeof e.statusId === "string" ? e.statusId.trim() : "";
      if (!statusId) continue;
      specialStatuses.push({ statusId, stacks: normalizeFiniteNumberStat(e.stacks) ?? 1 });
    }
  }
  return {
    dpsPct: num("dpsPct"),
    capacity: num("capacity"),
    regenRate: num("regenRate"),
    critChancePct: num("critChancePct"),
    chain: num("chain"),
    chainMaxStacks: num("chainMaxStacks"),
    specialKind,
    ...optNum("selfHealPct"),
    ...optNum("cleanseStacks"),
    ...optNum("lanceDamagePct"),
    ...optNum("lanceChargeSec"),
    ...optNum("lanceCooldownSec"),
    ...(lanceStatusId ? { lanceStatusId } : {}),
    ...optNum("autoFireDelaySec"),
    ...optNum("autoFireCooldownSec"),
    ...optNum("chargesMax"),
    ...optNum("chargeRegenSec"),
    specialStatuses,
  };
}

function normalizeUserAbilityIds(raw: unknown, warnings: string[]): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    warnings.push("userAbilityIds must be an array of `user.<name>` strings.");
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") {
      warnings.push(`userAbilityIds entry ${JSON.stringify(entry)} is not a string.`);
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("user.")) {
      warnings.push(`userAbilityIds entry "${trimmed}" must start with "user.".`);
      continue;
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function normalizeEffects(raw: unknown, warnings: string[]): EffectsCatalogByCreature {
  const candidate = (raw && typeof raw === "object" ? raw : {}) as Partial<EffectsCatalogByCreature>;
  const effects: EffectsCatalogByCreature = {
    otherAbilities: normalizeOtherAbilities(candidate.otherAbilities, warnings),
    applyStatusOnHit: normalizeStacksList(candidate.applyStatusOnHit, "applyStatusOnHit", warnings),
    applyStatusOnHitTaken: normalizeStacksList(candidate.applyStatusOnHitTaken, "applyStatusOnHitTaken", warnings),
    resistStatus: normalizeFractionList(candidate.resistStatus, warnings),
  };
  if (Array.isArray(candidate.specialAbilitiesDetailed)) {
    effects.specialAbilitiesDetailed = candidate.specialAbilitiesDetailed;
  }
  if (Array.isArray(candidate.specialAbilities)) {
    effects.specialAbilities = candidate.specialAbilities;
  }
  return effects;
}

function normalizeAppetite(raw: unknown, warnings: string[]): CompareAppetiteEntry | null {
  if (raw == null) return null;
  if (typeof raw !== "object") {
    warnings.push("appetite: expected an object, ignored.");
    return null;
  }
  const candidate = raw as Partial<CompareAppetiteEntry>;
  const appetite = coerceNumber(candidate.appetite);
  if (appetite === null) {
    warnings.push("appetite: dropped — appetite is not a finite number.");
    return null;
  }
  return { appetite };
}

export type NormalizedCustomCreaturePayload = {
  creature: CreatureRuntime;
  effects: EffectsCatalogByCreature;
  appetite: CompareAppetiteEntry | null;
  iconName: string | null;
};

export function normalizeCustomCreaturePayload(input: {
  creature: unknown;
  effects: unknown;
  appetite?: unknown;
  iconName?: unknown;
}): {
  ok: boolean;
  error?: string;
  warnings: string[];
  payload?: NormalizedCustomCreaturePayload;
} {
  const warnings: string[] = [];
  const { creature, error } = normalizeCreature(input.creature, warnings);
  if (!creature) {
    return { ok: false, error: error ?? "Creature could not be normalized.", warnings };
  }
  const effects = synthesizeCustomCreatureEffects(creature, normalizeEffects(input.effects, warnings));
  const appetite = normalizeAppetite(input.appetite, warnings);
  const iconName =
    typeof input.iconName === "string" && input.iconName.trim() ? input.iconName.trim() : null;
  return {
    ok: true,
    warnings,
    payload: { creature, effects, appetite, iconName },
  };
}
