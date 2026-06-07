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
  | "storming";

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
  storming: false,
};

export type CompareBuffRuntimeResult = {
  finalStats: FinalStats;
  initialStatuses: InitialStatusOption[];
  activeCooldownMultiplier: number;
};

function cloneFinalStats(finalStats: FinalStats): FinalStats {
  return {
    ...finalStats,
    approxNotes: [...finalStats.approxNotes],
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
  if (buffs.newborn) next.healthRegen = applyPct(next.healthRegen, 50);
  // cleanWater + refreshed are applied below as timed Clean_Water_Status /
  // Refreshed_Status initialStatuses. The Rust regen
  // multiplier reads them from actor.statuses and applies +20% / +5% while
  // the timer is active. No instant applyPct here - it would double-count.

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

  const hasEclipse = build.plushies.some((name) => name.trim().toLowerCase() === "eclipse");
  if (hasEclipse && dayNight === "night") {
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
  if (buffs.aggressive) {
    initialStatuses.push({
      statusId: bearBoost ? "Aggressive_Bear_Status" : "Aggressive_Status",
      remainingSec: 10,
      sourceAbilityName: "Aggressive",
    });
  }
  if (buffs.scared) {
    initialStatuses.push({
      statusId: bearBoost ? "Scared_Bear_Status" : "Scared_Status",
      remainingSec: 10,
      sourceAbilityName: "Scared Status",
    });
  }
  return {
    finalStats: next,
    initialStatuses,
    activeCooldownMultiplier,
  };
}
