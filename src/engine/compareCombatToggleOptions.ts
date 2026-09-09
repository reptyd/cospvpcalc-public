import type { CreatureRuntime, FinalStats } from "./types";
import { MODELED_OTHER_ABILITIES } from "../shared/modeledOtherAbilities";

export type CombatToggleOption = {
  id: string;
  label: string;
};

export type CombatEffectsLookup = {
  applyStatusOnHit?: Array<{ sourceAbility: string }>;
  applyStatusOnHitTaken?: Array<{ sourceAbility: string }>;
  resistStatus?: Array<{ sourceAbility: string }>;
  specialAbilitiesDetailed?: Array<{ name: string }>;
  specialAbilities?: Array<{ name: string }>;
  otherAbilities?: Array<{ name: string }>;
};

export function normalizeCompareAbilityName(name: string): string {
  return name.trim().replace(/[\u2019]/g, "'").replace(/\s+/g, " ");
}

const modeledCreatureAbilityNames = new Set(MODELED_OTHER_ABILITIES.map(normalizeCompareAbilityName));

export function getBreathToggleAliases(finalStats: FinalStats | null): string[] {
  if (!finalStats?.hasBreath) return [];
  return [
    "Breath",
    finalStats.breath,
    finalStats.breathType,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0 && value !== "N/A")
    .map(normalizeCompareAbilityName);
}

export function normalizeCompareDisabledAbilities(
  disabled: string[],
  finalStats: FinalStats | null,
): string[] {
  const output = new Set<string>();
  const breathAliases = new Set(getBreathToggleAliases(finalStats));
  let hasBreathDisabled = false;

  for (const item of disabled) {
    const normalized = normalizeCompareAbilityName(item);
    if (!normalized) continue;
    if (breathAliases.has(normalized)) {
      hasBreathDisabled = true;
      continue;
    }
    output.add(normalized);
  }

  if (hasBreathDisabled) output.add("Breath");
  return [...output];
}

export function isCompareBreathDisabled(disabled: ReadonlySet<string>, finalStats: FinalStats | null): boolean {
  return getBreathToggleAliases(finalStats).some((alias) => disabled.has(alias));
}

export function getCombatToggleOptions(
  finalStats: FinalStats | null,
  effects: CombatEffectsLookup,
  creature?: CreatureRuntime,
): CombatToggleOption[] {
  if (!finalStats) return [];
  const options: CombatToggleOption[] = [];
  const seen = new Set<string>();

  const add = (id: string, label = id, aliases: string[] = []) => {
    const normalized = normalizeCompareAbilityName(id);
    if (!normalized || seen.has(normalized)) return;
    for (const alias of [normalized, ...aliases.map(normalizeCompareAbilityName)]) {
      if (alias) seen.add(alias);
    }
    options.push({ id: normalized, label });
  };

  if (finalStats.hasBreath) add("Breath", "Breath", getBreathToggleAliases(finalStats));
  for (const ability of [...(creature?.passiveAbilities ?? []), ...(creature?.activatedAbilities ?? [])]) {
    if (modeledCreatureAbilityNames.has(normalizeCompareAbilityName(ability.name))) {
      add(ability.name, normalizeCompareAbilityName(ability.name));
    }
  }
  for (const entry of effects.specialAbilitiesDetailed ?? []) add(entry.name, normalizeCompareAbilityName(entry.name));
  for (const entry of effects.specialAbilities ?? []) add(entry.name, normalizeCompareAbilityName(entry.name));
  for (const entry of effects.otherAbilities ?? []) add(entry.name, normalizeCompareAbilityName(entry.name));
  for (const entry of effects.applyStatusOnHit ?? []) add(entry.sourceAbility, normalizeCompareAbilityName(entry.sourceAbility));
  for (const entry of effects.applyStatusOnHitTaken ?? []) add(entry.sourceAbility, normalizeCompareAbilityName(entry.sourceAbility));
  for (const entry of effects.resistStatus ?? []) add(entry.sourceAbility, normalizeCompareAbilityName(entry.sourceAbility));

  const hasStatusAttacks = (effects.applyStatusOnHit?.length ?? 0) > 0 || (effects.applyStatusOnHitTaken?.length ?? 0) > 0;
  if (hasStatusAttacks) add("Status Attacks");
  const hasStatusBlocks = (effects.resistStatus?.length ?? 0) > 0 || Object.keys(finalStats.plushieStatusBlockPct ?? {}).length > 0;
  if (hasStatusBlocks) add("Status Blocks");
  if (Object.keys(finalStats.plushieStatusOnHit ?? {}).length > 0) add("Plushie Offensive Procs");
  if (Object.keys(finalStats.plushieStatusOnHitTaken ?? {}).length > 0) add("Plushie Defensive Procs");

  return options.sort((a, b) => a.label.localeCompare(b.label));
}
