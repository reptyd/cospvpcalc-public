import type { CreatureRuntime, FinalStats, SimulationSummary } from "../engine";
import { DEFAULT_BUILD } from "../shared/buildDomain";
import { simulateBuildMatchupViaRust } from "../shared/buildSimulationRust";

export type PlushieBaselineContext = {
  baselineA: FinalStats;
  baselineB: FinalStats;
  baselineSummary: SimulationSummary;
  baselineDebugA: NonNullable<SimulationSummary["debug"]>["A"] | undefined;
  baselineDebugB: NonNullable<SimulationSummary["debug"]>["B"] | undefined;
} | null;

export async function createPlushieBaselineContext(
  creatureA: CreatureRuntime,
  creatureB: CreatureRuntime,
): Promise<PlushieBaselineContext> {
  const sim = await simulateBuildMatchupViaRust({
    creatureA,
    buildA: DEFAULT_BUILD,
    creatureB,
    buildB: DEFAULT_BUILD,
    options: { activesOn: true, breathOn: true, maxTimeSec: 12 },
  });
  if (!sim) return null;

  return {
    baselineA: sim.finalA,
    baselineB: sim.finalB,
    baselineSummary: sim.summary,
    baselineDebugA: sim.summary.debug?.A,
    baselineDebugB: sim.summary.debug?.B,
  };
}
