// Client-side bridge to the Compare worker.
//
// Provides a lazy, persistent worker instance for off-main-thread
// Compare simulations. Falls back to `null` when `Worker` is
// unavailable (Node test environment, environments where the worker
// failed to construct) - the caller (`rustCompareDispatch`) then
// falls back to a direct main-thread WASM call so behaviour stays
// identical, just blocking.
//
// Why a separate worker from Best Builds: Best Builds spawns one
// worker per parallel phase-2 job and tears them down at the end of
// the optimization run. Compare runs ONE simulation at a time and
// needs the worker alive for the whole session - short-lived
// per-call workers would re-pay the WASM-bridge load cost on every
// sim, which dominates Compare interactivity (~200 ms cold-start).

import type { CompareWorkerResponse, CompareWorkerSimulate } from "./compareWorkerProtocol";

// Resolved on the first call. Vite's `?worker` import is bundler
// syntax - at test time the file is `vi.mock`-ed to return a stub
// constructor.
//
 
let CompareWorkerCtor: (new () => Worker) | null = null;
let compareWorkerLoadPromise: Promise<(new () => Worker) | null> | null = null;

function loadCompareWorkerCtor(): Promise<(new () => Worker) | null> {
  if (CompareWorkerCtor) return Promise.resolve(CompareWorkerCtor);
  if (compareWorkerLoadPromise) return compareWorkerLoadPromise;
  compareWorkerLoadPromise = import("./compare.worker?worker")
    .then((mod) => {
       
      CompareWorkerCtor = (mod as any).default as new () => Worker;
      return CompareWorkerCtor;
    })
    .catch(() => null);
  return compareWorkerLoadPromise;
}

let workerInstance: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<
  number,
  { resolve: (result: unknown) => void; reject: (err: Error) => void }
>();

function attachWorkerListeners(worker: Worker): void {
  worker.addEventListener("message", (event: MessageEvent<CompareWorkerResponse>) => {
    const { id, result, error } = event.data ?? {};
    if (typeof id !== "number") return;
    const entry = pendingRequests.get(id);
    if (!entry) return; // stale or unknown id
    pendingRequests.delete(id);
    if (error) entry.reject(new Error(error));
    else entry.resolve(result);
  });
  worker.addEventListener("error", () => {
    // Worker-level error invalidates the worker. Reject all pending
    // requests and force re-construction on next call.
    for (const entry of pendingRequests.values()) {
      entry.reject(new Error("compare-worker: worker errored"));
    }
    pendingRequests.clear();
    workerInstance = null;
  });
}

async function getCompareWorker(): Promise<Worker | null> {
  if (typeof Worker === "undefined") return null;
  if (workerInstance) return workerInstance;
  const Ctor = await loadCompareWorkerCtor();
  if (!Ctor) return null;
  try {
    const w = new Ctor();
    attachWorkerListeners(w);
    workerInstance = w;
    return w;
  } catch {
    return null;
  }
}

/// Run a Compare simulation on the worker. Returns the WASM
/// summary on success, or `null` when the worker is unavailable
/// (caller should fall back to a main-thread call).
export async function simulateCompareInWorker(args: {
  attacker: unknown;
  defender: unknown;
  attackerBreath: unknown;
  defenderBreath: unknown;
  abilityPolicy: unknown;
  abilityConfig: unknown;
  maxTimeSec: number;
  recordTrace: boolean;
}): Promise<unknown | null> {
  const worker = await getCompareWorker();
  if (!worker) return null;
  const id = nextRequestId++;
  const message: CompareWorkerSimulate = {
    kind: "compareSimulate",
    id,
    attacker: args.attacker,
    defender: args.defender,
    attackerBreath: args.attackerBreath,
    defenderBreath: args.defenderBreath,
    abilityPolicy: args.abilityPolicy,
    abilityConfig: args.abilityConfig,
    maxTimeSec: args.maxTimeSec,
    recordTrace: args.recordTrace,
  };
  return new Promise<unknown>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    try {
      worker.postMessage(message);
    } catch (err) {
      pendingRequests.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/// Tear down the Compare worker (e.g., on page unmount during
/// tests). Not used in production today - the worker persists for
/// the session.
export function terminateCompareWorker(): void {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  for (const entry of pendingRequests.values()) {
    entry.reject(new Error("compare-worker: terminated"));
  }
  pendingRequests.clear();
}
