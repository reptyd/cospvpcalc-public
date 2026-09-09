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
 * Stamina is not here. It is a readout of its own - see `StaminaChannel` - and
 * the two are kept apart on purpose: a pool is not a speed, and a list called
 * movement channels that carries one would say something untrue. They share the
 * registry and the resolve pass, which is what keeps an effect a single entry,
 * and part company at the point where they are named and printed. */
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
 * ambush multiplier. Both change with the channel underneath. */
export type SpeedDerived = "flySprint" | "ambush";

/** What a creature has to spend on going anywhere: the pool, the rate it comes
 * back at, the rate while gliding, which the game keeps as its own figure, and
 * what leaving the ground costs.
 *
 * Takeoff is a stamina figure and not a speed: the game subtracts it from the
 * pool whole. It is here rather than among the movement channels for that
 * reason, and because weather is what mostly moves it - rain, snow and a
 * thunderstorm each raise takeoff by 10% to 25%.
 *
 * Who applies what, which is the thing to get right here. The build layer moves
 * stamina for the elder and for the Max Stamina and Stamina Regen traits, because
 * a fight reads a pool and a rate and has to see them. So the registry carries
 * the plushies and every held effect and leaves all three alone: a caller passes
 * the built figures in as `staminaBase`, and a row for a trait here would apply
 * it a second time.
 *
 * Movement divides the other way round: the build layer touches no speed at all,
 * so the registry carries the elder and the Speed trait there too. */
export type StaminaChannel = "stamina" | "staminaRegen" | "glideRegen" | "takeoff";

export const STAMINA_CHANNELS: readonly StaminaChannel[] = [
  "stamina",
  "staminaRegen",
  "glideRegen",
  "takeoff",
];

export type SpeedTarget = SpeedChannel | SpeedDerived | StaminaChannel;

export type SpeedReadout = Record<SpeedChannel, number | null> &
  Record<SpeedDerived, number | null> &
  Record<StaminaChannel, number | null>;

/** The movement readout in reading order. `ambushFactor` is absent: it is a
 * multiplier, and printing it beside a column of speeds would read as one. The
 * stamina channels are absent too - `STAMINA_READOUT_CHANNELS` is their list,
 * so a caller renders one, the other, or both, and neither list ever names
 * something it is not. */
export const READOUT_CHANNELS: readonly SpeedTarget[] = [
  "speed",
  "sprint",
  "ambush",
  "fly",
  "flySprint",
  "beached",
  "turn",
];

/** The stamina readout in reading order. */
export const STAMINA_READOUT_CHANNELS: readonly SpeedTarget[] = [
  "stamina",
  "staminaRegen",
  "glideRegen",
  "takeoff",
];

/** Higher is better everywhere except turn, which counts seconds to come about,
 * and takeoff, which counts stamina to leave the ground. */
export const LOWER_IS_BETTER: ReadonlySet<SpeedTarget> = new Set<SpeedTarget>(["turn", "takeoff"]);

export const CHANNEL_LABELS: Record<SpeedTarget, string> = {
  speed: "Walk / Swim",
  sprint: "Sprint",
  fly: "Fly",
  beached: "Beached",
  turn: "Turn",
  ambushFactor: "Ambush multiplier",
  flySprint: "Fly sprint",
  ambush: "Ambush",
  stamina: "Stamina",
  staminaRegen: "Stamina regen",
  glideRegen: "Glide regen",
  takeoff: "Takeoff",
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
/**
 * The creature's own figures, before anything the build or a held effect does.
 *
 * `staminaBase` is what the build layer already produced - it owns the elder's
 * share of the pool and the rate - and is left `null` by a caller that does not
 * care about stamina, which then gets a movement readout and nothing else. The
 * glide rate comes off the creature: nothing in the build layer moves it.
 */
export function baseChannels(
  creature: CreatureRuntime,
  staminaBase?: { stamina?: number | null; staminaRegen?: number | null },
): SpeedReadout {
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
    stamina: staminaBase ? positive(staminaBase.stamina) : null,
    staminaRegen: staminaBase ? positive(staminaBase.staminaRegen) : null,
    glideRegen: staminaBase ? positive(stats.glideStaminaRegen) : null,
    // Takeoff comes off the creature, not the build: nothing in the build layer
    // touches it. The stat is called Takeoff Multiplier and its description
    // calls it a percentage; the game subtracts it from the pool whole.
    takeoff: staminaBase ? positive(stats.takeoffMultiplier) : null,
  };
}
