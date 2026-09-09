import OptimizerWorker from "./optimizer.worker?worker";
import type { CustomCreaturePayload, OptimizerWorkerResponse } from "./optimizerWorkerProtocol";
import { getWorkerTimerApi } from "./workerTiming";

export function createOptimizerWorkers({
  taskCount,
  minWorkers = 1,
  maxWorkers = 8,
  reserveMainThread = false,
}: {
  taskCount: number;
  minWorkers?: number;
  maxWorkers?: number;
  reserveMainThread?: boolean;
}): Worker[] {
  const workerCount = getOptimizerWorkerCount({ taskCount, minWorkers, maxWorkers, reserveMainThread });
  return Array.from({ length: workerCount }, () => new OptimizerWorker());
}

export function getOptimizerWorkerCount({
  taskCount,
  minWorkers = 1,
  maxWorkers = 8,
  reserveMainThread = false,
}: {
  taskCount: number;
  minWorkers?: number;
  maxWorkers?: number;
  reserveMainThread?: boolean;
}): number {
  const hardwareThreads = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  const hardwareBudget = reserveMainThread ? Math.max(1, hardwareThreads - 1) : hardwareThreads;
  return Math.max(minWorkers, Math.min(maxWorkers, hardwareBudget, Math.max(1, taskCount)));
}

export async function pingOptimizerWorkers(workers: Worker[], timeoutMs = 1500): Promise<boolean[]> {
  const timerApi = getWorkerTimerApi();
  return Promise.all(
    workers.map(
      (worker, idx) =>
        new Promise<boolean>((resolve) => {
          const pingId = -100000 - idx;
          const timer = timerApi.setTimeout(() => {
            cleanup();
            resolve(false);
          }, timeoutMs);
          const onMessage = (event: MessageEvent<OptimizerWorkerResponse>) => {
            const payload = event.data;
            if (payload?.id !== pingId) return;
            cleanup();
            resolve(true);
          };
          const onError = () => {
            cleanup();
            resolve(false);
          };
          const cleanup = () => {
            timerApi.clearTimeout(timer);
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
          };
          worker.addEventListener("message", onMessage);
          worker.addEventListener("error", onError);
          worker.postMessage({ kind: "ping", id: pingId });
        }),
    ),
  );
}

export function terminateWorkers(workers: Worker[]): void {
  workers.forEach((worker) => worker.terminate());
}

export async function syncCustomCreaturesToWorkers(
  workers: Worker[],
  records: CustomCreaturePayload[],
  timeoutMs = 5000,
): Promise<boolean[]> {
  if (records.length === 0) return workers.map(() => true);
  const timerApi = getWorkerTimerApi();
  return Promise.all(
    workers.map(
      (worker, idx) =>
        new Promise<boolean>((resolve) => {
          const syncId = -200000 - idx;
          const timer = timerApi.setTimeout(() => {
            cleanup();
            resolve(false);
          }, timeoutMs);
          const onMessage = (event: MessageEvent<OptimizerWorkerResponse>) => {
            const payload = event.data;
            if (payload?.id !== syncId) return;
            cleanup();
            resolve(!payload.error);
          };
          const onError = () => {
            cleanup();
            resolve(false);
          };
          const cleanup = () => {
            timerApi.clearTimeout(timer);
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
          };
          worker.addEventListener("message", onMessage);
          worker.addEventListener("error", onError);
          worker.postMessage({ kind: "customCreaturesSync", id: syncId, records });
        }),
    ),
  );
}
