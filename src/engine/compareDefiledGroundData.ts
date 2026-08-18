export type CompareDefiledGroundLevel = 1 | 2 | 3;

// The game states the owner bonus as a multiplier on the seconds-per-unit
// drain interval (`Defiler1/2/3`), so the consumption reduction is derived
// rather than written down: 1.2 is a fifth longer between units, which is a
// sixth less consumed, not a fifth.
const DEFILED_GROUND_DRAIN_INTERVAL_BY_LEVEL: Record<CompareDefiledGroundLevel, number> = {
  1: 1.2,
  2: 1.5,
  3: 1.8,
};

const DEFILED_GROUND_STAT_BONUS_BY_LEVEL: Record<CompareDefiledGroundLevel, number> = {
  1: 5,
  2: 7.5,
  3: 10,
};

const DEFILED_GROUND_AILMENT_RECOVERY_BY_LEVEL: Record<CompareDefiledGroundLevel, number> = {
  1: 10,
  2: 20,
  3: 30,
};

export function normalizeCompareDefiledGroundLevel(value: number | null | undefined): CompareDefiledGroundLevel {
  if (value === 2 || value === 3) return value;
  return 1;
}

export function getDefiledGroundConsumptionReductionPct(level: CompareDefiledGroundLevel): number {
  return (1 - 1 / DEFILED_GROUND_DRAIN_INTERVAL_BY_LEVEL[level]) * 100;
}

export function getDefiledGroundStatBonusPct(level: CompareDefiledGroundLevel): number {
  return DEFILED_GROUND_STAT_BONUS_BY_LEVEL[level];
}

export function getDefiledGroundAilmentRecoveryPct(level: CompareDefiledGroundLevel): number {
  return DEFILED_GROUND_AILMENT_RECOVERY_BY_LEVEL[level];
}

/// The owner's drain multiplier. The opponent-side weakness is the Sickly
/// ailment and states its own multiplier in the status catalog, so it is not
/// composed here.
export function getDefiledGroundOwnerDrainMultiplier(level: CompareDefiledGroundLevel): number {
  return 1 / DEFILED_GROUND_DRAIN_INTERVAL_BY_LEVEL[level];
}

