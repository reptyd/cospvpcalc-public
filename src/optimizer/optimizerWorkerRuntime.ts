import type { OptimizerWorkerResponse } from "./optimizerWorkerProtocol";

type OptimizerWorkerScope = typeof globalThis & {
  postMessage: (message: OptimizerWorkerResponse) => void;
  addEventListener: typeof self.addEventListener;
  onmessage: ((event: MessageEvent) => void) | null;
};

function getWorkerScope(): OptimizerWorkerScope {
  return self as OptimizerWorkerScope;
}

export function postOptimizerWorkerResponse(message: OptimizerWorkerResponse): void {
  getWorkerScope().postMessage(message);
}

export function getOptimizerWorkerScope(): OptimizerWorkerScope {
  return getWorkerScope();
}
