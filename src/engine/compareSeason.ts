/**
 * Seasons, as far as a fight can see them.
 *
 * The game keeps two separate season tables and they are easy to confuse.
 * `SeasonFoodMultipliers` scales how much food a source yields - Winter 0.8,
 * Famine 0.8 - which a 1v1 never touches. `SeasonHungerMultipliers` and
 * `SeasonThirstMultipliers` scale the `Hunger` / `Thirst` stats, which count
 * seconds per appetite unit, so above 1 is a slower meter. Only the second
 * pair reaches combat.
 *
 * Winter additionally lands 5 stacks of Frostbite, once, at the moment the
 * season begins; nothing renews them and they decay from there. A fight has no
 * idea how far into a season it sits, so seeding them would pin every winter
 * fight to the season boundary - the rarest case rather than the usual one.
 * They are left out, and Frostbite reaches a fight through its own channels.
 */
export type CompareSeason =
  | "none"
  | "spring"
  | "summer"
  | "fall"
  | "winter"
  | "sakura"
  | "famine"
  | "drought";

type SeasonIntervals = { hunger: number; thirst: number };

const SEASON_INTERVALS: Record<CompareSeason, SeasonIntervals> = {
  none: { hunger: 1, thirst: 1 },
  spring: { hunger: 1, thirst: 1 },
  summer: { hunger: 1, thirst: 1 },
  fall: { hunger: 1, thirst: 1 },
  sakura: { hunger: 1, thirst: 1 },
  winter: { hunger: 0.8, thirst: 0.9 },
  famine: { hunger: 1.9, thirst: 0.9 },
  drought: { hunger: 1, thirst: 0.7 },
};

export function getSeasonMeterIntervals(season: CompareSeason | undefined): SeasonIntervals {
  return SEASON_INTERVALS[season ?? "none"] ?? SEASON_INTERVALS.none;
}

/** Percent faster (positive) or slower (negative) a meter drains this season. */
export function getSeasonDrainChangePct(season: CompareSeason, meter: "hunger" | "thirst"): number {
  return (1 / getSeasonMeterIntervals(season)[meter] - 1) * 100;
}
