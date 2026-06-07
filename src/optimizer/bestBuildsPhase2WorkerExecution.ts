import type { BestBuildsPathCounts, BestBuildsPhase2Job, OptimizerWorkerResponse } from "./optimizerWorkerProtocol";
import {
  evaluateBestBuildsPhase2ChunkFallback,
  mergeBestBuildsPathCounts,
  type BestBuildsPhase2Result,
  type BestBuildsPhase2Skeleton,
} from "./bestBuildsPhase2RuntimeHelpers";
import { getWorkerTimerApi } from "./workerTiming";

export async function runBestBuildsPhase2WorkerExecution({
  workers,
  chunks,
  buildPhaseJob,
  mapRows,
  onProgress,
  cancelRef,
  timeoutMs = 100000,
}: {
  workers: Worker[];
  chunks: BestBuildsPhase2Skeleton[][];
  buildPhaseJob: (chunk: BestBuildsPhase2Skeleton[], idx: number) => BestBuildsPhase2Job;
  mapRows: (rows: NonNullable<OptimizerWorkerResponse["bestBuildsResults"]>) => BestBuildsPhase2Result[];
  onProgress: (value: number) => void;
  cancelRef: { current: boolean };
  timeoutMs?: number;
}): Promise<{ results: BestBuildsPhase2Result[]; pathCounts: BestBuildsPathCounts }> {
  const results: BestBuildsPhase2Result[] = [];
  const pathCounts: BestBuildsPathCounts = {};
  let completed = 0;
  let chunkIndex = 0;
  const timerApi = getWorkerTimerApi();

  const chunkTimingsEnabled = Boolean(
    (globalThis as { __COS_CALC_LOG_BB_CHUNK_TIMINGS__?: unknown }).__COS_CALC_LOG_BB_CHUNK_TIMINGS__,
  );
  const chunkDurations: number[] = new Array(chunks.length).fill(0);
  const chunkDispatchedAt: number[] = new Array(chunks.length).fill(0);
  const workerBusyMs: number[] = new Array(workers.length).fill(0);
  const workerChunkCount: number[] = new Array(workers.length).fill(0);
  const runStartedAt = chunkTimingsEnabled ? performance.now() : 0;

  const completeChunk = (rows: BestBuildsPhase2Result[]) => {
    results.push(...rows);
    completed += 1;
    onProgress(Math.min(1, completed / Math.max(1, chunks.length)));
  };

  await new Promise<void>((resolve) => {
    let active = workers.length;

    const dispatchNext = (worker: Worker): number | null => {
      if (cancelRef.current) return null;
      const idx = chunkIndex;
      if (idx >= chunks.length) return null;
      chunkIndex += 1;
      if (chunkTimingsEnabled) chunkDispatchedAt[idx] = performance.now();
      worker.postMessage(buildPhaseJob(chunks[idx], idx));
      return idx;
    };

    const finishWorker = (worker: Worker) => {
      worker.terminate();
      active -= 1;
      if (active <= 0) resolve();
    };

    const runChunkFallback = (failedChunkId: number | null) => {
      if (failedChunkId == null) return;
      const chunk = chunks[failedChunkId];
      if (!chunk) return;
      console.warn(`[optimizer] Running TS fallback for chunk ${failedChunkId} (${chunk.length} skeletons) - this will be slow at ideal policy`);
      const fallback = evaluateBestBuildsPhase2ChunkFallback({
        chunk,
        chunkIndex: failedChunkId,
        buildPhaseJob,
        mapRows,
      });
      mergeBestBuildsPathCounts(pathCounts, fallback.pathCounts);
      completeChunk(fallback.results);
    };

    workers.forEach((worker, workerIdx) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let currentChunkId: number | null = null;

      const recordChunkFinished = (chunkId: number | null) => {
        if (!chunkTimingsEnabled || chunkId == null) return;
        const dispatchedAt = chunkDispatchedAt[chunkId];
        if (!dispatchedAt) return;
        const duration = performance.now() - dispatchedAt;
        chunkDurations[chunkId] = duration;
        workerBusyMs[workerIdx] += duration;
        workerChunkCount[workerIdx] += 1;
      };

      const cleanup = () => {
        if (timeoutId !== null) {
          timerApi.clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const armTimeout = () => {
        timeoutId = timerApi.setTimeout(() => {
          cleanup();
          console.error(`Best-builds worker timeout for chunk ${currentChunkId}`);
          if (!cancelRef.current) runChunkFallback(currentChunkId);
          const nextChunkId = dispatchNext(worker);
          if (nextChunkId === null) {
            finishWorker(worker);
          } else {
            currentChunkId = nextChunkId;
            armTimeout();
          }
        }, timeoutMs);
      };

      worker.onmessage = (event: MessageEvent<OptimizerWorkerResponse>) => {
        cleanup();
        recordChunkFinished(currentChunkId);
        if (cancelRef.current) {
          finishWorker(worker);
          return;
        }
        const payload = event.data;
        if (payload.error) {
          console.error(`Best-builds worker error: ${payload.error}`);
          runChunkFallback(currentChunkId);
        } else {
          mergeBestBuildsPathCounts(pathCounts, payload.bestBuildsPathCounts);
          completeChunk(mapRows(payload.bestBuildsResults ?? []));
        }

        const nextChunkId = dispatchNext(worker);
        if (nextChunkId === null) {
          finishWorker(worker);
        } else {
          currentChunkId = nextChunkId;
          armTimeout();
        }
      };

      worker.onerror = (error) => {
        cleanup();
        console.error("Best-builds worker runtime error:", error);
        if (!cancelRef.current) runChunkFallback(currentChunkId);
        const nextChunkId = dispatchNext(worker);
        if (nextChunkId === null) {
          finishWorker(worker);
        } else {
          currentChunkId = nextChunkId;
          armTimeout();
        }
      };

      const initialChunkId = dispatchNext(worker);
      if (initialChunkId === null) {
        finishWorker(worker);
      } else {
        currentChunkId = initialChunkId;
        armTimeout();
      }
    });
  });

  if (chunkTimingsEnabled) {
    const wallMs = performance.now() - runStartedAt;
    const finished = chunkDurations.filter((d) => d > 0);
    if (finished.length > 0) {
      const sorted = [...finished].sort((a, b) => a - b);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const mean = finished.reduce((s, v) => s + v, 0) / finished.length;
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      const totalBusy = workerBusyMs.reduce((s, v) => s + v, 0);
      const utilization = totalBusy / (wallMs * workers.length);
      const tailRatio = max / mean;
      console.log(
        `[BB phase2 timings] chunks=${finished.length} wall=${wallMs.toFixed(0)}ms workers=${workers.length} ` +
        `chunk ms: min=${min.toFixed(0)} p50=${p50.toFixed(0)} mean=${mean.toFixed(0)} p90=${p90.toFixed(0)} max=${max.toFixed(0)} ` +
        `tail/mean=${tailRatio.toFixed(2)}× util=${(utilization * 100).toFixed(0)}%`,
      );
      console.log(
        `[BB phase2 per-worker] ` +
        workerBusyMs
          .map((busy, idx) => `w${idx}:${busy.toFixed(0)}ms/${workerChunkCount[idx]}`)
          .join(" "),
      );
    }
  }

  return cancelRef.current ? { results: [], pathCounts: {} } : { results, pathCounts };
}
