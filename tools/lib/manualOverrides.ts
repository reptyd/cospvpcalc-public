// Read/write + lifecycle for data/manual_overrides.json - the shared overlay
// layer both wiki-sync (reads) and the early-changes tool (reads + writes) use
// to force a value while the live wiki has not caught up. Schema mirrors
// wiki-sync's ManualOverrideEntry; keep the two in sync.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..", "..");
export const MANUAL_OVERRIDES_FILE = path.join(ROOT, "data", "manual_overrides.json");

export type OverrideChannel = "early" | "user-specific";
export type AbilityCategory = "passive" | "activated" | "breath";

export interface AbilityRef {
  abilityId: string;
  name: string;
  value: number | string | null;
  semantics: string;
  subtype: string | null;
}

interface OverrideCommon {
  id: string;
  channel: OverrideChannel;
  creature: string;
  source: string;
  note: string;
  /** ISO date hard cutoff; the override stops applying once reached. */
  expiresAt?: string;
  /** ISO date it was manually retired; never applies once set. */
  retiredAt?: string;
}

export type AbilityOverride = OverrideCommon & {
  kind: "ability";
  category: AbilityCategory;
  matchAbilityName?: string;
  ability?: AbilityRef;
  abilities?: AbilityRef[];
  expectedWikiValue?: number | string | null;
};

export type StatOverride = OverrideCommon & {
  kind: "stat";
  field: string;
  value: number | string | null;
  expectedWikiValue?: number | string | null;
};

export type ManualOverrideEntry = AbilityOverride | StatOverride;

export function readManualOverrides(): ManualOverrideEntry[] {
  const raw = fs.readFileSync(MANUAL_OVERRIDES_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("manual_overrides.json must be a JSON array");
  return parsed as ManualOverrideEntry[];
}

export function writeManualOverrides(entries: ManualOverrideEntry[]): void {
  fs.writeFileSync(MANUAL_OVERRIDES_FILE, `${JSON.stringify(entries, null, 2)}\n`);
}

export type LifecycleStatus = "active" | "date-expired" | "retired";

/** Lifecycle status from the entry alone. The `expectedWikiValue` anchor is
 *  NOT evaluated here - it needs the live wiki and is checked by wiki-sync at
 *  sync time; an anchored entry reads as "active" until then. */
export function lifecycleStatus(entry: ManualOverrideEntry, nowMs: number): LifecycleStatus {
  if (entry.retiredAt) return "retired";
  if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= nowMs) return "date-expired";
  return "active";
}

/** A one-line human description of what an entry forces. */
export function describeEntry(entry: ManualOverrideEntry): string {
  if (entry.kind === "stat") {
    return `${entry.creature}: stat ${entry.field} = ${entry.value}`;
  }
  const abilities = entry.abilities ?? (entry.ability ? [entry.ability] : []);
  const match = entry.matchAbilityName ?? abilities[0]?.name ?? "?";
  if (abilities.length === 0) return `${entry.creature}: remove ability ${match}`;
  const rendered = abilities
    .map((a) => (a.value == null ? a.name : `${a.name} (${a.value})`))
    .join(", ");
  return `${entry.creature}: ability ${match} -> ${rendered}`;
}

/** Give an entry a stable, unique id derived from its subject, disambiguating
 *  against ids already taken. */
export function makeEntryId(
  creature: string,
  subject: string,
  taken: Set<string>,
): string {
  const base = `${creature}-${subject}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

/** Parse a retire selection over a numbered list of entries: numbers ("3"),
 *  ranges ("5-7"), a channel name ("early", "user-specific"), or "all",
 *  space/comma-separated. Numbers are 1-based positions in `entries`. */
export function parseRetireSelection(
  input: string,
  entries: ManualOverrideEntry[],
): { picked: ManualOverrideEntry[] } | { error: string } {
  const picked = new Set<ManualOverrideEntry>();
  const tokens = input.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return { error: "nothing selected" };
  const outOf = `out of 1-${entries.length}`;
  for (const token of tokens) {
    if (token === "all") {
      for (const entry of entries) picked.add(entry);
      continue;
    }
    if (token === "early" || token === "user-specific") {
      const inChannel = entries.filter((e) => e.channel === token);
      if (!inChannel.length) return { error: `no ${token} overrides in the list` };
      for (const entry of inChannel) picked.add(entry);
      continue;
    }
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (a < 1 || b > entries.length || a > b) return { error: `range ${token} is ${outOf}` };
      for (let i = a; i <= b; i += 1) picked.add(entries[i - 1]);
      continue;
    }
    if (/^\d+$/.test(token)) {
      const n = Number(token);
      if (n < 1 || n > entries.length) return { error: `${n} is ${outOf}` };
      picked.add(entries[n - 1]);
      continue;
    }
    return { error: `cannot read "${token}" - use numbers, ranges (5-7), "early", "user-specific", or "all"` };
  }
  return { picked: [...picked] };
}

/** Set retiredAt on the entry with the given id. Returns the entry, or null if
 *  no such id (or it was already retired). */
export function retireEntry(
  entries: ManualOverrideEntry[],
  id: string,
  dateISO: string,
): ManualOverrideEntry | null {
  const entry = entries.find((e) => e.id === id);
  if (!entry || entry.retiredAt) return null;
  entry.retiredAt = dateISO;
  return entry;
}
