// The join between the two halves: the build layer resolves what a creature
// moves at, and the engine runs it over a distance.
//
// The engine takes movement the way it takes the combat stats - as numbers that
// are already built, with the plushies, the trait, the elder and any held
// effect in them. So the movement registry stays here on the TypeScript side
// and never enters the engine; this file is the one place that reads it for a
// route, the way `components/compare/compareSpeedPlate.ts` is the one place
// that reads it for Compare.
//
// Speeds are the game's own stat units, not studs a second. The engine does
// that conversion, because it is the thing that owns a distance.

import type { BuildOptions, CreatureRuntime, FinalStats } from "../engine/types";
import { evaluateSpeed } from "../speed/speedMath";

export type RouteMovementStats = {
  walkSpeed: number;
  sprintSpeed: number;
  flySpeed: number;
  ambushSpeed: number;
  beachedSpeed: number;
  takeoffStamina: number;
  glideStaminaRegen: number;
  stamina: number;
  staminaRegen: number;
};

const positive = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * What a creature moves at and what it has to spend, for one build and one set
 * of held effects.
 *
 * `takeoffStamina` is an amount of stamina and not a share of the pool. The
 * stat is called Takeoff Multiplier and its description calls it a percent
 * value; the game compares it against what is left in the pool and subtracts it
 * whole, so the name and the description are both wrong about it.
 */
export function routeMovementStats(
  creature: CreatureRuntime,
  build: BuildOptions,
  finalStats: FinalStats,
  active: string[] = [],
): RouteMovementStats {
  // The pool and its rate fold off the same effects the speeds do, from the
  // base the build layer produced - it owns the elder's share of both, and the
  // registry owns the traits, the plushies and whatever is held.
  const speeds = evaluateSpeed({
    creature,
    build,
    active,
    staminaBase: { stamina: finalStats.stamina, staminaRegen: finalStats.stamRegen },
  }).final;
  return {
    walkSpeed: positive(speeds.speed),
    sprintSpeed: positive(speeds.sprint),
    flySpeed: positive(speeds.fly),
    ambushSpeed: positive(speeds.ambush),
    // What an aquatic manages on land. Absent on everything else, which never
    // reads it.
    beachedSpeed: positive(speeds.beached),
    // Both come off the creature rather than the build: nothing moves them.
    takeoffStamina: positive(creature.stats.takeoffMultiplier),
    glideStaminaRegen: positive(speeds.glideRegen),
    // Both with every held effect in them, which the built stats alone do not
    // carry.
    stamina: positive(speeds.stamina),
    staminaRegen: positive(speeds.staminaRegen),
  };
}
