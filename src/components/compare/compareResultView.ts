import type { SimulationSummary } from "../../engine";
import { BREATH_TICK_SEC } from "../../engine/subsystems/timing";

type CombatLogEntry = NonNullable<SimulationSummary["combatLog"]>[number];

export type CompareResultViewMode = "firstDeath" | "fullFight";

export type ViewCombatLogEntry = CombatLogEntry & {
  timelineKindOverride?: "death";
  syntheticKey?: string;
};

/**
 * User-controllable filter for what the Outcome panel's DPS number
 * reflects. Each category corresponds to one of the four
 * `CombatLogEntry.type` values the engine emits. Denominator picks
 * what we divide the filtered total damage by — time (classic DPS)
 * or bite count (average damage per bite swing).
 */
export type CompareDpsCategory = "bite" | "breath" | "dot" | "ability";
export type CompareDpsDenominator = "perSecond" | "perBite";

export type CompareDpsSettings = {
  categories: Record<CompareDpsCategory, boolean>;
  denominator: CompareDpsDenominator;
};

export const DEFAULT_COMPARE_DPS_SETTINGS: CompareDpsSettings = {
  categories: { bite: true, breath: true, dot: true, ability: true },
  denominator: "perSecond",
};

function parseAppliedStacks(entry: CombatLogEntry): number | null {
  const match = (entry.description ?? "").match(/\(([-+]?\d+(?:\.\d+)?)\)\s*$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseDecayToStacks(entry: CombatLogEntry): number | null {
  const match = (entry.detail ?? "").match(/->\s*([-+]?\d+(?:\.\d+)?)\s*stacks/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseAbilityUsageName(entry: CombatLogEntry): string | null {
  const description = entry.description ?? "";
  if (!description) return null;
  if (description.includes(" applied ")) return null;
  if (description.includes(" removed ")) return null;
  if (description.includes("naturally decayed") || description.includes("naturally expired")) return null;
  if (description === "Life Leech heal") return null;
  if (description === "Reflux impact" || description === "Reflux puddle tick") return null;
  if (description.startsWith("Reflect (")) return null;
  if (description === "Natural regen") return null;
  const breathHeal = description.match(/^(Heal Breath|Cloud Breath|Miasma Breath) heal$/);
  if (breathHeal) return breathHeal[1];

  const activated = description.match(/^(.*) activated$/);
  if (activated) return activated[1];
  const deactivated = description.match(/^(.*) deactivated$/);
  if (deactivated) return deactivated[1];
  const active = description.match(/^(.*) active$/);
  if (active) return active[1];
  if (description === "Reflux charge started") return "Reflux";
  if (description === "Shadow Barrage") return "Shadow Barrage";
  if (description === "Frost Nova") return "Frost Nova";
  if (description === "Power Charge") return "Power Charge";
  if (description === "Gore Charge") return "Gore Charge";
  return null;
}

export function getActualBattleEndTime(summary: SimulationSummary): number {
  const lastLogTime = Math.max(0, ...((summary.combatLog ?? []).map((entry) => entry.time)));
  const deathTimes = [summary.deathTimeA ?? 0, summary.deathTimeB ?? 0];
  return Math.max(lastLogTime, ...deathTimes, 0);
}

export function getFirstDeathTime(summary: SimulationSummary): number {
  const deathTimes = [summary.deathTimeA, summary.deathTimeB].filter((value): value is number => value != null);
  if (deathTimes.length === 0) return getActualBattleEndTime(summary);
  return Math.min(...deathTimes);
}

export function getViewCutoffTime(summary: SimulationSummary, mode: CompareResultViewMode): number {
  return mode === "firstDeath" ? getFirstDeathTime(summary) : getActualBattleEndTime(summary);
}

function getDamageDealtUntil(
  summary: SimulationSummary,
  side: "A" | "B",
  cutoffTime: number,
  categories?: Record<CompareDpsCategory, boolean>,
): number {
  return (summary.combatLog ?? [])
    .filter((entry) => entry.attacker === side && entry.time <= cutoffTime + 1e-9)
    .filter((entry) => {
      if (!categories) return true;
      // CombatLogEntry.type ∈ {"bite", "dot", "breath", "ability"}
      // exactly matches CompareDpsCategory, so the lookup is safe.
      return categories[entry.type as CompareDpsCategory] !== false;
    })
    .reduce((total, entry) => total + Math.max(0, entry.damage), 0);
}

function getBiteCountUntil(summary: SimulationSummary, side: "A" | "B", cutoffTime: number): number {
  return (summary.combatLog ?? []).filter(
    (entry) => entry.attacker === side && entry.type === "bite" && entry.time <= cutoffTime + 1e-9,
  ).length;
}

function buildStatusSnapshot(summary: SimulationSummary, side: "A" | "B", cutoffTime: number): Record<string, number> {
  const stacksByStatus = new Map<string, number>();
  const relevant = (summary.combatLog ?? [])
    .filter((entry) => entry.time <= cutoffTime + 1e-9)
    .sort((left, right) => left.time - right.time);

  for (const entry of relevant) {
    if (!entry.statusId) continue;
    if ((entry.description ?? "").includes(" applied ") && entry.hpSide === side) {
      const applied = parseAppliedStacks(entry);
      if (applied == null || applied <= 0) continue;
      stacksByStatus.set(entry.statusId, (stacksByStatus.get(entry.statusId) ?? 0) + applied);
      continue;
    }
    if ((entry.description ?? "").includes(" removed ") && entry.hpSide === side) {
      const nextStacks = parseDecayToStacks(entry);
      if (nextStacks != null) {
        if (nextStacks <= 0) stacksByStatus.delete(entry.statusId);
        else stacksByStatus.set(entry.statusId, nextStacks);
        continue;
      }
      const removed = parseAppliedStacks(entry);
      if (removed == null || removed <= 0) continue;
      const next = (stacksByStatus.get(entry.statusId) ?? 0) - removed;
      if (next <= 0) stacksByStatus.delete(entry.statusId);
      else stacksByStatus.set(entry.statusId, next);
      continue;
    }
    if ((entry.description ?? "").includes("naturally decayed") && entry.attacker === side) {
      const nextStacks = parseDecayToStacks(entry);
      if (nextStacks == null) continue;
      if (nextStacks <= 0) stacksByStatus.delete(entry.statusId);
      else stacksByStatus.set(entry.statusId, nextStacks);
      continue;
    }
    if ((entry.description ?? "").includes("naturally expired") && entry.attacker === side) {
      stacksByStatus.delete(entry.statusId);
    }
  }

  return Object.fromEntries(
    Array.from(stacksByStatus.entries()).filter(([, stacks]) => stacks > 0),
  );
}

export function getViewMetrics(
  summary: SimulationSummary,
  mode: CompareResultViewMode,
  dpsSettings: CompareDpsSettings = DEFAULT_COMPARE_DPS_SETTINGS,
) {
  const cutoffTime = getViewCutoffTime(summary, mode);
  // `damageDealt*` always reflects the unfiltered total — it has its own
  // "Damage Dealt A/B" line in the Outcome panel and serves the
  // "Copy summary" workflow. The category filter only applies to the
  // DPS denominator pair below.
  const damageDealtA = getDamageDealtUntil(summary, "A", cutoffTime);
  const damageDealtB = getDamageDealtUntil(summary, "B", cutoffTime);
  let dpsAtoB = 0;
  let dpsBtoA = 0;
  if (dpsSettings.denominator === "perBite") {
    // Per-bite mode is intentionally fixed: numerator = bite damage only,
    // denominator = bite count. Other categories (breath / ailments /
    // abilities) are tied to time and don't translate to a "per swing"
    // metric. Ability-driven bite buffs (e.g. damage steroids) are
    // already baked into the bite entries the engine emits, so excluding
    // the ability/dot/breath categories here doesn't lose that signal.
    const biteOnly: Record<CompareDpsCategory, boolean> = {
      bite: true,
      breath: false,
      dot: false,
      ability: false,
    };
    const biteDamageA = getDamageDealtUntil(summary, "A", cutoffTime, biteOnly);
    const biteDamageB = getDamageDealtUntil(summary, "B", cutoffTime, biteOnly);
    const biteCountA = getBiteCountUntil(summary, "A", cutoffTime);
    const biteCountB = getBiteCountUntil(summary, "B", cutoffTime);
    dpsAtoB = biteCountA > 0 ? biteDamageA / biteCountA : 0;
    dpsBtoA = biteCountB > 0 ? biteDamageB / biteCountB : 0;
  } else {
    const filteredDamageA = getDamageDealtUntil(summary, "A", cutoffTime, dpsSettings.categories);
    const filteredDamageB = getDamageDealtUntil(summary, "B", cutoffTime, dpsSettings.categories);
    dpsAtoB = cutoffTime > 0 ? filteredDamageA / cutoffTime : 0;
    dpsBtoA = cutoffTime > 0 ? filteredDamageB / cutoffTime : 0;
  }

  return {
    cutoffTime,
    damageDealtA,
    damageDealtB,
    dpsAtoB,
    dpsBtoA,
  };
}

export function getViewCombatLog(summary: SimulationSummary, mode: CompareResultViewMode): ViewCombatLogEntry[] {
  const cutoffTime = getViewCutoffTime(summary, mode);
  const filtered = (summary.combatLog ?? []).filter((entry) => entry.time <= cutoffTime + 1e-9);
  const entries: ViewCombatLogEntry[] = [...filtered];

  if (summary.deathTimeA != null && summary.deathTimeA <= cutoffTime + 1e-9) {
    entries.push({
      time: summary.deathTimeA,
      type: "ability",
      attacker: "A",
      damage: 0,
      actorHpAfter: 0,
      hpSide: "A",
      hpAfter: 0,
      description: "Death",
      detail: "A died",
      timelineKindOverride: "death",
      syntheticKey: "death-A",
    });
  }
  if (summary.deathTimeB != null && summary.deathTimeB <= cutoffTime + 1e-9) {
    entries.push({
      time: summary.deathTimeB,
      type: "ability",
      attacker: "B",
      damage: 0,
      actorHpAfter: 0,
      hpSide: "B",
      hpAfter: 0,
      description: "Death",
      detail: "B died",
      timelineKindOverride: "death",
      syntheticKey: "death-B",
    });
  }

  return entries.sort((left, right) => {
    if (left.time !== right.time) return left.time - right.time;
    if ((left.timelineKindOverride === "death") !== (right.timelineKindOverride === "death")) {
      return left.timelineKindOverride === "death" ? 1 : -1;
    }
    return 0;
  });
}

export function getViewDetails(summary: SimulationSummary, mode: CompareResultViewMode, side: "A" | "B") {
  const cutoffTime = getViewCutoffTime(summary, mode);
  const log = (summary.combatLog ?? []).filter((entry) => entry.time <= cutoffTime + 1e-9);
  const biteEntries = log.filter((entry) => entry.attacker === side && entry.type === "bite");
  const biteCount = biteEntries.length;
  // P3: derive primary/secondary split from the engine's bite-event
  // description ("Bite hit" vs "Secondary bite hit"). The engine emits
  // these unconditionally for every bite — see
  // `wasm-engine/src/composable/phases.rs` after the variant decision.
  // Default (no chip toggle) ⇒ every bite is primary ⇒ secondary count
  // is 0, and the UI collapses to the legacy "Bites: N" label.
  const secondaryBiteCount = biteEntries.filter(
    (entry) => entry.description === "Secondary bite hit",
  ).length;
  const primaryBiteCount = biteCount - secondaryBiteCount;
  // Breath Time in seconds = (count of unique tick timestamps) × BREATH_TICK_SEC.
  // Damage breaths log a single "Breath tick" entry per tick. Heal
  // breaths (Heal/Cloud/Miasma) log a "<X> Breath heal" entry per
  // tick — both halves of a damage+heal breath (Cloud / Miasma) fire
  // at the same tick timestamp, so the Set collapses them into one
  // tick and avoids double-counting.
  const breathTickTimes = new Set<number>();
  for (const entry of log) {
    if (entry.attacker === side && entry.type === "breath") {
      breathTickTimes.add(entry.time);
    }
  }
  const breathTimeSec = breathTickTimes.size * BREATH_TICK_SEC;

  const abilityCounts = new Map<string, number>();
  for (const entry of log) {
    if (entry.attacker !== side || entry.type !== "ability") continue;
    const name = parseAbilityUsageName(entry);
    if (!name || name === "Breath") continue;
    abilityCounts.set(name, (abilityCounts.get(name) ?? 0) + 1);
  }

  const abilities = Array.from(abilityCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

  const finalEffects = Object.entries(buildStatusSnapshot(summary, side, cutoffTime))
    .map(([statusId, stacks]) => ({
      name: statusId.replace(/_Status$/i, "").replace(/_/g, " "),
      stacks,
    }))
    .sort((left, right) => right.stacks - left.stacks || left.name.localeCompare(right.name));

  const dotDamageByStatus = new Map<string, number>();
  for (const entry of log) {
    if (entry.type !== "dot" || entry.hpSide !== side || entry.damage <= 0 || !entry.statusId) continue;
    dotDamageByStatus.set(entry.statusId, (dotDamageByStatus.get(entry.statusId) ?? 0) + entry.damage);
  }
  const dotDamageBreakdown = Array.from(dotDamageByStatus.entries())
    .map(([statusId, damage]) => ({
      name: statusId.replace(/_Status$/i, "").replace(/_/g, " "),
      damage,
    }))
    .sort((left, right) => right.damage - left.damage || left.name.localeCompare(right.name));

  return {
    biteCount,
    primaryBiteCount,
    secondaryBiteCount,
    breathTimeSec,
    abilities,
    finalEffects,
    dotDamageBreakdown,
  };
}
