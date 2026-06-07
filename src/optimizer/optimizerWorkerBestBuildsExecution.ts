import { evaluateBestBuildsPhase2Job } from "./bestBuildsPhase2Evaluation";
import type { BestBuildsPathCounts, BestBuildsPhase2Job, BestBuildsWorkerResult } from "./optimizerWorkerProtocol";
import { loadRustMatchupBridge } from "./rustMatchupLoader";

export async function runBestBuildsWorkerJob(phaseJob: BestBuildsPhase2Job): Promise<{
  bestBuildsResults: BestBuildsWorkerResult[];
  pathCounts: BestBuildsPathCounts;
}> {
  await loadRustMatchupBridge().catch(() => null);
  return evaluateBestBuildsPhase2Job(phaseJob);
}
