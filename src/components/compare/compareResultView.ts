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
 * what we divide the filtered total damage by - time (classic DPS)
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
  // "X (manual)" markers (e.g. Warden's Rage's manual-held sub-window) only
  // accent the timeline lane; the base "X" event already counts the use.
  if (description.includes("(manual)")) return null;
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
  // A "deactivated" entry closes an active window - it is the END of a use,
  // not a new use. Counting it inflates every toggled/passive ability by one
  // (e.g. First Strike reads "2" for a single on->off, Spite "2" for one cast).
  // The window itself is rendered from the timeline, not this usage counter.
  if (/ deactivated$/.test(description)) return null;
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

export function getDamageDealtUntil(
  summary: SimulationSummary,
  side: "A" | "B",
  cutoffTime: number,
  categories?: Record<CompareDpsCategory, boolean>,
): number {
  return (summary.combatLog ?? [])
    .filter((entry) => entry.attacker === side && entry.time <= cutoffTime + 1e-9)
    .filter((entry) => {
      if (!categories) return true;
      // CombatLogEntry.type is one of "bite", "dot", "breath", "ability",
      // which is exactly CompareDpsCategory, so the lookup is safe.
      return categories[entry.type as CompareDpsCategory] !== false;
    })
    .reduce((total, entry) => total + Math.max(0, entry.damage), 0);
}

function getBiteCountUntil(summary: SimulationSummary, side: "A" | "B", cutoffTime: number): number {
  return (summary.combatLog ?? []).filter(
    (entry) => entry.attacker === side && entry.type === "bite" && entry.time <= cutoffTime + 1e-9,
  ).length;
}

export function buildStatusSnapshot(summary: SimulationSummary, side: "A" | "B", cutoffTime: number): Record<string, number> {
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

// Active intervals per status for one side, derived event-driven (O(n)) from
// the same applied/removed/decayed/expired transitions as buildStatusSnapshot.
// A segment runs from when a status' stacks go 0 -> >0 until they return to 0
// (or the battle end if still up). Used by the beta playback's activity lanes.
export function buildStatusIntervals(
  summary: SimulationSummary,
  side: "A" | "B",
  endT: number,
): { label: string; segments: { from: number; to: number }[] }[] {
  const stacks = new Map<string, number>();
  const openFrom = new Map<string, number>();
  const out = new Map<string, { from: number; to: number }[]>();
  const pushSeg = (id: string, seg: { from: number; to: number }) => {
    if (seg.to <= seg.from) return;
    const arr = out.get(id);
    if (arr) arr.push(seg);
    else out.set(id, [seg]);
  };
  const apply = (id: string, next: number, time: number) => {
    const prev = stacks.get(id) ?? 0;
    if (next <= 0) {
      if (prev > 0 && openFrom.has(id)) {
        pushSeg(id, { from: openFrom.get(id)!, to: time });
        openFrom.delete(id);
      }
      stacks.delete(id);
    } else {
      if (prev <= 0) openFrom.set(id, time);
      stacks.set(id, next);
    }
  };
  const log = (summary.combatLog ?? []).filter((e) => e.time <= endT + 1e-9).slice().sort((l, r) => l.time - r.time);
  for (const entry of log) {
    if (!entry.statusId) continue;
    const d = entry.description ?? "";
    if (d.includes(" applied ") && entry.hpSide === side) {
      const applied = parseAppliedStacks(entry);
      if (applied == null || applied <= 0) continue;
      apply(entry.statusId, (stacks.get(entry.statusId) ?? 0) + applied, entry.time);
    } else if (d.includes(" removed ") && entry.hpSide === side) {
      const next = parseDecayToStacks(entry);
      if (next != null) apply(entry.statusId, next, entry.time);
      else {
        const removed = parseAppliedStacks(entry);
        if (removed == null || removed <= 0) continue;
        apply(entry.statusId, (stacks.get(entry.statusId) ?? 0) - removed, entry.time);
      }
    } else if (d.includes("naturally decayed") && entry.attacker === side) {
      const next = parseDecayToStacks(entry);
      if (next == null) continue;
      apply(entry.statusId, next, entry.time);
    } else if (d.includes("naturally expired") && entry.attacker === side) {
      apply(entry.statusId, 0, entry.time);
    } else if (/\btick$/.test(d) && entry.hpSide === side) {
      // Backstop: a DOT tick proves the status is active on this side even when
      // its application was never traced (a carrier that applies via the raw,
      // non-logging helper). Open a lane if none is open so the status still
      // shows; never overwrite an already-open segment's stacks. The existing
      // removed/decayed/expired branches close it. Keeps the timeline robust to
      // any future un-traced DOT carrier instead of silently dropping it.
      if ((stacks.get(entry.statusId) ?? 0) <= 0) apply(entry.statusId, 1, entry.time);
    }
  }
  for (const [id, from] of openFrom) pushSeg(id, { from, to: endT });
  return Array.from(out.entries()).map(([id, segments]) => ({
    label: id.replace(/_Status$/i, "").replace(/_/g, " "),
    segments,
  }));
}

export function getViewMetrics(
  summary: SimulationSummary,
  mode: CompareResultViewMode,
  dpsSettings: CompareDpsSettings = DEFAULT_COMPARE_DPS_SETTINGS,
) {
  const cutoffTime = getViewCutoffTime(summary, mode);
  // `damageDealt*` always reflects the unfiltered total - it has its own
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

/**
 * Mode-aware Effective HP = (max HP + healing actually restored up to the view
 * cutoff) x the side's damage-reduction amplification (Hunker/Guilt, from the
 * engine). "How much raw damage this build could soak in this window."
 *
 * Healing is summed from the combat log up to the cutoff, so it's the REAL
 * healing in the window - not a time-averaged guess. In "first death" mode a
 * 6 s kill with the first regen tick at 15 s therefore adds exactly 0 healing,
 * not a pro-rated sliver; in "full fight" mode the whole sim's healing counts.
 * The reduction multiplier is mode-independent (a build property).
 */
export function getViewEhp(
  summary: SimulationSummary,
  mode: CompareResultViewMode,
  side: "A" | "B",
): number {
  const cutoffTime = getViewCutoffTime(summary, mode);
  const maxHp = side === "A" ? summary.maxHpA : summary.maxHpB;
  const mult = (side === "A" ? summary.ehpMitigationMultA : summary.ehpMitigationMultB) ?? 1;
  const healingInWindow = (summary.combatLog ?? [])
    .filter((entry) => entry.hpSide === side && entry.time <= cutoffTime + 1e-9 && (entry.healing ?? 0) > 0)
    .reduce((total, entry) => total + (entry.healing ?? 0), 0);
  return (maxHp + healingInWindow) * mult;
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
  // Derive primary/secondary split from the engine's bite-event
  // description ("Bite hit" vs "Secondary bite hit"). The engine emits
  // these unconditionally for every bite - see
  // `wasm-engine/src/composable/phases.rs` after the variant decision.
  // Default (no chip toggle) => every bite is primary => secondary count
  // is 0, and the UI collapses to the legacy "Bites: N" label.
  const secondaryBiteCount = biteEntries.filter(
    (entry) => entry.description === "Secondary bite hit",
  ).length;
  const primaryBiteCount = biteCount - secondaryBiteCount;
  // Breath Time in seconds = (count of unique tick timestamps) x BREATH_TICK_SEC.
  // Damage breaths log a single "Breath tick" entry per tick. Heal
  // breaths (Heal/Cloud/Miasma) log a "<X> Breath heal" entry per
  // tick - both halves of a damage+heal breath (Cloud / Miasma) fire
  // at the same tick timestamp, so the Set collapses them into one
  // tick and avoids double-counting.
  const breathTickTimes = new Set<number>();
  for (const entry of log) {
    if (entry.attacker === side && entry.type === "breath") {
      breathTickTimes.add(entry.time);
    }
  }
  const breathTimeSec = breathTickTimes.size * BREATH_TICK_SEC;

  // Count distinct activations, collapsing same-instant duplicates of one
  // ability into a single use. Two "<X> activated" events at the SAME timestamp
  // can't be told apart on the timeline, so they read as one use here - a
  // defensive collapse against any same-tick double-log from the engine.
  const abilityCounts = new Map<string, number>();
  const seenActivation = new Set<string>();
  for (const entry of log) {
    if (entry.attacker !== side || entry.type !== "ability") continue;
    const name = parseAbilityUsageName(entry);
    if (!name || name === "Breath") continue;
    const instantKey = `${name}@${Math.round(entry.time * 1000)}`;
    if (seenActivation.has(instantKey)) continue;
    seenActivation.add(instantKey);
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
