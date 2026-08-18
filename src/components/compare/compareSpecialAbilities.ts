import type { CreatureRuntime, TwoFacedMode } from "../../engine";
// Direct leaf import (not the engine barrel) so this boot-reachable module stays
// catalog-free - the barrel route would pull buildRules -> data.ts (effects 445kB).
import { DEFAULT_TWO_FACED_MODE } from "../../engine/twoFacedMode";
import type { CompareDefiledGroundLevel } from "../../engine/compareDefiledGroundData";

export type HealingPulseMode = "normal" | "onceAtStart";
export const DEFAULT_HEALING_PULSE_MODE: HealingPulseMode = "normal";

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
  healingPulseEnabled: boolean;
  healingPulseMode: HealingPulseMode;
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
  healingPulseEnabled: false,
  healingPulseMode: DEFAULT_HEALING_PULSE_MODE,
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
