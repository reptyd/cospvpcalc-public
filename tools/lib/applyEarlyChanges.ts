// Turn parsed early-change deltas into manual_overrides.json entries. Balance
// deltas on an existing creature and user-specific corrections become anchored
// overrides; a new creature or a subspecies (base + deltas) needs materialising
// into a full entry, which is a later slice and is reported as skipped here.

import type { ParsedCreatureChange, ParsedDelta } from "./earlyChangeParser";
import type { CreatureRoster } from "./creatureRoster";
import {
  makeEntryId,
  type AbilityCategory,
  type AbilityOverride,
  type ManualOverrideEntry,
  type OverrideChannel,
  type StatOverride,
} from "./manualOverrides";
import { mkAbilityRef } from "./abilityRef";
import { dropValueToRuntime } from "./abilityMatch";

export interface ApplyOptions {
  channel: OverrideChannel;
  source: string;
  /** Per-run note; defaults to the creature's insight, else "early change". */
  note?: string;
  /** Set expectedWikiValue from a delta's `from` so it auto-expires when the
   *  wiki catches up. */
  anchor: boolean;
  /** ISO date hard cutoff added to every written entry. */
  expiresAt?: string;
}

export interface CreatureApplyResult {
  creature: string;
  entries: ManualOverrideEntry[];
  warnings: string[];
  /** Set when the whole creature was skipped (not an override target yet). */
  skipped?: string;
}

function resolveCategory(
  ability: string,
  creature: string | undefined,
  roster: CreatureRoster,
  warnings: string[],
): AbilityCategory {
  const found = roster.categoryOf(ability, creature);
  if (found) return found;
  warnings.push(`Ability "${ability}" not found in roster - filed as passive; verify its category.`);
  return "passive";
}

function deltaToEntry(
  delta: ParsedDelta,
  creature: string,
  opts: ApplyOptions,
  roster: CreatureRoster,
  note: string,
  taken: Set<string>,
  warnings: string[],
): ManualOverrideEntry | null {
  const common = (subject: string) => ({
    id: makeEntryId(creature, subject, taken),
    channel: opts.channel,
    creature,
    source: opts.source,
    note,
    ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
  });

  switch (delta.kind) {
    case "stat": {
      const entry: StatOverride = {
        ...common(delta.field ?? "stat"),
        kind: "stat",
        field: delta.field ?? "",
        value: delta.to ?? null,
      };
      if (opts.anchor && delta.from != null) entry.expectedWikiValue = delta.from;
      return entry;
    }
    case "ability-value": {
      const ability = delta.ability ?? "";
      const category = resolveCategory(ability, creature, roster, warnings);
      const entry: AbilityOverride = {
        ...common(ability),
        kind: "ability",
        category,
        matchAbilityName: ability,
        abilities: [mkAbilityRef(ability, dropValueToRuntime(ability, delta.to ?? null), category)],
      };
      if (opts.anchor && delta.from != null) entry.expectedWikiValue = dropValueToRuntime(ability, delta.from);
      return entry;
    }
    case "ability-add": {
      const ability = delta.ability ?? "";
      const category = resolveCategory(ability, creature, roster, warnings);
      return {
        ...common(ability),
        kind: "ability",
        category,
        matchAbilityName: ability,
        abilities: [mkAbilityRef(ability, dropValueToRuntime(ability, delta.value ?? null), category)],
      };
    }
    case "ability-remove": {
      const ability = delta.ability ?? "";
      const category = resolveCategory(ability, creature, roster, warnings);
      return {
        ...common(ability),
        kind: "ability",
        category,
        matchAbilityName: ability,
        abilities: [],
      };
    }
    case "unknown":
      warnings.push(`Skipped unmapped line: "${delta.raw}"${delta.note ? ` (${delta.note})` : ""}`);
      return null;
  }
}

export function creatureDeltasToOverrides(
  parsed: ParsedCreatureChange,
  opts: ApplyOptions,
  roster: CreatureRoster,
  taken: Set<string>,
): CreatureApplyResult {
  const warnings = [...parsed.warnings];

  if (parsed.kind === "new-full") {
    return { creature: parsed.creature, entries: [], warnings, skipped: "full stat block - full-creature import is a later slice" };
  }
  if (!roster.has(parsed.creature)) {
    return {
      creature: parsed.creature,
      entries: [],
      warnings,
      skipped: "not in roster - new-creature / subspecies materialisation is a later slice",
    };
  }

  const note = opts.note ?? parsed.insight ?? "early change";
  const entries: ManualOverrideEntry[] = [];
  for (const delta of parsed.deltas) {
    const entry = deltaToEntry(delta, parsed.creature, opts, roster, note, taken, warnings);
    if (entry) entries.push(entry);
  }
  return { creature: parsed.creature, entries, warnings };
}
