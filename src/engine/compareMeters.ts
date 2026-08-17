import type { CreatureRuntime, CreatureStats } from "./types";

/** Which of the two survival meters a creature actually carries. */
export type CreatureMeters = {
  hunger: boolean;
  thirst: boolean;
};

/**
 * The game decides this from two cached flags:
 *
 *   HasNoThirst = Aquatic or Photocarni
 *   HasNoHunger = Photovore
 *
 * Diet reaches us from the wiki as a single string, which covers Photovore
 * and Photocarnivore directly. Aquatic does not survive the trip: the wiki
 * types the nine sky-aquatics (Aquatic creatures that also fly - Dalghara,
 * Umbraxi, Logavian and friends) as Fliers, so `type` alone hands them a
 * thirst meter the game never gives them.
 *
 * Beached speed is the signal that does survive. The game defines it as "the
 * speed at which an aquatic moves on land", so only an aquatic has one, and it
 * picks out all 37 of them - the 28 the wiki types as Aquatic plus the nine
 * sky-aquatics. A new creature classifies itself the moment its stats land.
 */
export function creatureIsAquatic(stats: CreatureStats | undefined | null): boolean {
  return typeof stats?.beachSpeed === "number";
}

export function getCreatureMeters(creature: CreatureRuntime | undefined | null): CreatureMeters {
  const stats = creature?.stats;
  const diet = stats?.diet ?? "";
  return {
    hunger: diet !== "Photovore",
    thirst: !creatureIsAquatic(stats) && diet !== "Photocarnivore",
  };
}
