// Pure creature-name normalization helpers. This module imports NOTHING - it is
// a leaf so it can be pulled into a boot-light chunk without dragging the heavy
// creature/effects catalogs along. `creatureData` (which DOES own the catalog)
// imports + re-exports these so existing `creatureData` consumers keep working,
// while boot-reachable code (customCreatures registry, the CreatureNameInput
// component) imports them directly from here and stays catalog-free.

const CREATURE_SEARCH_CHAR_MAP: Record<string, string> = {
  "ß": "ss",
  "Æ": "AE",
  "æ": "ae",
  "Œ": "OE",
  "œ": "oe",
  "Ø": "O",
  "ø": "o",
  "Đ": "D",
  "đ": "d",
  "Ł": "L",
  "ł": "l",
  "Þ": "Th",
  "þ": "th",
};

function replaceMappedCreatureChars(value: string): string {
  return Array.from(value, (char) => CREATURE_SEARCH_CHAR_MAP[char] ?? char).join("");
}

export function stripCreatureDiacritics(value: string): string {
  return replaceMappedCreatureChars(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function normalizeCreatureSearchName(value: string): string {
  return stripCreatureDiacritics(value).trim().toLowerCase();
}

export function creatureNameMatchesQuery(name: string, query: string): boolean {
  const normalizedQuery = normalizeCreatureSearchName(query);
  if (!normalizedQuery) return true;
  return normalizeCreatureSearchName(name).includes(normalizedQuery);
}
