import type { CreatureRuntime, FinalStats } from "../engine";

export type DummyValues = {
  health: number;
  weight: number;
  damage: number;
  biteCooldown: number;
};

export type DummyInputValues = {
  health: string;
  weight: string;
  damage: string;
  biteCooldown: string;
};

function resolveDummyNumber(value: string, fallback: number, allowEmpty = false): number {
  if (allowEmpty && value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeDummyInputs(
  dummyInputs: DummyInputValues,
  fallbackValues: DummyValues,
): { nextDummyValues: DummyValues; nextDummyInputs: DummyInputValues } {
  const nextDummyValues = {
    health: resolveDummyNumber(dummyInputs.health, fallbackValues.health),
    weight: resolveDummyNumber(dummyInputs.weight, 0, true),
    damage: resolveDummyNumber(dummyInputs.damage, fallbackValues.damage),
    biteCooldown: resolveDummyNumber(dummyInputs.biteCooldown, fallbackValues.biteCooldown),
  };
  return {
    nextDummyValues,
    nextDummyInputs: {
      health: String(nextDummyValues.health),
      weight: nextDummyValues.weight === 0 ? "" : String(nextDummyValues.weight),
      damage: String(nextDummyValues.damage),
      biteCooldown: String(nextDummyValues.biteCooldown),
    },
  };
}

export function buildSoloDummy(creatureA: CreatureRuntime, values: DummyValues): {
  dummy: CreatureRuntime;
  dummyFinal: FinalStats;
} {
  const dummyWeight = values.weight > 0 ? values.weight : creatureA.stats.weight;
  const stats = {
    tier: 1,
    health: values.health,
    weight: dummyWeight,
    damage: values.damage,
    biteCooldown: values.biteCooldown,
    healthRegen: 0,
    stamina: 0,
    stamRegen: 0,
    breath: "N/A",
    type: "Dummy",
  };
  return {
    dummy: {
      name: "Dummy",
      stats,
    },
    dummyFinal: {
      name: "Dummy",
      ...stats,
      hasBreath: false,
      breathType: null,
      approxNotes: [],
      appliedTraits: [],
      elder: "None",
      plushieStatusOnHit: {},
      plushieStatusOnHitTaken: {},
      plushieStatusBlockPct: {},
    },
  };
}
