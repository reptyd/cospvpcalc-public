import type { BuildOptions, SimulationSummary } from "../engine";
import { creatureByName } from "../engine/creatureData";
import { simulateBuildMatchupViaRust } from "../shared/buildSimulationRust";
import type { BuildDetailsResult, DummyValues } from "./BuildDetails";
import { createDummyFinalStats } from "./buildDetailsExplainHelpers";

export type BuildDetailsSimRunner = (
  nextBuildA: BuildOptions,
  nextBuildB: BuildOptions,
  disabledA?: string[],
  disabledB?: string[],
) => Promise<SimulationSummary | null>;

export function createBuildDetailsSimRunner({
  result,
  mode,
  nameA,
  nameB,
  dummyValues,
}: {
  result: BuildDetailsResult;
  mode: "solo" | "counter";
  nameA: string;
  nameB: string;
  dummyValues: DummyValues;
}): BuildDetailsSimRunner {
  return async (
    nextBuildA: BuildOptions,
    nextBuildB: BuildOptions,
    disabledA: string[] = [],
    disabledB: string[] = [],
  ): Promise<SimulationSummary | null> => {
    const simNameA = result.simCreatureAName || nameA;
    const simNameB = result.simCreatureBName || nameB;
    const creatureA = creatureByName[simNameA];
    if (!creatureA) return null;

    if (mode === "solo") {
      const sim = await simulateBuildMatchupViaRust({
        creatureA,
        buildA: nextBuildA,
        finalB: createDummyFinalStats(result.simDummyValues ?? dummyValues),
        options: {
          activesOn: result.simActivesOn,
          breathOn: result.simBreathOn,
          abilityPolicy: result.abilityPolicy,
          disabledAbilitiesA: disabledA,
          disabledAbilitiesB: disabledB,
        },
      });
      return sim?.summary ?? null;
    }

    const creatureB = creatureByName[simNameB];
    if (!creatureB) return null;
    const sim = await simulateBuildMatchupViaRust({
      creatureA,
      buildA: nextBuildA,
      creatureB,
      buildB: nextBuildB,
      options: {
        activesOn: result.simActivesOn,
        breathOn: result.simBreathOn,
        abilityPolicy: result.abilityPolicy,
        disabledAbilitiesA: disabledA,
        disabledAbilitiesB: disabledB,
      },
    });
    return sim?.summary ?? null;
  };
}
