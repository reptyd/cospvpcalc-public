// Materialise a subspecies from a base creature plus early-change deltas:
// clone the base, rename it, and fold each delta into the clone so the result
// is a full CreatureRuntime entry ready to write into creatures.runtime.json.
// (The subspecies tag itself is derived from the roster elsewhere; this only
// produces the data.)

import type { ParsedCreatureChange, ParsedDelta } from "./earlyChangeParser";
import type { CreatureRoster, CreatureRuntime } from "./creatureRoster";
import type { AbilityRef } from "./manualOverrides";
import { mkAbilityRef } from "./abilityRef";
import { abilityMatches, dropValueToRuntime } from "./abilityMatch";

export interface MaterializeResult {
  creature: CreatureRuntime;
  base: string;
  warnings: string[];
}

function clone(creature: CreatureRuntime): CreatureRuntime {
  return JSON.parse(JSON.stringify(creature)) as CreatureRuntime;
}

function abilityLists(creature: CreatureRuntime): AbilityRef[][] {
  return [creature.passiveAbilities, creature.activatedAbilities, creature.breathAbilities];
}

function findAbility(creature: CreatureRuntime, name: string): AbilityRef | null {
  for (const list of abilityLists(creature)) {
    const found = list.find((a) => abilityMatches(name, a));
    if (found) return found;
  }
  return null;
}

function removeAbility(creature: CreatureRuntime, name: string): void {
  for (const list of abilityLists(creature)) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (abilityMatches(name, list[i])) list.splice(i, 1);
    }
  }
}

function addAbility(creature: CreatureRuntime, name: string, value: number | string | null, roster: CreatureRoster, warnings: string[]): void {
  const category = roster.categoryOf(name) ?? "passive";
  if (roster.categoryOf(name) === null) {
    warnings.push(`Ability "${name}" not found in roster - added to ${creature.name} as passive; verify its category.`);
  }
  removeAbility(creature, name);
  const list = category === "activated"
    ? creature.activatedAbilities
    : category === "breath"
      ? creature.breathAbilities
      : creature.passiveAbilities;
  list.push(mkAbilityRef(name, value, category));
}

function applyDelta(delta: ParsedDelta, creature: CreatureRuntime, roster: CreatureRoster, warnings: string[]): void {
  switch (delta.kind) {
    case "stat":
      creature.stats[delta.field ?? ""] = delta.to ?? null;
      return;
    case "ability-remove":
      removeAbility(creature, delta.ability ?? "");
      return;
    case "ability-value": {
      const ability = delta.ability ?? "";
      const value = dropValueToRuntime(ability, delta.to ?? null);
      const existing = findAbility(creature, ability);
      if (existing) {
        existing.value = value;
        return;
      }
      warnings.push(`${ability}: not on base ${creature.name} - added instead of value-changed.`);
      addAbility(creature, ability, value, roster, warnings);
      return;
    }
    case "ability-add": {
      const name = delta.ability ?? "";
      const value = dropValueToRuntime(name, delta.value ?? null);
      // Already present (incl. subtype composites like Charge(Launch)): keep
      // the runtime shape instead of re-adding a synthetic entry; only update
      // the value when the drop actually states one.
      const existing = findAbility(creature, name);
      if (existing) {
        if (value != null) existing.value = value;
        return;
      }
      addAbility(creature, name, value, roster, warnings);
      return;
    }
    case "unknown":
      warnings.push(`Skipped unmapped line: "${delta.raw}"${delta.note ? ` (${delta.note})` : ""}`);
  }
}

export function materializeSubspecies(
  parsed: ParsedCreatureChange,
  base: CreatureRuntime,
  roster: CreatureRoster,
): MaterializeResult {
  const warnings = [...parsed.warnings];
  const creature = clone(base);
  creature.name = parsed.creature;
  for (const delta of parsed.deltas) applyDelta(delta, creature, roster, warnings);
  return { creature, base: base.name, warnings };
}

/** Fold deltas into an existing creature's runtime entry. Returns null when
 *  every delta is already in place, so callers can skip a no-op rewrite. */
export function applyDeltasToExisting(
  parsed: ParsedCreatureChange,
  current: CreatureRuntime,
  roster: CreatureRoster,
): MaterializeResult | null {
  const warnings: string[] = [];
  const creature = clone(current);
  for (const delta of parsed.deltas) applyDelta(delta, creature, roster, warnings);
  if (JSON.stringify(creature) === JSON.stringify(current)) return null;
  return { creature, base: current.name, warnings };
}
