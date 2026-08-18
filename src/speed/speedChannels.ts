import type { CreatureRuntime } from "../engine/types";

/** The stat channels the game multiplies when something changes movement.
 *
 * `SwimSpeed` and `SwimSpeedSprint` are deliberately absent. No creature module
 * in the game carries either as a stat - aquatics reuse `Speed` / `SprintSpeed`
 * and the UI just relabels them "Swim". Every effect that targets a swim
 * channel also targets its land twin, so folding them away loses nothing.
 *
 * `ambushFactor` is the odd one: it is a multiplier rather than a speed, and
 * nothing reads it directly. It is here because the game lets an effect write
 * it, so it has to travel the same path every other channel travels.
 *
 * Take-off cost and glide regen are absent by decision, not by oversight. Both
 * are stamina figures that happen to sit beside the flight speeds in a creature's
 * stats, and stamina is a system this calculator does not model anywhere. Half a
 * stamina model is worse than none, so nothing here reads one. */
export type SpeedChannel = "speed" | "sprint" | "fly" | "beached" | "turn" | "ambushFactor";

export const SPEED_CHANNELS: readonly SpeedChannel[] = [
  "speed",
  "sprint",
  "fly",
  "beached",
  "turn",
  "ambushFactor",
];

/** Figures computed from a channel rather than written to. Fly sprint is fly
 * lifted by the creature's fly-sprint bonus; ambush is sprint lifted by the
 * ambush multiplier. Both ride on whatever happened to the channel underneath. */
export type SpeedDerived = "flySprint" | "ambush";

export type SpeedTarget = SpeedChannel | SpeedDerived;

export type SpeedReadout = Record<SpeedChannel, number | null> & Record<SpeedDerived, number | null>;

/** The readout in reading order. `ambushFactor` is absent: it is a multiplier,
 * and printing it beside a column of speeds would read as one. */
export const READOUT_CHANNELS: readonly SpeedTarget[] = [
  "speed",
  "sprint",
  "ambush",
  "fly",
  "flySprint",
  "beached",
  "turn",
];

/** Higher is better everywhere except turn, which counts seconds to come about. */
export const LOWER_IS_BETTER: ReadonlySet<SpeedTarget> = new Set<SpeedTarget>(["turn"]);

export const CHANNEL_LABELS: Record<SpeedTarget, string> = {
  speed: "Walk / Swim",
  sprint: "Sprint",
  fly: "Fly",
  beached: "Beached",
  turn: "Turn",
  ambushFactor: "Ambush multiplier",
  flySprint: "Fly sprint",
  ambush: "Ambush",
};

export function readChannel(readout: SpeedReadout, channel: SpeedTarget): number | null {
  return readout[channel];
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** `flySprintMultiplier` is stored as the bonus, not the factor: the game's
 * `FlySprintMultiplier = 1.4` reaches us as `0.4`. Every one of the 160 fliers
 * carrying the stat in both the creature modules and our data matches `ours + 1`
 * exactly, with no exceptions to carve out. */
export function flySprintFactor(bonus: number | null | undefined): number {
  return typeof bonus === "number" && Number.isFinite(bonus) && bonus > 0 ? 1 + bonus : 1;
}

/** Sprint times the ambush multiplier, which is what the client puts on
 * `BodyVelocity` while an ambush runs. Nothing clamps it on the way - the same
 * file clamps flight, animation and the water speed percentage, and leaves this
 * alone. Null for the creatures without the stat, which is most of the roster.
 *
 * Aquatics are the rough edge: in water the multiplier arrives over a 2.25 s
 * ramp, and on land `BeachedSpeed` overwrites it outright. Neither is modelled;
 * this is the land figure. */
export function ambushSpeed(sprint: number | null, factor: number | null): number | null {
  return sprint === null || factor === null ? null : sprint * factor;
}

/** Base values straight off the creature, before any build or effect. A null
 * channel means the creature does not have it at all - a grounded creature has
 * no fly speed, a land creature no beached speed. */
export function baseChannels(creature: CreatureRuntime): SpeedReadout {
  const stats = creature.stats;
  const fly = positive(stats.flySpeed);
  const sprint = positive(stats.sprintSpeed);
  const ambushFactor = positive(stats.ambush);
  return {
    speed: positive(stats.walkAndSwimSpeed),
    sprint,
    fly,
    beached: positive(stats.beachSpeed),
    turn: positive(stats.turn),
    ambushFactor,
    flySprint: fly === null ? null : fly * flySprintFactor(stats.flySprintMultiplier),
    ambush: ambushSpeed(sprint, ambushFactor),
  };
}
