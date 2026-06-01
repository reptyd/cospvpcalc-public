import type {
  BestBuildsPhase2Job,
  OptimizerWorkerCustomCreaturesSync,
  OptimizerWorkerPing,
  OptimizerWorkerResponse,
} from "./optimizerWorkerProtocol";
import { getOptimizerWorkerScope, postOptimizerWorkerResponse } from "./optimizerWorkerRuntime";

const workerScope = getOptimizerWorkerScope();

const bestBuildsExecutionPrefetch = import("./optimizerWorkerBestBuildsExecution");
const customCreaturesPrefetch = import("./optimizerWorkerCustomCreatureSync");
void import("./rustMatchupLoader").then((mod) => mod.loadRustMatchupBridge().catch(() => null));

workerScope.addEventListener("error", (event: Event) => {
  const err = event as ErrorEvent;
  const msg = [
    "worker-global-error",
    err.message || "no-message",
    err.filename || "no-file",
    `line:${err.lineno ?? 0}`,
    `col:${err.colno ?? 0}`,
    err.error instanceof Error ? err.error.stack ?? err.error.message : "",
  ]
    .filter(Boolean)
    .join(" | ");
  postOptimizerWorkerResponse({ id: -1, error: msg } satisfies OptimizerWorkerResponse);
});

workerScope.addEventListener("unhandledrejection", (event: Event) => {
  const reason = (event as PromiseRejectionEvent).reason;
  const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  postOptimizerWorkerResponse({ id: -1, error: `worker-unhandled-rejection | ${msg}` } satisfies OptimizerWorkerResponse);
});

type IncomingMessage = OptimizerWorkerPing | OptimizerWorkerCustomCreaturesSync | BestBuildsPhase2Job;

workerScope.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  try {
    const payload = event.data;
    if ((payload as OptimizerWorkerPing).kind === "ping") {
      postOptimizerWorkerResponse({ id: (payload as OptimizerWorkerPing).id } satisfies OptimizerWorkerResponse);
      return;
    }
    if ((payload as OptimizerWorkerCustomCreaturesSync).kind === "customCreaturesSync") {
      const sync = payload as OptimizerWorkerCustomCreaturesSync;
      const { applyCustomCreatureSync } = await customCreaturesPrefetch;
      applyCustomCreatureSync(sync.records);
      postOptimizerWorkerResponse({ id: sync.id } satisfies OptimizerWorkerResponse);
      return;
    }
    if ((payload as BestBuildsPhase2Job).kind === "bestBuildsPhase2") {
      const phaseJob = payload as BestBuildsPhase2Job;
      const { runBestBuildsWorkerJob } = await bestBuildsExecutionPrefetch;
      const { bestBuildsResults, pathCounts } = await runBestBuildsWorkerJob(phaseJob);
      postOptimizerWorkerResponse({ id: phaseJob.id, bestBuildsResults, bestBuildsPathCounts: pathCounts } satisfies OptimizerWorkerResponse);
      return;
    }
    postOptimizerWorkerResponse({ id: -1, error: `unknown-job-kind | ${String((payload as { kind?: string }).kind)}` } satisfies OptimizerWorkerResponse);
  } catch (error) {
    const err = error as Error;
    const detail = err?.stack ?? err?.message ?? String(error);
    postOptimizerWorkerResponse({ id: -1, error: detail } satisfies OptimizerWorkerResponse);
  }
};
