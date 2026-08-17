import { creatureHasAbility, type CompareSpecialAbilityState } from "../components/compare/compareSpecialAbilities";
import { getDefiledGroundStatBonusPct } from "./compareDefiledGroundData";
import type { CreatureRuntime, FinalStats } from "./types";

// The stat side of the Compare special-ability toggles, applied on top of the
// build and before anything crosses the WASM boundary. Sibling of
// compareBuffRuntime: same shape, same place in the order, different switches.
//
// Each toggle needs the ability as well as the switch. Turning Volcanic on for a
// creature that does not have it changes nothing - the toggle says "assume the
// condition holds", not "grant the ability".

/** Highest ally count Strength In Numbers counts. */
export const STRENGTH_IN_NUMBERS_MAX_ALLIES = 9;

function cloneFinalStats(finalStats: FinalStats): FinalStats {
  return {
    ...finalStats,
    appliedTraits: [...finalStats.appliedTraits],
    plushieStatusOnHit: finalStats.plushieStatusOnHit ? { ...finalStats.plushieStatusOnHit } : undefined,
    plushieStatusOnHitTaken: finalStats.plushieStatusOnHitTaken ? { ...finalStats.plushieStatusOnHitTaken } : undefined,
    plushieStatusBlockPct: finalStats.plushieStatusBlockPct ? { ...finalStats.plushieStatusBlockPct } : undefined,
  };
}

function applyPct(value: number | undefined, pct: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return value * (1 + pct / 100);
}

export function applyCompareSpecialAbilities(
  finalStats: FinalStats,
  creature: CreatureRuntime | undefined,
  abilities: CompareSpecialAbilityState,
): FinalStats {
  const next = cloneFinalStats(finalStats);
  if (abilities.volcanic && creatureHasAbility(creature, "Volcanic")) {
    next.healthRegen = applyPct(next.healthRegen, 50);
  }
  // Minty Wiggler hands Frosty to a creature that does not have it, so the
  // granted list counts as well as the creature's own abilities.
  const hasFrosty =
    creatureHasAbility(creature, "Frosty")
    || !!finalStats.plushieGrantedOtherAbilities?.some((a) => a.name === "Frosty");
  if (abilities.frosty && hasFrosty) {
    next.healthRegen = applyPct(next.healthRegen, 25);
    next.stamRegen = applyPct(next.stamRegen, 25);
  }
  if (abilities.defiledGround && creatureHasAbility(creature, "Defiled Ground")) {
    const statBonusPct = getDefiledGroundStatBonusPct(abilities.defiledGroundLevel);
    next.health = applyPct(next.health, statBonusPct) ?? next.health;
    next.weight = applyPct(next.weight, statBonusPct) ?? next.weight;
  }
  if (abilities.strengthInNumbers && creatureHasAbility(creature, "Strength In Numbers")) {
    const allies = Math.max(
      0,
      Math.min(STRENGTH_IN_NUMBERS_MAX_ALLIES, Math.floor(abilities.strengthInNumbersAllies ?? 0)),
    );
    if (allies > 0) {
      next.damage = applyPct(next.damage, 1.5 * allies) ?? next.damage;
    }
  }
  return next;
}
