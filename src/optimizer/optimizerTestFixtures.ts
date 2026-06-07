import { applyRulesAndBuild } from "../engine";
import type { BuildOptions, CreatureRuntime } from "../engine";
import { creatureByName } from "../engine/creatureData";
import type { DummyInputValues, DummyValues } from "./optimizerDummy";

export const EMPTY_BUILD_5: BuildOptions = {
  venerationStage: 5,
  traits: [],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [],
  elder: "None",
};

export const DAMAGE_WEIGHT_VOID_BUILD: BuildOptions = {
  venerationStage: 5,
  traits: ["Damage", "Weight"],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
  plushies: ["Void", "Void"],
  elder: "None",
};

export const LOCKED_COUNTER_BUILD: BuildOptions = {
  venerationStage: 5,
  traits: ["Damage", "Weight"],
  ascensionAssignments: ["Damage", "Weight", "Damage", "Weight", "Damage"],
  plushies: ["Void", "Void"],
  elder: "None",
};

export const DEFAULT_DUMMY_VALUES: DummyValues = {
  health: 20000,
  weight: 0,
  damage: 1,
  biteCooldown: 2,
};

export const DEFAULT_DUMMY_INPUTS: DummyInputValues = {
  health: "20000",
  weight: "",
  damage: "1",
  biteCooldown: "2",
};

export function getCreatureStrict(name: string): CreatureRuntime {
  const creature = creatureByName[name];
  if (!creature) throw new Error(`Missing creature fixture: ${name}`);
  return creature;
}

export function getCreaturePairStrict(nameA: string, nameB: string): {
  creatureA: CreatureRuntime;
  creatureB: CreatureRuntime;
} {
  return {
    creatureA: getCreatureStrict(nameA),
    creatureB: getCreatureStrict(nameB),
  };
}

export function createCancelRef(): { current: boolean } {
  return { current: false };
}

export function createNoopProgress(): (value: number) => void {
  return (_value: number) => undefined;
}

export function createDummyFinalForCreature(creatureName: string) {
  return applyRulesAndBuild(getCreatureStrict(creatureName), {
    venerationStage: 0,
    traits: [],
    ascensionAssignments: ["", "", "", "", ""],
    plushies: [],
  });
}
