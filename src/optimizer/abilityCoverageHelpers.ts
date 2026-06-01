import type { CreatureRuntime } from "../engine";
import { isModeledOtherAbility, normalizeAbilityName } from "./abilityCoverageRegistry";

type AbilityValueEntry = {
  name: string;
  value?: unknown;
};

type StatusSourceEntry = {
  sourceAbility: string;
};

type StatusBlockEntry = {
  sourceAbility: string;
  statusId: string;
  fraction?: number;
};

type StatusApplyEntry = {
  sourceAbility: string;
  statusId: string;
  stacks: number;
};

const EFFECT_ABILITY_SECTIONS = ["specialAbilitiesDetailed", "specialAbilities", "otherAbilities"] as const;

export function collectModeledAbilityNames(effects: Record<string, unknown>, creatureName?: string): Set<string> {
  const modeled = new Set<string>();
  for (const entry of (effects.applyStatusOnHit as StatusSourceEntry[] | undefined) ?? []) {
    modeled.add(normalizeAbilityName(entry.sourceAbility));
  }
  for (const entry of (effects.applyStatusOnHitTaken as StatusSourceEntry[] | undefined) ?? []) {
    modeled.add(normalizeAbilityName(entry.sourceAbility));
  }
  for (const entry of (effects.resistStatus as StatusSourceEntry[] | undefined) ?? []) {
    modeled.add(normalizeAbilityName(entry.sourceAbility));
  }
  for (const section of EFFECT_ABILITY_SECTIONS) {
    for (const entry of (effects[section] as AbilityValueEntry[] | undefined) ?? []) {
      if (section !== "otherAbilities" || isModeledOtherAbility(entry.name, creatureName)) {
        modeled.add(normalizeAbilityName(entry.name));
      }
    }
  }
  return modeled;
}

export function hasAbilityInEffects(effects: Record<string, unknown>, abilityName: string): boolean {
  const normalized = normalizeAbilityName(abilityName);
  for (const section of EFFECT_ABILITY_SECTIONS) {
    for (const entry of (effects[section] as AbilityValueEntry[] | undefined) ?? []) {
      if (normalizeAbilityName(entry.name) === normalized) return true;
    }
  }
  for (const entry of (effects.applyStatusOnHit as StatusSourceEntry[] | undefined) ?? []) {
    if (normalizeAbilityName(entry.sourceAbility) === normalized) return true;
  }
  for (const entry of (effects.applyStatusOnHitTaken as StatusSourceEntry[] | undefined) ?? []) {
    if (normalizeAbilityName(entry.sourceAbility) === normalized) return true;
  }
  return false;
}

export function collectModeledBreathNames(creature: CreatureRuntime): Set<string> {
  const breathModeledNames = new Set<string>();
  const hasBreathDamageModel = Boolean(creature.stats.breath && creature.stats.breath !== "N/A");
  if (!hasBreathDamageModel) return breathModeledNames;

  for (const breathAbility of creature.breathAbilities ?? []) {
    if (breathAbility.subtype) breathModeledNames.add(normalizeAbilityName(breathAbility.subtype));
    if (breathAbility.name) breathModeledNames.add(normalizeAbilityName(breathAbility.name));
  }
  if (creature.stats.breath) breathModeledNames.add(normalizeAbilityName(creature.stats.breath));
  breathModeledNames.add(normalizeAbilityName("Breath"));
  return breathModeledNames;
}

export function getAbilityTableDetail(effects: Record<string, unknown>, abilityName: string): string | undefined {
  const normalized = normalizeAbilityName(abilityName);
  const parts: string[] = [];

  for (const entry of (effects.resistStatus as StatusBlockEntry[] | undefined) ?? []) {
    if (normalizeAbilityName(entry.sourceAbility) !== normalized) continue;
    parts.push(`Block ${formatStatusLabel(entry.statusId)} ${formatPercent((entry.fraction ?? 0) * 100)}`);
  }
  for (const entry of (effects.applyStatusOnHitTaken as StatusApplyEntry[] | undefined) ?? []) {
    if (normalizeAbilityName(entry.sourceAbility) !== normalized) continue;
    parts.push(`Defensive ${formatStatusLabel(entry.statusId)} +${formatShortNumber(entry.stacks)}`);
  }
  for (const entry of (effects.applyStatusOnHit as StatusApplyEntry[] | undefined) ?? []) {
    if (normalizeAbilityName(entry.sourceAbility) !== normalized) continue;
    parts.push(`Attack ${formatStatusLabel(entry.statusId)} +${formatShortNumber(entry.stacks)}`);
  }

  const rawValues: string[] = [];
  for (const section of EFFECT_ABILITY_SECTIONS) {
    const entries = (effects[section] as AbilityValueEntry[] | undefined) ?? [];
    for (const entry of entries) {
      if (normalizeAbilityName(entry.name) !== normalized) continue;
      if (entry.value == null || entry.value === "") continue;
      rawValues.push(typeof entry.value === "number" ? formatShortNumber(entry.value) : String(entry.value));
    }
  }
  if (rawValues.length > 0) {
    const uniqValues = Array.from(new Set(rawValues));
    parts.push(`Value ${uniqValues.join("/")}`);
  }

  return parts.length ? parts.join("; ") : undefined;
}

function formatStatusLabel(statusId: string): string {
  return String(statusId ?? "")
    .replace(/_Status$/i, "")
    .replace(/_/g, " ")
    .trim();
}

function formatShortNumber(value: number): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? `${n}` : n.toFixed(2).replace(/\.?0+$/, "");
}

function formatPercent(value: number): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0%";
  return `${n.toFixed(2).replace(/\.?0+$/, "")}%`;
}
