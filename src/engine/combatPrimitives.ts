import { statusById } from "./data";
import type { StatusEffect } from "./types";
import type { RewindSnapshot, StatusInstance } from "./runtimeContext";

export function comparePolicyStateScore(
  a: { winRank: number; ttk: number; effectiveDamage: number },
  b: { winRank: number; ttk: number; effectiveDamage: number },
): number {
  if (a.winRank !== b.winRank) return b.winRank - a.winRank;
  if (a.ttk !== b.ttk) return a.winRank === 2 ? a.ttk - b.ttk : b.ttk - a.ttk;
  if (a.effectiveDamage !== b.effectiveDamage) return b.effectiveDamage - a.effectiveDamage;
  return 0;
}

export function wardenRageStacksFromHpRatio(hpRatio: number): number {
  if (hpRatio <= 0.5) return 100;
  if (hpRatio >= 1) return 0;
  return Math.round(((1 - hpRatio) / 0.5) * 100);
}

function clonePlainValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => clonePlainValue(item)) as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = clonePlainValue(entry);
    }
    return result as T;
  }
  return value;
}

export function cloneStateForProjection<T>(state: T): T {
  return clonePlainValue(state);
}

export function cloneStatuses(statuses: Record<string, StatusInstance>): Record<string, StatusInstance> {
  return Object.fromEntries(
    Object.entries(statuses).map(([statusId, instance]) => [statusId, { ...instance }]),
  );
}

export function shouldActivateFortify(removable: string[]): boolean {
  if (removable.length === 0) return false;
  if (removable.some((id) => id === "Bleed_Status" || id === "Burn_Status" || id === "Corrosion_Status")) return true;
  const strongDebuff = removable.some((id) => id === "Drowsy_Status" || id === "Freeze_Status" || id === "Necropoison_Status");
  return strongDebuff || removable.length >= 2;
}

const FORTIFY_EXPLICIT_REMOVABLE_STATUS_IDS = new Set([
  "Aftershock",
  "Ashy_Lungs",
  "Bad_Omen",
  "Bleed_Status",
  "Broken_Legs_Status",
  "Burn_Status",
  "Confusion_Status",
  "Corrosion_Status",
  "Deep_Wounds_Status",
  "Disease_Status",
  "Drowsy_Status",
  "Fear_Status",
  "Freeze_Status",
  "Frostbite_Status",
  "Heartbroken_Status",
  "Injury_Status",
  "Necropoison_Status",
  "Paralyze_Status",
  "Poison_Status",
  "Radiation_Status",
  "Scared_Bear_Status",
  "Scared_Status",
  "Shock_Status",
  "Shredded_Wings",
  "Sickly_Status",
  "Slow_Status",
  "Sticky_Teeth_Status",
  "Sticky_Trap_Status",
  "Stolen_Speed_Status",
  "Torn_Ligaments_Status",
]);

export function isReflectActiveAt(state: { reflectActiveUntil: number | null }, time: number): boolean {
  return state.reflectActiveUntil != null && state.reflectActiveUntil > time;
}

export function nextRegenAt(state: { nextRegenAt: number }): number {
  return state.nextRegenAt ?? Number.POSITIVE_INFINITY;
}

export function nextLifeLeechPlannedAt(state: { lifeLeechPlannedAt: number }): number {
  return state.lifeLeechPlannedAt > 0 ? state.lifeLeechPlannedAt : Number.POSITIVE_INFINITY;
}

export function nextAdrenalinePlannedAt(state: { adrenalinePlannedAt: number }): number {
  return state.adrenalinePlannedAt > 0 ? state.adrenalinePlannedAt : Number.POSITIVE_INFINITY;
}

export function nextHuntersCursePlannedAt(state: { huntersCursePlannedAt: number }): number {
  return state.huntersCursePlannedAt > 0 ? state.huntersCursePlannedAt : Number.POSITIVE_INFINITY;
}

export function nextFrostNovaTickAt(state: { frostNovaNextTickAt: number | null; frostNovaActiveUntil: number }): number {
  if (state.frostNovaNextTickAt == null) return Number.POSITIVE_INFINITY;
  if (state.frostNovaActiveUntil <= 0) return Number.POSITIVE_INFINITY;
  if (state.frostNovaNextTickAt - state.frostNovaActiveUntil > 1e-9) return Number.POSITIVE_INFINITY;
  return state.frostNovaNextTickAt;
}

export function nextUnbridledRagePlannedAt(state: { unbridledRagePlannedAt: number }): number {
  return state.unbridledRagePlannedAt > 0 ? state.unbridledRagePlannedAt : Number.POSITIVE_INFINITY;
}

export function nextTotemTickAt(state: { totemNextTickAt: number | null; totemActiveUntil: number | null }): number {
  if (state.totemNextTickAt == null || state.totemActiveUntil == null) return Number.POSITIVE_INFINITY;
  if (state.totemNextTickAt > state.totemActiveUntil) return Number.POSITIVE_INFINITY;
  return state.totemNextTickAt;
}

export function nextTotemReadyAt(state: { totemCooldownUntil?: number; totemActiveUntil: number | null }): number {
  const cooldownUntil = state.totemCooldownUntil ?? 0;
  if (state.totemActiveUntil != null && state.totemActiveUntil > cooldownUntil) return Number.POSITIVE_INFINITY;
  return cooldownUntil > 0 ? cooldownUntil : Number.POSITIVE_INFINITY;
}

export function nextDrowsyAreaReadyAt(state: { drowsyAreaCooldownUntil?: number }): number {
  const cooldownUntil = state.drowsyAreaCooldownUntil ?? 0;
  return cooldownUntil > 0 ? cooldownUntil : Number.POSITIVE_INFINITY;
}

export function nextRadiationTickAt(state: { radiationNextTickAt: number | null }): number {
  return state.radiationNextTickAt ?? Number.POSITIVE_INFINITY;
}

export function nextRefluxTickAt(state: { refluxNextTickAt: number | null; refluxPuddleUntil: number }): number {
  if (state.refluxNextTickAt == null) return Number.POSITIVE_INFINITY;
  if (state.refluxPuddleUntil <= 0) return Number.POSITIVE_INFINITY;
  if (state.refluxNextTickAt > state.refluxPuddleUntil) return Number.POSITIVE_INFINITY;
  return state.refluxNextTickAt;
}

export function nextLanceAuraTickAt(state: { lanceAuraNextTickAt: number | null; lanceAuraUntil: number }): number {
  if (state.lanceAuraNextTickAt == null) return Number.POSITIVE_INFINITY;
  if (state.lanceAuraUntil <= 0) return Number.POSITIVE_INFINITY;
  if (state.lanceAuraNextTickAt > state.lanceAuraUntil) return Number.POSITIVE_INFINITY;
  return state.lanceAuraNextTickAt;
}

export function nextRefluxChargeReadyAt(
  state: { refluxArmed: boolean; refluxChargeReadyAt: number; refluxCooldownUntil?: number },
): number {
  if (state.refluxArmed) {
    return state.refluxChargeReadyAt > 0 ? state.refluxChargeReadyAt : Number.POSITIVE_INFINITY;
  }
  return (state.refluxCooldownUntil ?? 0) > 0 ? (state.refluxCooldownUntil ?? 0) : Number.POSITIVE_INFINITY;
}

export function nextCauseFearReadyAt(state: { causeFearCooldownUntil?: number }): number {
  return (state.causeFearCooldownUntil ?? 0) > 0 ? (state.causeFearCooldownUntil ?? 0) : Number.POSITIVE_INFINITY;
}

export function nextShadowBarrageHitAt(state: { shadowBarrageNextHitAt: number | null; shadowBarrageRemainingHits: number }): number {
  if (state.shadowBarrageNextHitAt == null) return Number.POSITIVE_INFINITY;
  if (state.shadowBarrageRemainingHits <= 0) return Number.POSITIVE_INFINITY;
  return state.shadowBarrageNextHitAt;
}

export function recordRewindSnapshot(
  state: { hp: number; statuses: Record<string, StatusInstance>; rewindHistory: RewindSnapshot[] },
  time: number,
): void {
  state.rewindHistory.push({
    time,
    hp: state.hp,
    statuses: cloneStatuses(state.statuses),
  });
  state.rewindHistory = state.rewindHistory.filter((snapshot) => snapshot.time >= time - 12);
}

export function getRewindSnapshotAt(
  state: { rewindHistory: RewindSnapshot[] },
  time: number,
  lookbackSec: number,
): RewindSnapshot | null {
  const targetTime = time - lookbackSec;
  let best: RewindSnapshot | null = null;
  for (const snapshot of state.rewindHistory) {
    if (snapshot.time > targetTime) break;
    best = snapshot;
  }
  return best;
}

export function getStatusDefinition(statusId: string): StatusEffect | undefined {
  if (statusId === "Drowsy_Status") {
    return {
      id: statusId,
      name: "Drowsy Status",
      parsed: {
        modifiers: { biteCooldownIncreasePct: 35 },
        caps: { stacking: "duration" },
      },
    };
  }
  if (statusId === "Blessings_Boon") {
    return {
      id: statusId,
      name: "Blessing's Boon",
      parsed: {
        // Lich Mark applies 5 stacks and each 3s decay step should restore 3% max HP.
        type: "dot",
        dot: {
          mode: "flat",
          damagePerStackPerSec: 0,
          tickSec: 3,
        },
      },
    };
  }
  if (statusId === "Malices_Mark") {
    return {
      id: statusId,
      name: "Malice's Mark",
      parsed: {
        modifiers: { damagePct: -15 },
      },
    };
  }
  if (statusId === "Aggressive_Status") {
    return {
      id: statusId,
      name: "Aggressive Status",
      parsed: {
        modifiers: { damagePct: 25 },
      },
    };
  }
  if (statusId === "Aggressive_Bear_Status") {
    return {
      id: statusId,
      name: "Aggressive Status (Bear)",
      parsed: {
        // 2026-05-12: Bear formula is base * 1.1 + 10.
        // Aggressive: 25 * 1.1 + 10 = 37.5.
        modifiers: { damagePct: 37.5 },
      },
    };
  }
  if (statusId === "Scared_Bear_Status") {
    return {
      id: statusId,
      name: "Scared Status (Bear)",
      parsed: {
        // Scared: -50 * 1.1 + 10 = -45 (sign-preserving multiplier,
        // flat +10 numerically).
        modifiers: { damagePct: -45 },
      },
    };
  }
  if (statusId === "Scared_Status") {
    return {
      id: statusId,
      name: "Scared Status",
      parsed: {
        modifiers: { damagePct: -50 },
      },
    };
  }
  if (statusId === "Fear_Status") {
    return {
      id: statusId,
      name: "Fear Status",
      parsed: {
        modifiers: { damagePct: -45 },
      },
    };
  }
  if (statusId === "Defensive_Status") {
    return {
      id: statusId,
      name: "Defensive Status",
      parsed: {
        modifiers: { weightBoostPerStackPct: 10 },
      },
    };
  }
  return statusById[statusId];
}

export function isFortifyRemovableStatus(statusId: string): boolean {
  if (FORTIFY_EXPLICIT_REMOVABLE_STATUS_IDS.has(statusId)) return true;
  const status = getStatusDefinition(statusId);
  if (!status?.parsed) return false;
  if (status.parsed.type === "dot") return true;
  const mods = status.parsed.modifiers ?? {};
  return (
    mods.disablesHpRegen === true ||
    mods.disablesStamRegen === true ||
    mods.disablesBleedHealing === true ||
    mods.blocksExternalHealing === true ||
    typeof mods.hpRegenDebuffPct === "number" ||
    typeof mods.hpRegenDebuffPerStackPct === "number" ||
    typeof mods.stamRegenDebuffPct === "number" ||
    typeof mods.stamRegenDebuffPerStackPct === "number" ||
    typeof mods.biteCooldownIncreasePct === "number" ||
    typeof mods.biteCooldownIncreasePerStackPct === "number" ||
    typeof mods.damageReductionPct === "number" ||
    (typeof mods.damagePct === "number" && mods.damagePct < 0) ||
    (typeof mods.hpRegenPct === "number" && mods.hpRegenPct < 0) ||
    (typeof mods.stamRegenPct === "number" && mods.stamRegenPct < 0) ||
    typeof mods.weightReductionBasePct === "number" ||
    typeof mods.weightReductionPerStackPct === "number" ||
    typeof mods.movementDebuffPerStackPct === "number" ||
    statusId === "Freeze_Status"
  );
}
