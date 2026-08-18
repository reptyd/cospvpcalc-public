// Message protocol between Compare worker and main-thread client.
// Kept in its own file so both `compare.worker.ts` and
// `compareWorkerClient.ts` reference one canonical shape.

export type CompareWorkerScope = typeof globalThis & {
  postMessage: (message: CompareWorkerResponse) => void;
  addEventListener: typeof self.addEventListener;
  onmessage: ((event: MessageEvent) => void) | null;
};

/// Liveness check - used by the client to verify a freshly spun-up
/// worker actually responds before routing real sims to it.
export type CompareWorkerPing = {
  kind: "ping";
  id: number;
};

/// One-shot Compare simulation request. Payload mirrors the
/// positional arguments of `bridge.simulateComposableMatchup`.
export type CompareWorkerSimulate = {
  kind: "compareSimulate";
  id: number;
  attacker: unknown;
  defender: unknown;
  attackerBreath: unknown;
  defenderBreath: unknown;
  abilityPolicy: unknown;
  abilityConfig: unknown;
  maxTimeSec: number;
  recordTrace: boolean;
};

export type CompareWorkerIncoming = CompareWorkerPing | CompareWorkerSimulate;

export type CompareWorkerResponse = {
  id: number;
  result?: unknown;
  error?: string;
};
