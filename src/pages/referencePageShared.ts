// Shared view-helpers for the Reference page (sections, sort, search-text,
// detail score, status ranking, badge class, section-entry builder). Extracted
// so the classic ReferencePage and the beta ReferencePageBeta render identical
// content from a single source of truth - only the presentation differs.

import {
  ABILITY_POLICY_REFERENCE_DRAFTS,
  BATTLE_SETTING_REFERENCE_DRAFTS,
  KNOWN_APPROXIMATION_REFERENCE_DRAFTS,
  MODELED_ABILITY_REFERENCE_DRAFTS,
  MOVEMENT_SPEED_REFERENCE_DRAFTS,
  PLUSHIE_REFERENCE_DRAFTS,
  STATUS_REFERENCE_DRAFTS,
  type ReferenceStatus,
  type StatusReferenceEntry,
} from "./referenceContent";

export type { ReferenceStatus };

export const REFERENCE_SECTIONS = [
  {
    id: "modeled-abilities",
    title: "Abilities",
    description: "Main registry for abilities, with expandable entries and implementation notes.",
  },
  {
    id: "ability-policies",
    title: "Ability Policies",
    description: "Policy explanations such as really fast, fast, and the shared semi-ideal / ideal / extreme family.",
  },
  {
    id: "statuses-and-blocks",
    title: "Statuses and Ailments",
    description: "Status entries, ailment math, and related combat formulas.",
  },
  {
    id: "movement-speed",
    title: "Movement Speed",
    description: "Movement channels, the effects that move them, and how Speed Builds ranks a loadout. None of it reaches the combat model.",
  },
  {
    id: "battle-settings",
    title: "Battle Settings",
    description: "Rules, abilities, and disputed assumptions that sit outside the default combat model and are switched on per fight. Compare, Best Builds and Optimizer all offer them.",
  },
  {
    id: "known-approximations",
    title: "Known Approximations",
    description: "Known simplifications, disputed assumptions, and places where the model is intentionally partial.",
  },
  {
    id: "plushies",
    title: "Plushies",
    description: "Plushie effects, and how far the model carries each one.",
  },
] as const;

export type SectionId = (typeof REFERENCE_SECTIONS)[number]["id"];
export type SortMode = "reference" | "name-asc" | "name-desc" | "support-desc" | "support-asc" | "detail-desc";

export type ReferenceDisplayEntry = {
  id: string;
  name: string;
  summary: string;
  mechanics?: string[];
  notes: string[];
  status?: ReferenceStatus;
  whyItsNotModeledHere?: string[];
  policyDifferences?: string[];
  parentId?: string;
  gameTruth?: string[];
  currentApproximation?: string[];
  whyApproximated?: string;
  originalIndex: number;
};

export const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "reference", label: "Reference Order" },
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
  { value: "support-desc", label: "Most Modeled First" },
  { value: "support-asc", label: "Least Modeled First" },
  { value: "detail-desc", label: "Most Detailed First" },
];

export const STATUS_PRIORITY: Record<ReferenceStatus, number> = {
  Modeled: 0,
  Partial: 1,
  "Battle setting": 2,
  "Sandbox-only": 3,
  "Speed-Builds-only": 4,
  Disputed: 5,
  "Out of model": 6,
  "Not modeled yet": 7,
  "Not planned": 8,
};

export function getReferenceBadgeClass(status: string): string {
  if (status === "Partial") return "reference-entry-badge reference-entry-badge-partial";
  if (status === "Speed-Builds-only") return "reference-entry-badge reference-entry-badge-speed-builds-only";
  if (status === "Out of model") return "reference-entry-badge reference-entry-badge-out-of-model";
  if (status === "Not modeled yet") return "reference-entry-badge reference-entry-badge-not-modeled-yet";
  if (status === "Not planned") return "reference-entry-badge reference-entry-badge-not-planned";
  if (status === "Disputed") return "reference-entry-badge reference-entry-badge-disputed";
  return "reference-entry-badge";
}

// A short slug for the beta status badge modifier (e.g. "Out of model" ->
// "out-of-model"), so referenceBeta.css can color-code each status.
export function statusSlug(status: ReferenceStatus): string {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function sortReferenceEntriesByName<T extends { name: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

export function buildSearchText(entry: ReferenceDisplayEntry): string {
  return [
    entry.name,
    entry.summary,
    entry.status ?? "",
    ...(entry.mechanics ?? []),
    ...(entry.whyItsNotModeledHere ?? []),
    ...(entry.policyDifferences ?? []),
    ...(entry.gameTruth ?? []),
    ...(entry.currentApproximation ?? []),
    entry.whyApproximated ?? "",
    ...entry.notes,
  ]
    .join(" ")
    .toLowerCase();
}

export function getEntryDetailScore(entry: ReferenceDisplayEntry): number {
  return (
    entry.summary.length +
    (entry.mechanics?.length ?? 0) * 40 +
    (entry.whyItsNotModeledHere?.length ?? 0) * 40 +
    (entry.policyDifferences?.length ?? 0) * 40 +
    (entry.gameTruth?.length ?? 0) * 40 +
    (entry.currentApproximation?.length ?? 0) * 40 +
    (entry.whyApproximated ? 30 : 0) +
    entry.notes.length * 30
  );
}

export function compareReferenceEntries(
  left: ReferenceDisplayEntry,
  right: ReferenceDisplayEntry,
  sortMode: SortMode,
): number {
  if (sortMode === "name-asc") {
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  }

  if (sortMode === "name-desc") {
    return right.name.localeCompare(left.name, undefined, { sensitivity: "base" });
  }

  if (sortMode === "support-desc") {
    const leftRank = left.status ? STATUS_PRIORITY[left.status] : 99;
    const rightRank = right.status ? STATUS_PRIORITY[right.status] : 99;
    return leftRank - rightRank || left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  }

  if (sortMode === "support-asc") {
    const leftRank = left.status ? STATUS_PRIORITY[left.status] : -1;
    const rightRank = right.status ? STATUS_PRIORITY[right.status] : -1;
    return rightRank - leftRank || left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  }

  if (sortMode === "detail-desc") {
    return (
      getEntryDetailScore(right) - getEntryDetailScore(left) ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    );
  }

  return left.originalIndex - right.originalIndex;
}

export function toggleFilterValue<T extends string>(current: T[], value: T): T[] {
  if (current.length === 0) return [value];
  if (current.includes(value)) {
    return current.filter((item) => item !== value);
  }
  return [...current, value];
}

// Build the per-section entry lists from the reference drafts, assigning each a
// stable `originalIndex` for "Reference Order" sorting. Alphabetical sections
// (abilities / statuses / movement / battle settings / plushies) are name-sorted
// first so reference order is alphabetical; policies + approximations keep
// draft order.
// Cards whose object has a combat side and a movement side live in their combat
// array and appear under Movement Speed as well, keeping one card per object.
function movementSided(): StatusReferenceEntry[] {
  return [
    ...MODELED_ABILITY_REFERENCE_DRAFTS,
    ...STATUS_REFERENCE_DRAFTS,
    ...BATTLE_SETTING_REFERENCE_DRAFTS,
    ...PLUSHIE_REFERENCE_DRAFTS,
  ].filter((entry) => entry.movesSpeed) as StatusReferenceEntry[];
}

// An approximation names the entry it is a concession about. The link is held
// by `id` so it cannot rot silently, and rendered as a display name and section
// because that is how one entry points at another everywhere else.
const PARENT_LABEL_BY_ID: ReadonlyMap<string, string> = new Map(
  (
    [
      ["modeled-abilities", MODELED_ABILITY_REFERENCE_DRAFTS],
      ["statuses-and-blocks", STATUS_REFERENCE_DRAFTS],
      ["movement-speed", MOVEMENT_SPEED_REFERENCE_DRAFTS],
      ["battle-settings", BATTLE_SETTING_REFERENCE_DRAFTS],
      ["ability-policies", ABILITY_POLICY_REFERENCE_DRAFTS],
      ["plushies", PLUSHIE_REFERENCE_DRAFTS],
    ] as const
  ).flatMap(([sectionId, entries]) => {
    const title = REFERENCE_SECTIONS.find((section) => section.id === sectionId)?.title ?? "";
    return entries.map((entry) => [entry.id, `${entry.name} in ${title}`] as const);
  }),
);

/** "Hunker in Abilities" for an approximation's `parentId`, or undefined. */
export function referenceParentLabel(parentId: string | undefined): string | undefined {
  return parentId ? PARENT_LABEL_BY_ID.get(parentId) : undefined;
}

export function buildSectionEntries(): Record<SectionId, ReferenceDisplayEntry[]> {
  const withIndex = <T extends Omit<ReferenceDisplayEntry, "originalIndex">>(
    entries: readonly T[],
  ): ReferenceDisplayEntry[] => entries.map((entry, index) => ({ ...entry, originalIndex: index }));

  return {
    "modeled-abilities": withIndex(sortReferenceEntriesByName(MODELED_ABILITY_REFERENCE_DRAFTS)),
    "ability-policies": withIndex(ABILITY_POLICY_REFERENCE_DRAFTS),
    "statuses-and-blocks": withIndex(sortReferenceEntriesByName(STATUS_REFERENCE_DRAFTS)),
    "movement-speed": withIndex(sortReferenceEntriesByName([...MOVEMENT_SPEED_REFERENCE_DRAFTS, ...movementSided()])),
    "battle-settings": withIndex(sortReferenceEntriesByName(BATTLE_SETTING_REFERENCE_DRAFTS)),
    "known-approximations": withIndex(KNOWN_APPROXIMATION_REFERENCE_DRAFTS),
    plushies: withIndex(sortReferenceEntriesByName(PLUSHIE_REFERENCE_DRAFTS)),
  };
}
