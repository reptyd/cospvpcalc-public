// Shared view-helpers for the Search page (sort / name filter / column
// persistence / predicate count). Extracted so the classic SearchPage and the
// beta SearchPageBeta render identical results from a single source of truth -
// only the presentation differs between the two.

import { safeReadLocalStorage, safeWriteLocalStorage } from "../shared/safeStorage";
import {
  NUMERIC_STAT_LABELS,
  type NumericStatField,
  type QueryGroup as QueryGroupModel,
  type SearchableCreature,
} from "../engine/creatureSearch";

export type SortKey = "name" | NumericStatField;
export type SortDir = "asc" | "desc";

export const DEFAULT_VISIBLE_FIELDS: NumericStatField[] = [
  "health", "weight", "damage", "biteCooldown", "stamina", "healthRegen",
];
export const COLUMNS_STORAGE_KEY = "cos.searchColumns";

export function loadVisibleFields(): NumericStatField[] {
  const raw = safeReadLocalStorage(COLUMNS_STORAGE_KEY);
  if (!raw) return DEFAULT_VISIBLE_FIELDS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_FIELDS;
    const valid = parsed.filter(
      (f): f is NumericStatField => typeof f === "string" && f in NUMERIC_STAT_LABELS,
    );
    return valid.length > 0 ? valid : DEFAULT_VISIBLE_FIELDS;
  } catch {
    return DEFAULT_VISIBLE_FIELDS;
  }
}

export function saveVisibleFields(fields: NumericStatField[]): void {
  safeWriteLocalStorage(COLUMNS_STORAGE_KEY, JSON.stringify(fields));
}

// The query the user builds (the smart-tree filter, name search, sort) survives
// leaving the Search page and coming back - the page unmounts on navigation, so
// the state would otherwise reset to an empty query every time.
export const SEARCH_QUERY_STORAGE_KEY = "cos.searchQueryState";

export type PersistedSearchQuery = {
  root?: QueryGroupModel;
  nameQuery?: string;
  sortKey?: SortKey;
  sortDir?: SortDir;
};

export function loadSearchQueryState(): PersistedSearchQuery {
  const raw = safeReadLocalStorage(SEARCH_QUERY_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PersistedSearchQuery;
    const out: PersistedSearchQuery = {};
    // A root that doesn't structurally look like a group is dropped (a stale
    // blob from a query-model change falls back to an empty query, not a crash).
    if (parsed.root && typeof parsed.root === "object" && Array.isArray(parsed.root.children)) {
      out.root = parsed.root;
    }
    if (typeof parsed.nameQuery === "string") out.nameQuery = parsed.nameQuery;
    if (typeof parsed.sortKey === "string") out.sortKey = parsed.sortKey;
    if (parsed.sortDir === "asc" || parsed.sortDir === "desc") out.sortDir = parsed.sortDir;
    return out;
  } catch {
    return {};
  }
}

export function saveSearchQueryState(state: {
  root: QueryGroupModel;
  nameQuery: string;
  sortKey: SortKey;
  sortDir: SortDir;
}): void {
  safeWriteLocalStorage(SEARCH_QUERY_STORAGE_KEY, JSON.stringify(state));
}

export function filterByName(list: SearchableCreature[], query: string): SearchableCreature[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((entry) => entry.creature.name.toLowerCase().includes(q));
}

export function countPredicates(node: QueryGroupModel): number {
  let n = 0;
  for (const child of node.children) {
    if (child.kind === "predicate") n += 1;
    else n += countPredicates(child);
  }
  return n;
}

export function sortResults(list: SearchableCreature[], key: SortKey, dir: SortDir): SearchableCreature[] {
  const mult = dir === "asc" ? 1 : -1;
  const copy = [...list];
  copy.sort((left, right) => {
    if (key === "name") return mult * left.creature.name.localeCompare(right.creature.name);
    const lv = readNumber(left.creature.stats as Record<string, unknown>, key);
    const rv = readNumber(right.creature.stats as Record<string, unknown>, key);
    // Missing values sort to the bottom regardless of direction - they
    // can't satisfy a "largest / smallest by this stat" question.
    if (lv == null && rv == null) return left.creature.name.localeCompare(right.creature.name);
    if (lv == null) return 1;
    if (rv == null) return -1;
    if (lv === rv) return left.creature.name.localeCompare(right.creature.name);
    return mult * (lv - rv);
  });
  return copy;
}

function readNumber(stats: Record<string, unknown>, field: string): number | null {
  const raw = stats[field];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}
