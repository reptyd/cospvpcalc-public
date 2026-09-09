import type { CreatureRuntime, TwoFacedMode } from "../../engine";
// Direct leaf import (not the engine barrel) so this boot-reachable module stays
// catalog-free - the barrel route would pull buildRules -> data.ts (effects 445kB).
import { DEFAULT_TWO_FACED_MODE } from "../../engine/twoFacedMode";
import type { CompareDefiledGroundLevel } from "../../engine/compareDefiledGroundData";

export type HealingPulseMode = "normal" | "onceAtStart";
export const DEFAULT_HEALING_PULSE_MODE: HealingPulseMode = "normal";

/** How many plants Life Of The Forest counts when it fires: the number below
 *  every time, or a fresh draw from zero to five at each activation. */
export type LifeOfTheForestMode = "constant" | "random";
export const DEFAULT_LIFE_OF_THE_FOREST_MODE: LifeOfTheForestMode = "constant";

/** How a breath resolves its crit chance and its ailment chances: as whole
 *  events on a fixed schedule, as a fraction on every tick, or as a draw. */
export type BreathRollMode = "even" | "pseudo" | "random";
export const DEFAULT_BREATH_ROLL_MODE: BreathRollMode = "even";

/** Read a stored breath roll mode. A state saved before the three modes were
 *  named carries the old spelling, and an unknown value falls back to the
 *  default rather than reaching the engine, which refuses what it cannot name. */
export function normalizeBreathRollMode(value: unknown): BreathRollMode {
  if (value === "even" || value === "pseudo" || value === "random") return value;
  if (value === "paced") return "even";
  if (value === "averaged") return "pseudo";
  if (value === "rolled") return "random";
  return DEFAULT_BREATH_ROLL_MODE;
}

/** A stored side state, with every field the engine reads brought to a value it
 *  knows. Missing fields fall back to the defaults. */
export function normalizeCompareSpecialAbilities(
  stored: Partial<CompareSpecialAbilityState> | undefined,
): CompareSpecialAbilityState {
  const merged = { ...DEFAULT_COMPARE_SPECIAL_ABILITIES, ...(stored ?? {}) };
  return { ...merged, breathRollMode: normalizeBreathRollMode(merged.breathRollMode) };
}
export const LIFE_OF_THE_FOREST_MAX_PLANTS = 5;

export type CompareSpecialAbilityState = {
  volcanic: boolean;
  frosty: boolean;
  defiledGround: boolean;
  defiledGroundLevel: CompareDefiledGroundLevel;
  broodwatcher: boolean;
  powerCharge: boolean;
  goreCharge: boolean;
  startingSpiteCharged: boolean;
  wardenRageStartHp: boolean;
  wardenRageStartHpPct: number;
  /** "Head Start" battle setting (always available, not ability-gated):
   *  the enabling creature's opponent stands inert for the first
   *  `headStartSec` seconds. Per-side and independent. */
  headStart: boolean;
  headStartSec: number;
  /** Percent of the appetite meter each bar carries at the opening bell. 100
   *  is a full bar; only a Gourmandizer owner can be sent past it. */
  startingHungerPct: number;
  startingThirstPct: number;
  strengthInNumbers: boolean;
  strengthInNumbersAllies: number;
  /** "Nearby radiated creatures" battle setting (always available, not
   *  ability-gated). The count is linked across both sides; the engine treats
   *  it as a single global figure. */
  radiationNearby: boolean;
  radiationNearbyCount: number;
  traps: boolean;
  trails: boolean;
  /** "ignore" swings into an active Reflect; "hold" waits it out. */
  reflectResponse: "ignore" | "hold";
  twoFacedMode: TwoFacedMode;
  /** Heal Aura runs only when this is on: it heals the opponent too. */
  healAuraEnabled: boolean;
  /** Seedling Mist runs only when this is on: its mist heals the opponent too. */
  seedlingMistEnabled: boolean;
  healingPulseEnabled: boolean;
  healingPulseMode: HealingPulseMode;
  lifeOfTheForestEnabled: boolean;
  lifeOfTheForestMode: LifeOfTheForestMode;
  /** Plant count for the constant mode, zero to five. Unread in random mode. */
  lifeOfTheForestPlants: number;
  /** Fire at the opening and never again, instead of every thirty seconds. */
  lifeOfTheForestOnce: boolean;
  /** How this side's breath resolves its crit chance and its ailment chances. */
  breathRollMode: BreathRollMode;
};

export const DEFAULT_COMPARE_SPECIAL_ABILITIES: CompareSpecialAbilityState = {
  volcanic: false,
  frosty: false,
  defiledGround: false,
  defiledGroundLevel: 1,
  broodwatcher: false,
  powerCharge: false,
  goreCharge: false,
  startingSpiteCharged: false,
  wardenRageStartHp: false,
  wardenRageStartHpPct: 50,
  headStart: false,
  headStartSec: 0,
  startingHungerPct: 100,
  startingThirstPct: 100,
  strengthInNumbers: false,
  strengthInNumbersAllies: 0,
  radiationNearby: false,
  radiationNearbyCount: 0,
  traps: false,
  trails: false,
  reflectResponse: "ignore",
  twoFacedMode: DEFAULT_TWO_FACED_MODE,
  healAuraEnabled: false,
  seedlingMistEnabled: false,
  healingPulseEnabled: false,
  healingPulseMode: DEFAULT_HEALING_PULSE_MODE,
  lifeOfTheForestEnabled: false,
  lifeOfTheForestMode: DEFAULT_LIFE_OF_THE_FOREST_MODE,
  lifeOfTheForestPlants: 0,
  lifeOfTheForestOnce: false,
  breathRollMode: DEFAULT_BREATH_ROLL_MODE,
};

export function creatureHasAbility(creature: CreatureRuntime | undefined, abilityName: string): boolean {
  if (!creature) return false;
  const abilities = [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? []), ...(creature.breathAbilities ?? [])];
  return abilities.some((ability) => ability.name === abilityName);
}

/** Whether this side has defiled the ground. Both halves of the ability read
 * this: the owner takes the stat bonus and the faster ailment recovery, and
 * whoever fights on the ground takes Sickly. */
export function defiledGroundActive(
  abilities: CompareSpecialAbilityState,
  creature: CreatureRuntime | undefined,
): boolean {
  return abilities.defiledGround && creatureHasAbility(creature, "Defiled Ground");
}

/** Life Of The Forest as the engine reads it: a plant count, whether the count
 * is drawn afresh at each activation, and whether the ability repeats. A side
 * that does not own the ability, or left the setting off, sends nothing. */
export function compareLifeOfTheForestPerk(
  abilities: CompareSpecialAbilityState,
  creature: CreatureRuntime | undefined,
): { plants: number; random: boolean; once: boolean } {
  if (!abilities.lifeOfTheForestEnabled || !creatureHasAbility(creature, "Life Of The Forest")) {
    return { plants: 0, random: false, once: false };
  }
  const random = abilities.lifeOfTheForestMode === "random";
  const plants = random
    ? 0
    : Math.max(0, Math.min(LIFE_OF_THE_FOREST_MAX_PLANTS, Math.floor(abilities.lifeOfTheForestPlants)));
  return { plants, random, once: abilities.lifeOfTheForestOnce };
}
