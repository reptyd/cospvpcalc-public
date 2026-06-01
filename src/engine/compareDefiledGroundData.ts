export type CompareDefiledGroundLevel = 1 | 2 | 3;

export const DEFILED_GROUND_WEAKNESS_CONSUMPTION_INCREASE_PCT = 20;

const DEFILED_GROUND_CONSUMPTION_REDUCTION_BY_LEVEL: Record<CompareDefiledGroundLevel, number> = {
  1: 20,
  2: 50,
  3: 80,
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
  return DEFILED_GROUND_CONSUMPTION_REDUCTION_BY_LEVEL[level];
}

export function getDefiledGroundStatBonusPct(level: CompareDefiledGroundLevel): number {
  return DEFILED_GROUND_STAT_BONUS_BY_LEVEL[level];
}

export function getDefiledGroundAilmentRecoveryPct(level: CompareDefiledGroundLevel): number {
  return DEFILED_GROUND_AILMENT_RECOVERY_BY_LEVEL[level];
}

export function getDefiledGroundConsumptionMultiplier(
  level: CompareDefiledGroundLevel,
  weaknessEnabled: boolean,
): number {
  const ownerMultiplier = 1 - getDefiledGroundConsumptionReductionPct(level) / 100;
  const weaknessMultiplier = weaknessEnabled ? 1 + DEFILED_GROUND_WEAKNESS_CONSUMPTION_INCREASE_PCT / 100 : 1;
  return ownerMultiplier * weaknessMultiplier;
}

const DEFILED_GROUND_RECOVERABLE_STATUS_IDS = new Set<string>([
  "Bad_Omen",
  "Bleed_Status",
  "Burn_Status",
  "Corrosion_Status",
  "Disease_Status",
  "Frostbite_Status",
  "Heartbroken_Status",
  "Injury_Status",
  "Necropoison_Status",
  "Poison_Status",
]);

export function isDefiledGroundRecoverableStatus(statusId: string): boolean {
  return DEFILED_GROUND_RECOVERABLE_STATUS_IDS.has(statusId);
}

export function getDefiledGroundDecaySec(baseDecaySec: number, ailmentRecoveryPct: number): number {
  if (!Number.isFinite(ailmentRecoveryPct) || ailmentRecoveryPct <= 0) return baseDecaySec;
  return baseDecaySec * Math.max(0.01, 1 - ailmentRecoveryPct / 100);
}
