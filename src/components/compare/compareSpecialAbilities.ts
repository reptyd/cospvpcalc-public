import type { CreatureRuntime, TwoFacedMode } from "../../engine";
import { DEFAULT_TWO_FACED_MODE } from "../../engine";
import type { CompareDefiledGroundLevel } from "../../engine/compareDefiledGroundData";

export type HealingPulseMode = "normal" | "onceAtStart";
export const DEFAULT_HEALING_PULSE_MODE: HealingPulseMode = "normal";

export type CompareSpecialAbilityState = {
  volcanic: boolean;
  frosty: boolean;
  defiledGround: boolean;
  defiledGroundLevel: CompareDefiledGroundLevel;
  gourmandizer: boolean;
  broodwatcher: boolean;
  hungerRule: boolean;
  powerCharge: boolean;
  goreCharge: boolean;
  startingSpiteCharged: boolean;
  wardenRageStartHp: boolean;
  wardenRageStartHpPct: number;
  gourmandizerStartingHunger: number;
  strengthInNumbers: boolean;
  strengthInNumbersAllies: number;
  traps: boolean;
  trails: boolean;
  twoFacedMode: TwoFacedMode;
  healingPulseEnabled: boolean;
  healingPulseMode: HealingPulseMode;
};

export const DEFAULT_COMPARE_SPECIAL_ABILITIES: CompareSpecialAbilityState = {
  volcanic: false,
  frosty: false,
  defiledGround: false,
  defiledGroundLevel: 1,
  gourmandizer: false,
  broodwatcher: false,
  hungerRule: false,
  powerCharge: false,
  goreCharge: false,
  startingSpiteCharged: false,
  wardenRageStartHp: false,
  wardenRageStartHpPct: 50,
  gourmandizerStartingHunger: 100,
  strengthInNumbers: false,
  strengthInNumbersAllies: 0,
  traps: false,
  trails: false,
  twoFacedMode: DEFAULT_TWO_FACED_MODE,
  healingPulseEnabled: false,
  healingPulseMode: DEFAULT_HEALING_PULSE_MODE,
};

export function creatureHasAbility(creature: CreatureRuntime | undefined, abilityName: string): boolean {
  if (!creature) return false;
  const abilities = [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? []), ...(creature.breathAbilities ?? [])];
  return abilities.some((ability) => ability.name === abilityName);
}
