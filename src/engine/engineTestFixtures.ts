import { applyRulesAndBuild } from "./engine";
import { creatureByName } from "./data";
import {
  __test_buildCombatantRuntime,
  __test_createCombatantState,
} from "./engineTestApi";
import type { BuildOptions, CreatureRuntime, FinalStats } from "./types";

export const EMPTY_BUILD_0: BuildOptions = {
  venerationStage: 0,
  traits: [],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [],
  elder: "None",
};

export function getEngineCreatureStrict(name: string): CreatureRuntime {
  const creature = creatureByName[name];
  if (!creature) throw new Error(`Missing engine test creature: ${name}`);
  return creature;
}

export function buildFinalFromCreatureName(
  name: string,
  build: BuildOptions = EMPTY_BUILD_0,
): FinalStats {
  return applyRulesAndBuild(getEngineCreatureStrict(name), build);
}

export function buildFinalFromStats(
  name: string,
  stats: FinalStats,
  build: BuildOptions = EMPTY_BUILD_0,
): FinalStats {
  return applyRulesAndBuild({ name, stats }, build);
}

export function buildRuntimeState(final: FinalStats) {
  return {
    runtime: __test_buildCombatantRuntime(final),
    state: __test_createCombatantState(final),
  };
}

export function buildRuntimePair(attacker: FinalStats, defender: FinalStats) {
  return {
    attacker: buildRuntimeState(attacker),
    defender: buildRuntimeState(defender),
  };
}
