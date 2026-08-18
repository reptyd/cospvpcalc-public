import { applyRulesAndBuild } from "./engine";
import type { BuildOptions, FinalStats } from "./types";

export const EMPTY_BUILD_0: BuildOptions = {
  venerationStage: 0,
  traits: [],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [],
  elder: "None",
};

export function buildFinalFromStats(
  name: string,
  stats: FinalStats,
  build: BuildOptions = EMPTY_BUILD_0,
): FinalStats {
  return applyRulesAndBuild({ name, stats }, build);
}
