import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WorkerConstructor = vi.hoisted(() => vi.fn());

vi.mock("./optimizer.worker?worker", () => ({
  default: WorkerConstructor,
}));

import { createOptimizerWorkers, getOptimizerWorkerCount, pingOptimizerWorkers, terminateWorkers } from "./optimizerWorkerClient";

type FakeWorker = {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, handler: (...args: unknown[]) => void) => void;
  removeEventListener: (type: string, handler: (...args: unknown[]) => void) => void;
  emitMessage: (payload: unknown) => void;
  emitError: () => void;
};

function createFakeWorker(): FakeWorker {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: (type, handler) => {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener: (type, handler) => {
      listeners.get(type)?.delete(handler);
    },
    emitMessage: (payload) => {
      for (const handler of listeners.get("message") ?? []) {
        handler({ data: payload });
      }
    },
    emitError: () => {
      for (const handler of listeners.get("error") ?? []) {
        handler(new Error("worker failed"));
      }
    },
  };
}

describe("optimizer worker client", () => {
  const globalShim: any = globalThis;
  const previousNavigator = globalShim.navigator;
  const previousWindow = globalShim.window;

  beforeEach(() => {
    WorkerConstructor.mockReset();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { hardwareConcurrency: 8 },
    });
    globalShim.window = globalThis;
  });

  afterEach(() => {
    if (previousNavigator === undefined) {
      delete globalShim.navigator;
    } else {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: previousNavigator,
      });
    }
    if (previousWindow === undefined) {
      delete globalShim.window;
    } else {
      globalShim.window = previousWindow;
    }
  });

  it("caps worker count by task count and reserved main thread budget", () => {
    const count = getOptimizerWorkerCount({
      taskCount: 6,
      minWorkers: 1,
      maxWorkers: 8,
      reserveMainThread: true,
    });

    expect(count).toBe(6);
  });

  it("creates exactly the computed number of workers", () => {
    WorkerConstructor.mockImplementation(function MockOptimizerWorker() {
      return createFakeWorker() as unknown as void;
    });

    const workers = createOptimizerWorkers({
      taskCount: 3,
      minWorkers: 1,
      maxWorkers: 8,
    });

    expect(WorkerConstructor).toHaveBeenCalledTimes(3);
    expect(workers).toHaveLength(3);
  });

  it("marks pings as successful only for matching pong ids", async () => {
    const workerA = createFakeWorker();
    const workerB = createFakeWorker();

    const pending = pingOptimizerWorkers(
      [workerA, workerB] as unknown as Worker[],
      50,
    );

    const firstPing = workerA.postMessage.mock.calls[0]?.[0];
    const secondPing = workerB.postMessage.mock.calls[0]?.[0];
    workerA.emitMessage({ id: firstPing.id });
    workerB.emitMessage({ id: secondPing.id + 1 });
    workerB.emitError();

    await expect(pending).resolves.toEqual([true, false]);
  });

  it("uses global timers even when window is unavailable", async () => {
    const worker = createFakeWorker();
    delete globalShim.window;

    const pending = pingOptimizerWorkers([worker] as unknown as Worker[], 50);
    const ping = worker.postMessage.mock.calls[0]?.[0];
    worker.emitMessage({ id: ping.id });

    await expect(pending).resolves.toEqual([true]);
  });

  it("terminates every worker in the collection", () => {
    const workerA = createFakeWorker();
    const workerB = createFakeWorker();

    terminateWorkers([workerA, workerB] as unknown as Worker[]);

    expect(workerA.terminate).toHaveBeenCalledOnce();
    expect(workerB.terminate).toHaveBeenCalledOnce();
  });
});
