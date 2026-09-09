// Creature Search - data model, field metadata, and predicate evaluation.
//
// Queries are a tree of `QueryNode`. Leaves are `Predicate`s; internal
// nodes are `QueryGroup`s with their own AND/OR combinator. This lets
// the UI offer per-row combinators AND brackets / sub-groups without
// inventing a precedence rule - every grouping is explicit.
//
// Field metadata (`NUMERIC_STAT_FIELDS`, `CATEGORICAL_STAT_FIELDS`)
// drives the picker UI so adding a new stat to `CreatureRuntime.stats`
// only needs an entry here. `collectAbilityNames`, `collectStatusNames`,
// and `collectCategoricalValues` walk the data once at module load to
// populate dropdowns. Evaluation runs against the joined view
// `creature.stats` + `effectsCatalog[name]`.

import { creaturesData } from "./creatureData";
import { effectsCatalog } from "./data";
import { STATUS_CATALOG } from "./statusCatalog";
import type { CreatureRuntime, EffectsCatalogByCreature } from "./types";
import subspeciesOverridesData from "../../data/subspecies.json";
import { computeSubspecies, type SubspeciesOverrides } from "../shared/subspecies";

// ---------------------------------------------------------------------------
// Field metadata
// ---------------------------------------------------------------------------

export type NumericStatField =
  | "tier"
  | "health"
  | "weight"
  | "damage"
  | "damage2"
  | "biteCooldown"
  | "healthRegen"
  | "stamina"
  | "stamRegen"
  | "walkAndSwimSpeed"
  | "sprintSpeed"
  | "turn"
  | "venerationRate"
  | "breathResistance"
  | "appetite"
  | "beachSpeed"
  | "flySpeed"
  | "flySprintMultiplier"
  | "glideStaminaRegen"
  | "takeoffMultiplier"
  | "jumpPower"
  | "jumpStamina"
  | "jumpAge"
  | "dartPower"
  | "dartStamina"
  | "nightvision"
  | "ambush"
  | "growthTime"
  | "hungerDrain"
  | "thirstDrain"
  | "moistureTime"
  | "oxygenTime";

export type CategoricalStatField = "type" | "diet" | "breath" | "mobilityOverride" | "subspecies";

// Passive and activated abilities share one search category: the wiki data files
// the same ability under either list depending on the creature (e.g. Adrenaline
// is activated for 17 creatures but passive for Valkurse), so splitting them
// surfaced one ability under two filters with mismatched results. The engine
// never relies on this split (Necropoison gating is registry-based, eligibility
// checks both lists), so a single "Passives / Activated" filter is both simpler
// and correct.
export type AbilityKind = "passiveOrActivated" | "breath" | "special" | "other";

export type StatusSlot = "offensive" | "defensive" | "resist";

export type NumericComparator = "eq" | "neq" | "gt" | "lt" | "gte" | "lte";
export type EqualityComparator = "eq" | "neq";

export const NUMERIC_STAT_LABELS: Record<NumericStatField, string> = {
  tier: "Tier",
  health: "Health",
  weight: "Weight",
  damage: "Damage",
  damage2: "Damage 2",
  biteCooldown: "Bite Cooldown",
  healthRegen: "Health Regen",
  stamina: "Stamina",
  stamRegen: "Stamina Regen",
  walkAndSwimSpeed: "Walk / Swim Speed",
  sprintSpeed: "Sprint Speed",
  turn: "Turn Speed",
  venerationRate: "Veneration Rate",
  breathResistance: "Breath Resistance",
  appetite: "Appetite",
  beachSpeed: "Beach Speed",
  flySpeed: "Fly Speed",
  flySprintMultiplier: "Fly Sprint Multiplier",
  glideStaminaRegen: "Glide Stamina Regen",
  takeoffMultiplier: "Takeoff Multiplier",
  jumpPower: "Jump Power",
  jumpStamina: "Jump Stamina",
  jumpAge: "Jump Age",
  dartPower: "Dart Power",
  dartStamina: "Dart Stamina",
  nightvision: "Nightvision",
  ambush: "Ambush",
  growthTime: "Growth Time",
  hungerDrain: "Hunger Drain",
  thirstDrain: "Thirst Drain",
  moistureTime: "Moisture Time",
  oxygenTime: "Oxygen Time",
};

// Groups numeric stats for the Search column picker + sort UI. Every
// NumericStatField appears in exactly one group, grouped by what the stat
// actually governs (not lumped into one giant "Combat" bucket).
export const NUMERIC_STAT_CATEGORIES: ReadonlyArray<{ label: string; fields: NumericStatField[] }> = [
  {
    label: "General",
    fields: ["tier", "health", "weight", "healthRegen"],
  },
  {
    label: "Offense",
    fields: ["damage", "damage2", "biteCooldown"],
  },
  {
    label: "Stamina",
    fields: ["stamina", "stamRegen", "breathResistance"],
  },
  {
    label: "Movement",
    fields: ["walkAndSwimSpeed", "sprintSpeed", "turn", "beachSpeed", "flySpeed", "flySprintMultiplier", "glideStaminaRegen", "takeoffMultiplier", "jumpPower", "jumpStamina", "jumpAge", "dartPower", "dartStamina"],
  },
  {
    label: "Survival",
    fields: ["nightvision", "ambush", "hungerDrain", "thirstDrain", "moistureTime", "oxygenTime", "appetite"],
  },
  {
    label: "Growth",
    fields: ["growthTime", "venerationRate"],
  },
];

export const CATEGORICAL_STAT_LABELS: Record<CategoricalStatField, string> = {
  type: "Type",
  diet: "Diet",
  breath: "Breath",
  mobilityOverride: "Mobility Override",
  subspecies: "Variant",
};

export const ABILITY_KIND_LABELS: Record<AbilityKind, string> = {
  passiveOrActivated: "Passives / Activated",
  breath: "Breath",
  special: "Special",
  other: "Other (effects)",
};

export const STATUS_SLOT_LABELS: Record<StatusSlot, string> = {
  offensive: "Offensive (apply on hit)",
  defensive: "Defensive (apply on hit taken)",
  resist: "Resist",
};

export const COMPARATOR_LABELS: Record<NumericComparator, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
};

// ---------------------------------------------------------------------------
// Predicate model
// ---------------------------------------------------------------------------

export type Predicate =
  | { kind: "stat-num"; field: NumericStatField; op: NumericComparator; value: number }
  | { kind: "stat-cat"; field: CategoricalStatField; op: EqualityComparator; value: string }
  | { kind: "ability"; abilityKind: AbilityKind; name: string; mode: "has" | "lacks" }
  | { kind: "status"; slot: StatusSlot; status: string; op: NumericComparator; value: number };

export type QueryGroup = {
  kind: "group";
  id: string;
  combinator: "and" | "or";
  children: QueryNode[];
  // Optional per-gap operators (used by the beta builder). `combinators[i]` is
  // the AND/OR that joins children[i] and children[i+1]. When present, the group
  // evaluates with AND-over-OR precedence (AND binds tighter than OR, like SQL).
  // When absent, `combinator` applies uniformly (the classic builder). The
  // length is kept at max(0, children.length - 1).
  combinators?: ("and" | "or")[];
};

export type PredicateNode = {
  kind: "predicate";
  id: string;
  predicate: Predicate;
};

export type QueryNode = QueryGroup | PredicateNode;

// ---------------------------------------------------------------------------
// Joined view per creature for evaluation
// ---------------------------------------------------------------------------

export type SearchableCreature = {
  creature: CreatureRuntime;
  effects: EffectsCatalogByCreature;
  /** True when this creature is a subspecies of another (e.g. "Icebreaker
   *  Meorlark"). Derived from the roster at load; see shared/subspecies.ts. */
  isSubspecies: boolean;
  /** The base creature name a subspecies derives from, else null. */
  subspeciesBase: string | null;
};

const TIER_BY_NAME = new Map(creaturesData.map((creature) => [creature.name.toLowerCase(), creature.stats.tier]));
const SUBSPECIES_BASE_BY_NAME = computeSubspecies(
  creaturesData.map((creature) => creature.name),
  subspeciesOverridesData as SubspeciesOverrides,
  (name) => TIER_BY_NAME.get(name.toLowerCase()),
);

export const SEARCHABLE_CREATURES: SearchableCreature[] = creaturesData.map((creature) => ({
  creature,
  effects: effectsCatalog[creature.name] ?? {},
  isSubspecies: SUBSPECIES_BASE_BY_NAME.has(creature.name),
  subspeciesBase: SUBSPECIES_BASE_BY_NAME.get(creature.name) ?? null,
}));

// ---------------------------------------------------------------------------
// Dropdown content (collected once at module load)
// ---------------------------------------------------------------------------

function collectCategoricalValues(field: CategoricalStatField): string[] {
  const seen = new Set<string>();
  for (const { creature } of SEARCHABLE_CREATURES) {
    const raw = (creature.stats as Record<string, unknown>)[field];
    if (typeof raw === "string" && raw.trim()) seen.add(raw.trim());
  }
  return [...seen].sort((left, right) => left.localeCompare(right));
}

export const CATEGORICAL_VALUE_OPTIONS: Record<CategoricalStatField, string[]> = {
  type: collectCategoricalValues("type"),
  diet: collectCategoricalValues("diet"),
  breath: collectCategoricalValues("breath"),
  mobilityOverride: collectCategoricalValues("mobilityOverride"),
  // Not a stat - derived per creature; the evaluator special-cases this field.
  subspecies: ["Subspecies", "Base"],
};

function collectAbilityNamesByKind(): Record<AbilityKind, string[]> {
  const buckets: Record<AbilityKind, Set<string>> = {
    passiveOrActivated: new Set(),
    breath: new Set(),
    special: new Set(),
    other: new Set(),
  };
  for (const { creature, effects } of SEARCHABLE_CREATURES) {
    for (const entry of creature.passiveAbilities ?? []) buckets.passiveOrActivated.add(entry.name);
    for (const entry of creature.activatedAbilities ?? []) buckets.passiveOrActivated.add(entry.name);
    for (const entry of creature.breathAbilities ?? []) buckets.breath.add(entry.name);
    for (const entry of effects.specialAbilities ?? []) buckets.special.add(entry.name);
    for (const entry of effects.specialAbilitiesDetailed ?? []) buckets.special.add(entry.name);
    for (const entry of effects.otherAbilities ?? []) buckets.other.add(entry.name);
  }
  return {
    passiveOrActivated: [...buckets.passiveOrActivated].sort((a, b) => a.localeCompare(b)),
    breath: [...buckets.breath].sort((a, b) => a.localeCompare(b)),
    special: [...buckets.special].sort((a, b) => a.localeCompare(b)),
    other: [...buckets.other].sort((a, b) => a.localeCompare(b)),
  };
}

export const ABILITY_NAMES_BY_KIND: Record<AbilityKind, string[]> = collectAbilityNamesByKind();

function collectStatusNamesBySlot(): Record<StatusSlot, string[]> {
  const buckets: Record<StatusSlot, Set<string>> = {
    offensive: new Set(),
    defensive: new Set(),
    resist: new Set(),
  };
  for (const { effects } of SEARCHABLE_CREATURES) {
    for (const entry of effects.applyStatusOnHit ?? []) buckets.offensive.add(entry.statusId);
    for (const entry of effects.applyStatusOnHitTaken ?? []) buckets.defensive.add(entry.statusId);
    for (const entry of effects.resistStatus ?? []) buckets.resist.add(entry.statusId);
  }
  return {
    offensive: [...buckets.offensive].sort((a, b) => a.localeCompare(b)),
    defensive: [...buckets.defensive].sort((a, b) => a.localeCompare(b)),
    resist: [...buckets.resist].sort((a, b) => a.localeCompare(b)),
  };
}

const STATUS_IDS_BY_SLOT = collectStatusNamesBySlot();

// Map raw `statusId` ("Burn_Status") -> friendly display name ("Burn").
// Prefer the catalog when it knows the id; otherwise humanize.
const STATUS_CATALOG_ID_TO_NAME = new Map(STATUS_CATALOG.map((entry) => [entry.id, entry.name]));

export function statusIdToDisplayName(statusId: string): string {
  const catalog = STATUS_CATALOG_ID_TO_NAME.get(statusId);
  if (catalog) return catalog;
  return statusId
    .replace(/_Status$/i, "")
    .replace(/_/g, " ")
    .trim();
}

export const STATUS_OPTIONS_BY_SLOT: Record<StatusSlot, Array<{ id: string; label: string }>> = {
  offensive: STATUS_IDS_BY_SLOT.offensive.map((id) => ({ id, label: statusIdToDisplayName(id) })),
  defensive: STATUS_IDS_BY_SLOT.defensive.map((id) => ({ id, label: statusIdToDisplayName(id) })),
  resist: STATUS_IDS_BY_SLOT.resist.map((id) => ({ id, label: statusIdToDisplayName(id) })),
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function compare(a: number, op: NumericComparator, b: number): boolean {
  switch (op) {
    case "eq": return a === b;
    case "neq": return a !== b;
    case "gt": return a > b;
    case "lt": return a < b;
    case "gte": return a >= b;
    case "lte": return a <= b;
  }
}

function evaluatePredicate(target: SearchableCreature, predicate: Predicate): boolean {
  const { creature, effects } = target;
  switch (predicate.kind) {
    case "stat-num": {
      const raw = (creature.stats as Record<string, unknown>)[predicate.field];
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        // Field absent on this creature. Equality-to-0 / less-than checks
        // shouldn't accidentally match - treat "no value" as not matching.
        return false;
      }
      return compare(raw, predicate.op, predicate.value);
    }
    case "stat-cat": {
      // `subspecies` is derived per creature (not a stat field); every other
      // categorical field reads straight off `creature.stats`.
      let value: string;
      if (predicate.field === "subspecies") {
        value = target.isSubspecies ? "Subspecies" : "Base";
      } else {
        const raw = (creature.stats as Record<string, unknown>)[predicate.field];
        value = typeof raw === "string" ? raw.trim() : "";
      }
      const equal = value.toLowerCase() === predicate.value.trim().toLowerCase();
      return predicate.op === "eq" ? equal : !equal;
    }
    case "ability": {
      const lists: Array<Array<{ name: string }> | undefined> = (() => {
        switch (predicate.abilityKind) {
          case "passiveOrActivated": return [creature.passiveAbilities, creature.activatedAbilities];
          case "breath": return [creature.breathAbilities];
          case "special": return [effects.specialAbilities, effects.specialAbilitiesDetailed];
          case "other": return [effects.otherAbilities];
        }
      })();
      const has = lists.some((list) =>
        (list ?? []).some((entry) => entry.name === predicate.name),
      );
      return predicate.mode === "has" ? has : !has;
    }
    case "status": {
      const list = (() => {
        switch (predicate.slot) {
          case "offensive": return effects.applyStatusOnHit ?? [];
          case "defensive": return effects.applyStatusOnHitTaken ?? [];
          case "resist": return effects.resistStatus ?? [];
        }
      })();
      const totalValue = list
        .filter((entry) => entry.statusId === predicate.status)
        .reduce((sum, entry) => {
          if ("stacks" in entry) return sum + entry.stacks;
          if ("fraction" in entry) return sum + entry.fraction;
          return sum;
        }, 0);
      return compare(totalValue, predicate.op, predicate.value);
    }
  }
}

export function evaluateNode(target: SearchableCreature, node: QueryNode): boolean {
  if (node.kind === "predicate") return evaluatePredicate(target, node.predicate);
  // Empty groups match nothing for AND (vacuously true wastes the user's
  // attention - they typed a group, we should treat it as "no result")
  // and nothing for OR (no children to satisfy). Better UX: empty group
  // is a no-op (true) so the user can build incrementally.
  if (node.children.length === 0) return true;
  // Per-gap operators with AND-over-OR precedence: OR separates runs of AND-ed
  // children, each run is AND-ed, the runs are OR-ed (A AND B OR C -> (A AND B) OR C).
  const combinators = node.combinators;
  if (combinators && combinators.length === node.children.length - 1) {
    let result = false;
    let run = evaluateNode(target, node.children[0]);
    for (let i = 1; i < node.children.length; i += 1) {
      const value = evaluateNode(target, node.children[i]);
      if (combinators[i - 1] === "and") {
        run = run && value;
      } else {
        result = result || run;
        run = value;
      }
    }
    return result || run;
  }
  if (node.combinator === "and") return node.children.every((child) => evaluateNode(target, child));
  return node.children.some((child) => evaluateNode(target, child));
}

export function runSearch(node: QueryNode): SearchableCreature[] {
  return SEARCHABLE_CREATURES.filter((target) => evaluateNode(target, node));
}

/**
 * Walk the query tree and collect what each predicate mentions, so the
 * Results UI can highlight matched fields and surface abilities /
 * statuses as badges on the result cards. Returned sets/arrays
 * intentionally include EVERY predicate the tree contains, regardless
 * of AND/OR scope - the user's mental model of "what did I ask about"
 * doesn't change based on combinator.
 */
export type QueryFieldSummary = {
  numericFields: Set<NumericStatField>;
  categoricalFields: Set<CategoricalStatField>;
  abilityPredicates: Array<Extract<Predicate, { kind: "ability" }>>;
  statusPredicates: Array<Extract<Predicate, { kind: "status" }>>;
};

export function summarizeQueriedFields(node: QueryNode): QueryFieldSummary {
  const summary: QueryFieldSummary = {
    numericFields: new Set(),
    categoricalFields: new Set(),
    abilityPredicates: [],
    statusPredicates: [],
  };
  walk(node, summary);
  return summary;
}

function walk(node: QueryNode, summary: QueryFieldSummary): void {
  if (node.kind === "group") {
    for (const child of node.children) walk(child, summary);
    return;
  }
  switch (node.predicate.kind) {
    case "stat-num":
      summary.numericFields.add(node.predicate.field);
      break;
    case "stat-cat":
      summary.categoricalFields.add(node.predicate.field);
      break;
    case "ability":
      summary.abilityPredicates.push(node.predicate);
      break;
    case "status":
      summary.statusPredicates.push(node.predicate);
      break;
  }
}

// ---------------------------------------------------------------------------
// Factories - used by the UI when the user clicks "Add condition"
// ---------------------------------------------------------------------------

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function createEmptyRootGroup(): QueryGroup {
  return { kind: "group", id: nextId("g"), combinator: "and", children: [] };
}

export function createDefaultPredicateNode(kind: Predicate["kind"]): PredicateNode {
  return { kind: "predicate", id: nextId("p"), predicate: createDefaultPredicate(kind) };
}

export function createDefaultPredicate(kind: Predicate["kind"]): Predicate {
  switch (kind) {
    case "stat-num":
      return { kind: "stat-num", field: "health", op: "gte", value: 1000 };
    case "stat-cat":
      return {
        kind: "stat-cat",
        field: "diet",
        op: "eq",
        value: CATEGORICAL_VALUE_OPTIONS.diet[0] ?? "",
      };
    case "ability":
      return {
        kind: "ability",
        abilityKind: "passiveOrActivated",
        name: ABILITY_NAMES_BY_KIND.passiveOrActivated[0] ?? "",
        mode: "has",
      };
    case "status":
      return {
        kind: "status",
        slot: "offensive",
        status: STATUS_OPTIONS_BY_SLOT.offensive[0]?.id ?? "",
        op: "gte",
        value: 1,
      };
  }
}

export function createSubGroup(): QueryGroup {
  return { kind: "group", id: nextId("g"), combinator: "or", children: [] };
}

// ---------------------------------------------------------------------------
// Tree update helpers (immutable)
// ---------------------------------------------------------------------------

export function updateNode(
  root: QueryGroup,
  targetId: string,
  patch: (node: QueryNode) => QueryNode,
): QueryGroup {
  const next: QueryNode = mapTree(root, targetId, patch);
  // mapTree guarantees the root remains a group when the targetId chain
  // doesn't end at the root; type-cast is safe because the only path to
  // a non-group return value is `targetId === root.id`, handled here.
  if (next.kind === "group") return next;
  // Defensive - shouldn't happen since root is a group.
  return root;
}

function mapTree(node: QueryNode, targetId: string, patch: (node: QueryNode) => QueryNode): QueryNode {
  if (node.id === targetId) return patch(node);
  if (node.kind === "group") {
    return { ...node, children: node.children.map((child) => mapTree(child, targetId, patch)) };
  }
  return node;
}

export function removeNode(root: QueryGroup, targetId: string): QueryGroup {
  if (targetId === root.id) return withNormalizedCombinators({ ...root, children: [] });
  const next = removeFromTree(root, targetId);
  return next.kind === "group" ? next : root;
}

function removeFromTree(node: QueryNode, targetId: string): QueryNode {
  if (node.kind !== "group") return node;
  return withNormalizedCombinators({
    ...node,
    children: node.children
      .filter((child) => child.id !== targetId)
      .map((child) => removeFromTree(child, targetId)),
  });
}

export function appendChild(root: QueryGroup, parentId: string, child: QueryNode): QueryGroup {
  return updateNode(root, parentId, (node) => {
    if (node.kind !== "group") return node;
    return withNormalizedCombinators({ ...node, children: [...node.children, child] });
  });
}

// Keep a group's per-gap `combinators` array (when present) at length
// children.length - 1: trim extra from the end, pad new gaps with the group's
// uniform `combinator` default. Groups without per-gap operators (the classic
// builder) are returned untouched, so they keep evaluating uniformly.
function withNormalizedCombinators(group: QueryGroup): QueryGroup {
  if (!group.combinators) return group;
  const need = Math.max(0, group.children.length - 1);
  if (group.combinators.length === need) return group;
  const next = group.combinators.slice(0, need);
  while (next.length < need) next.push(group.combinator);
  return { ...group, combinators: next };
}

/** Effective operator joining children[index] and children[index+1] - the
 * per-gap value when set, else the group's uniform combinator. */
export function groupCombinatorAt(group: QueryGroup, index: number): "and" | "or" {
  return group.combinators?.[index] ?? group.combinator;
}

/** Set the operator for a single gap, materializing the per-gap array from the
 * uniform combinator on first use. */
export function setGroupCombinatorAt(
  root: QueryGroup,
  groupId: string,
  index: number,
  op: "and" | "or",
): QueryGroup {
  return updateNode(root, groupId, (node) => {
    if (node.kind !== "group") return node;
    const need = Math.max(0, node.children.length - 1);
    if (index < 0 || index >= need) return node;
    const next = (node.combinators ?? []).slice(0, need);
    while (next.length < need) next.push(node.combinator);
    next[index] = op;
    return { ...node, combinators: next };
  });
}

export function findNode(root: QueryNode, targetId: string): QueryNode | null {
  if (root.id === targetId) return root;
  if (root.kind !== "group") return null;
  for (const child of root.children) {
    const found = findNode(child, targetId);
    if (found) return found;
  }
  return null;
}

/**
 * Move `nodeId` to be a child of `targetGroupId`, inserted immediately before
 * `beforeId` (or appended to the end when `beforeId` is null). Powers the
 * Search builder's drag-to-move: reorder within a group, move a condition into
 * another group, etc. Only predicate nodes are dragged in the UI, so there is
 * no cycle risk (a group is never dropped into its own descendant). A no-op
 * when the node is missing or would land exactly before itself.
 */
export function moveNode(
  root: QueryGroup,
  nodeId: string,
  targetGroupId: string,
  beforeId: string | null,
): QueryGroup {
  if (nodeId === beforeId) return root;
  const node = findNode(root, nodeId);
  if (!node) return root;
  const detached = removeNode(root, nodeId);
  return updateNode(detached, targetGroupId, (parent) => {
    if (parent.kind !== "group") return parent;
    const children = [...parent.children];
    if (beforeId == null) return withNormalizedCombinators({ ...parent, children: [...children, node] });
    const index = children.findIndex((child) => child.id === beforeId);
    if (index < 0) return withNormalizedCombinators({ ...parent, children: [...children, node] });
    children.splice(index, 0, node);
    return withNormalizedCombinators({ ...parent, children });
  });
}
