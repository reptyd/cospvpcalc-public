export const COMPARE_DEFAULT_STARTING_HUNGER = 100;
export const COMPARE_DEFAULT_APPETITE_BASE = 100;
export const COMPARE_MAX_STARTING_FILL_PCT = 150;
export const COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT = 125;
export const COMPARE_GOURMANDIZER_MAX_WEIGHT_BONUS_PCT = 15;
export const COMPARE_HUNGER_DRAIN_UNITS_PER_SEC = 1 / 30;
export const COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER = 1.5;
export const COMPARE_REFLUX_HUNGER_COST_FRACTION = 0.25;

export function normalizeCompareHunger(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return COMPARE_DEFAULT_STARTING_HUNGER;
  return Math.max(0, value);
}

export function normalizeCompareFillPct(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return COMPARE_DEFAULT_STARTING_HUNGER;
  return Math.max(0, Math.min(COMPARE_MAX_STARTING_FILL_PCT, value));
}

export function normalizeCompareAppetiteBase(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return COMPARE_DEFAULT_APPETITE_BASE;
  return Math.max(1, value);
}

export function getGourmandizerFillPct(currentHunger: number, appetiteBase: number): number {
  const hunger = normalizeCompareHunger(currentHunger);
  const base = normalizeCompareAppetiteBase(appetiteBase);
  return (hunger / base) * 100;
}

export function convertFillPctToAppetiteUnits(fillPct: number, appetiteBase: number): number {
  return normalizeCompareAppetiteBase(appetiteBase) * (normalizeCompareFillPct(fillPct) / 100);
}

export function getGourmandizerWeightBonusPct(currentHunger: number, appetiteBase: number): number {
  const fillPct = getGourmandizerFillPct(currentHunger, appetiteBase);
  const capped = Math.min(COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT, Math.max(COMPARE_DEFAULT_STARTING_HUNGER, fillPct));
  const progress =
    (capped - COMPARE_DEFAULT_STARTING_HUNGER) /
    (COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT - COMPARE_DEFAULT_STARTING_HUNGER);
  return COMPARE_GOURMANDIZER_MAX_WEIGHT_BONUS_PCT * progress;
}

export function getGourmandizerWeightBonusPctFromFillPct(fillPct: number): number {
  const normalizedFillPct = normalizeCompareFillPct(fillPct);
  const capped = Math.min(COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT, Math.max(COMPARE_DEFAULT_STARTING_HUNGER, normalizedFillPct));
  const progress =
    (capped - COMPARE_DEFAULT_STARTING_HUNGER) /
    (COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT - COMPARE_DEFAULT_STARTING_HUNGER);
  return COMPARE_GOURMANDIZER_MAX_WEIGHT_BONUS_PCT * progress;
}

export function getDiseaseHungerDrainMultiplier(stacks: number): number {
  if (!Number.isFinite(stacks) || stacks <= 0) return 1;
  return 1.15 + stacks * 0.015;
}

export function advanceCompareHunger(
  currentHunger: number,
  appetiteBase: number,
  deltaSec: number,
  diseaseStacks: number,
  overfilledDrainsFaster: boolean,
  consumptionMultiplier = 1,
): number {
  const hunger = normalizeCompareHunger(currentHunger);
  const base = normalizeCompareAppetiteBase(appetiteBase);
  if (!Number.isFinite(deltaSec) || deltaSec <= 0 || hunger <= 0) return hunger;

  const baseDrain =
    deltaSec *
    COMPARE_HUNGER_DRAIN_UNITS_PER_SEC *
    getDiseaseHungerDrainMultiplier(diseaseStacks) *
    Math.max(0, consumptionMultiplier);
  if (!overfilledDrainsFaster || hunger <= base) {
    return Math.max(0, hunger - baseDrain);
  }

  const overfill = hunger - base;
  const overfillDrain = baseDrain * COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER;
  if (overfill > overfillDrain) {
    return Math.max(0, hunger - overfillDrain);
  }

  const normalDrainAfterCrossing =
    baseDrain - overfill / COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER;
  return Math.max(0, base - Math.max(0, normalDrainAfterCrossing));
}
