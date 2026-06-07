/**
 * Contract for the bridge-status state machine. Locks the
 * invariants App.tsx's banner relies
 * on so the loader can be refactored without breaking the UX
 * contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRustMatchupBridgeForTests,
  __setRustMatchupBridgeStatusForTests,
  getRustMatchupBridgeFailureError,
  getRustMatchupBridgeStatus,
  subscribeRustMatchupBridgeStatus,
  type RustMatchupBridgeStatus,
} from "./rustMatchupLoader";

describe("rustMatchupLoader status machine", () => {
  beforeEach(() => {
    __resetRustMatchupBridgeForTests();
  });

  afterEach(() => {
    __resetRustMatchupBridgeForTests();
  });

  it("starts in the idle state with no failure error", () => {
    expect(getRustMatchupBridgeStatus()).toBe("idle");
    expect(getRustMatchupBridgeFailureError()).toBeNull();
  });

  it("notifies subscribers on each transition", () => {
    const seen: RustMatchupBridgeStatus[] = [];
    subscribeRustMatchupBridgeStatus((status) => {
      seen.push(status);
    });

    __setRustMatchupBridgeStatusForTests("loading");
    __setRustMatchupBridgeStatusForTests("ready");

    expect(seen).toEqual(["loading", "ready"]);
  });

  it("does not re-notify when the status is set to its current value", () => {
    const callback = vi.fn();
    subscribeRustMatchupBridgeStatus(callback);

    __setRustMatchupBridgeStatusForTests("loading");
    __setRustMatchupBridgeStatusForTests("loading"); // dedupe

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("loading");
  });

  it("captures the failure error when transitioning to failed", () => {
    const cause = new Error("WASM unavailable");
    __setRustMatchupBridgeStatusForTests("failed", cause);

    expect(getRustMatchupBridgeStatus()).toBe("failed");
    expect(getRustMatchupBridgeFailureError()).toBe(cause);
  });

  it("returns an unsubscribe function that stops further notifications", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeRustMatchupBridgeStatus(callback);

    __setRustMatchupBridgeStatusForTests("loading");
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    __setRustMatchupBridgeStatusForTests("ready");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("isolates a buggy subscriber so other subscribers still fire", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const buggy = vi.fn(() => {
      throw new Error("buggy subscriber");
    });
    const healthy = vi.fn();
    subscribeRustMatchupBridgeStatus(buggy);
    subscribeRustMatchupBridgeStatus(healthy);

    __setRustMatchupBridgeStatusForTests("loading");

    expect(buggy).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
