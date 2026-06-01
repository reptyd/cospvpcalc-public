// Compare worker — runs the synchronous WASM `simulateComposableMatchup`
// off the main thread so the UI stays responsive while the engine is
// computing posture-policy replays / large policy searches.
//
// Architecture parallel to `optimizer.worker.ts` (Best Builds), but
// scoped to a single message kind (`compareSimulate`). No custom-
// creature sync needed — Compare passes already-built creatures
// through the message payload.

import { loadRustMatchupBridge, getLoadedRustMatchupBridge } from "./rustMatchupLoader";
import type {
  RustAbilityTimingMode,
  RustComposableAbilityConfig,
  RustSimpleBreathProfile,
  RustSimpleCombatantStats,
} from "./rustMatchupBridge";
import type {
  CompareWorkerIncoming,
  CompareWorkerResponse,
  CompareWorkerScope,
} from "./compareWorkerProtocol";

const scope = self as unknown as CompareWorkerScope;

// Eagerly start loading the WASM bridge — the first sim message often
// arrives before this resolves, but every dispatch awaits the promise
// so we never call `bridge.simulateComposableMatchup` on a half-loaded
// module.
const bridgeReady = loadRustMatchupBridge().catch((err) => {
  scope.postMessage({ id: -1, error: `bridge-load-failed | ${String(err)}` });
});

scope.addEventListener("error", (event: Event) => {
  const err = event as ErrorEvent;
  const msg = [
    "compare-worker-global-error",
    err.message || "no-message",
    err.filename || "no-file",
    `line:${err.lineno ?? 0}`,
    `col:${err.colno ?? 0}`,
    err.error instanceof Error ? err.error.stack ?? err.error.message : "",
  ]
    .filter(Boolean)
    .join(" | ");
  scope.postMessage({ id: -1, error: msg });
});

scope.addEventListener("unhandledrejection", (event: Event) => {
  const reason = (event as PromiseRejectionEvent).reason;
  const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  scope.postMessage({ id: -1, error: `compare-worker-unhandled-rejection | ${msg}` });
});

scope.onmessage = async (event: MessageEvent<CompareWorkerIncoming>) => {
  const payload = event.data;
  try {
    if (payload.kind === "ping") {
      const response: CompareWorkerResponse = { id: payload.id };
      scope.postMessage(response);
      return;
    }
    if (payload.kind === "compareSimulate") {
      await bridgeReady;
      const bridge = getLoadedRustMatchupBridge();
      if (!bridge) {
        const response: CompareWorkerResponse = {
          id: payload.id,
          error: "compare-worker: bridge unavailable after load",
        };
        scope.postMessage(response);
        return;
      }
      // Structured clone strips TS types over the message boundary;
      // the originating call site is `rustCompareDispatch.ts` which
      // already builds these via `toRustComposableArgsFromCompare` so
      // they conform to the expected shapes — cast to satisfy the
      // bridge's typed signature.
      const result = bridge.simulateComposableMatchup(
        payload.attacker as RustSimpleCombatantStats,
        payload.defender as RustSimpleCombatantStats,
        payload.attackerBreath as RustSimpleBreathProfile | null,
        payload.defenderBreath as RustSimpleBreathProfile | null,
        payload.abilityPolicy as RustAbilityTimingMode,
        payload.abilityConfig as RustComposableAbilityConfig,
        payload.maxTimeSec,
        payload.recordTrace,
      );
      const response: CompareWorkerResponse = { id: payload.id, result };
      scope.postMessage(response);
      return;
    }
    // Unknown kind — defensive.
    scope.postMessage({
      id: -1,
      error: `compare-worker: unknown message kind | ${String((payload as { kind?: string }).kind)}`,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.stack ?? err.message : String(err);
    scope.postMessage({ id: payload.id ?? -1, error: detail });
  }
};
