import { SPEC_CONSTANTS } from "./specConstants.generated";
import type { BuildOptions, FinalStats, InitialStatusOption } from "./types";

export type CompareBuffId =
  | "damageBoost"
  | "regenBoost"
  | "packHealerNearby"
  | "muddy"
  | "cleanWater"
  | "refreshed"
  | "aggressive"
  | "scared"
  | "newborn"
  | "satiated"
  | "springWater"
  | "territory"
  | "storming"
  | "guardiansSeal";

export type CompareBuffSelection = Record<CompareBuffId, boolean>;

export type CompareDayNightMode = "none" | "day" | "night";
export type CompareMoonMode = "none" | "blueMoon" | "bloodMoon";

export const DEFAULT_COMPARE_BUFF_SELECTION: CompareBuffSelection = {
  damageBoost: false,
  regenBoost: false,
  packHealerNearby: false,
  muddy: false,
  cleanWater: false,
  refreshed: false,
  aggressive: false,
  scared: false,
  newborn: false,
  satiated: false,
  springWater: false,
  territory: false,
  storming: false,
  guardiansSeal: false,
};

/**
 * Pack Healer is an aura, not a personal buff: a healer standing near the fight
 * heals both creatures, so one side turning it on covers the other. Every other
 * buff stays per-side.
 */
export function shareCompareAuraBuffs(
  a: CompareBuffSelection,
  b: CompareBuffSelection,
): [CompareBuffSelection, CompareBuffSelection] {
  const packHealerNearby = a.packHealerNearby || b.packHealerNearby;
  return [
    { ...a, packHealerNearby },
    { ...b, packHealerNearby },
  ];
}

export type CompareBuffRuntimeResult = {
  finalStats: FinalStats;
  initialStatuses: InitialStatusOption[];
  activeCooldownMultiplier: number;
};

function cloneFinalStats(finalStats: FinalStats): FinalStats {
  return {
    ...finalStats,
    appliedTraits: [...finalStats.appliedTraits],
    plushieStatusOnHit: finalStats.plushieStatusOnHit ? { ...finalStats.plushieStatusOnHit } : undefined,
    plushieStatusOnHitTaken: finalStats.plushieStatusOnHitTaken ? { ...finalStats.plushieStatusOnHitTaken } : undefined,
    plushieStatusBlockPct: finalStats.plushieStatusBlockPct ? { ...finalStats.plushieStatusBlockPct } : undefined,
  };
}

function hasBearPlushie(build: BuildOptions): boolean {
  return build.plushies.some((name) => name.trim().toLowerCase() === "bear");
}

function countLandPlushies(build: BuildOptions): number {
  return build.plushies.filter((name) => name.trim().toLowerCase() === "land").length;
}

function countEclipsePlushies(build: BuildOptions): number {
  return build.plushies.filter((name) => name.trim().toLowerCase() === "eclipse").length;
}

function isPhotoDiet(finalStats: FinalStats): boolean {
  const diet = finalStats.diet?.trim().toLowerCase();
  return diet === "photovore" || diet === "photocarnivore";
}

function applyPct(value: number | undefined, pct: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return value * (1 + pct / 100);
}

export function applyCompareBuffRuntime(
  finalStats: FinalStats,
  build: BuildOptions,
  buffs: CompareBuffSelection,
  dayNight: CompareDayNightMode,
  moon: CompareMoonMode,
): CompareBuffRuntimeResult {
  const next = cloneFinalStats(finalStats);
  const initialStatuses: InitialStatusOption[] = [];
  let activeCooldownMultiplier = 1;

  if (buffs.damageBoost) {
    next.damage = applyPct(next.damage, 5) ?? next.damage;
    next.weight = applyPct(next.weight, 5) ?? next.weight;
    next.biteCooldown = applyPct(next.biteCooldown, -5) ?? next.biteCooldown;
  }

  if (buffs.regenBoost) {
    next.healthRegen = applyPct(next.healthRegen, 20);
    next.stamRegen = applyPct(next.stamRegen, 20);
    activeCooldownMultiplier *= 0.9;
  }

  if (buffs.packHealerNearby) next.healthRegen = applyPct(next.healthRegen, 25);
  // cleanWater, refreshed and newborn are applied below as initialStatuses.
  // The Rust regen multiplier reads them from actor.statuses, and the meter
  // drain reads their interval multipliers from the same place. No instant
  // applyPct here - it would double-count.

  if (dayNight !== "none" && isPhotoDiet(next)) {
    if (dayNight === "day") {
      next.damage = applyPct(next.damage, 5) ?? next.damage;
      next.stamRegen = applyPct(next.stamRegen, 25);
      next.healthRegen = applyPct(next.healthRegen, 15);
    } else if (dayNight === "night") {
      next.damage = applyPct(next.damage, -5) ?? next.damage;
      next.stamRegen = applyPct(next.stamRegen, -25);
      next.healthRegen = applyPct(next.healthRegen, -15);
    }
  }

  // A second Eclipse changes nothing. The bonus is large enough that stacking it
  // would dominate any night build, so the model grants it once however many
  // copies are equipped.
  if (dayNight === "night" && countEclipsePlushies(build) > 0) {
    next.damage = applyPct(next.damage, 5) ?? next.damage;
    next.stamRegen = applyPct(next.stamRegen, 25);
    next.healthRegen = applyPct(next.healthRegen, 15);
  }

  if (moon === "blueMoon") {
    next.damage = applyPct(next.damage, -50) ?? next.damage;
    next.stamRegen = applyPct(next.stamRegen, 50);
    next.healthRegen = applyPct(next.healthRegen, 50);
  }

  if (moon === "bloodMoon") {
    next.damage = applyPct(next.damage, 50) ?? next.damage;
    next.stamRegen = applyPct(next.stamRegen, 50);
    next.biteCooldown = applyPct(next.biteCooldown, -50) ?? next.biteCooldown;
  }

  const bearBoost = hasBearPlushie(build);
  const landCount = countLandPlushies(build);
  if (buffs.muddy) {
    initialStatuses.push({ statusId: "Muddy_Status", remainingSec: 90 * (1 + landCount), sourceAbilityName: "Manual Muddy Status" });
  }
  if (buffs.cleanWater) {
    initialStatuses.push({ statusId: "Clean_Water_Status", remainingSec: 180, sourceAbilityName: "Manual Clean Water" });
  }
  if (buffs.refreshed) {
    initialStatuses.push({ statusId: "Refreshed_Status", remainingSec: 180, sourceAbilityName: "Manual Refreshed" });
  }
  if (buffs.newborn) {
    initialStatuses.push({ statusId: "Newborn_Status", noDecay: true, sourceAbilityName: "Manual Newborn" });
  }
  if (buffs.springWater) {
    initialStatuses.push({ statusId: "Spring_Water_Status", remainingSec: 300, sourceAbilityName: "Manual Spring Water" });
  }
  if (buffs.satiated) {
    initialStatuses.push({ statusId: "Satiated_Status", remainingSec: 300, sourceAbilityName: "Manual Satiated" });
  }
  if (buffs.territory) {
    // No timer: a territory does not expire under you, you walk out of it.
    initialStatuses.push({ statusId: "Territory_Status", noDecay: true, sourceAbilityName: "Manual Territory" });
  }
  if (buffs.aggressive) {
    initialStatuses.push({
      statusId: bearBoost ? "Aggressive_Bear_Status" : "Aggressive_Status",
      stacks: 10,
      sourceAbilityName: "Aggressive",
    });
  }
  if (buffs.scared) {
    initialStatuses.push({
      statusId: bearBoost ? "Scared_Bear_Status" : "Scared_Status",
      stacks: 10,
      sourceAbilityName: "Scared Status",
    });
  }
  if (buffs.guardiansSeal) {
    // Stands in for a packmate who used Guardians Passage a moment before the
    // fight; the stacks are what the ability grants, decaying as they normally do.
    initialStatuses.push({
      statusId: "Guardian_Seal_Status",
      stacks: SPEC_CONSTANTS.guardians_passage_seal_stacks,
      sourceAbilityName: "Guardians Passage",
    });
  }
  return {
    finalStats: next,
    initialStatuses,
    activeCooldownMultiplier,
  };
}
