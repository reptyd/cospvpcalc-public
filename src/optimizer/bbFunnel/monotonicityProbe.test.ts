/// <reference types="node" />
// The skyline orders builds on the axes this probe says are monotone, and the
// finding was sitting in a constant with nothing checking it. Two guards:
//
//  - coverage runs always. Every axis the skyline orders on must have a probe,
//    and every order-candidate probe must name a real skyline axis. Adding an
//    axis to the skyline without measuring it now fails here.
//  - the sweep itself is gated behind COS_CALC_BB_MONOTONICITY, because it is
//    dozens of 480 s `ideal` fights against a Fortify carrier. Run it after an
//    engine change that could bend one of these curves; it re-derives the
//    demote set and compares it with the constant the skyline ships.
import { describe, expect, it } from "vitest";
import { loadRustForNode } from "../rustNodeMatchup";
import { AXIS_PROBES, runAllAxisProbes, type RustModuleLike } from "./monotonicityProbe";
import {
  ORDER_AXIS_NAMES,
  PROBED_NON_MONOTONE_ORDER_AXES,
  type SkylineAxisName,
} from "./skylinePrune";

const SWEEP_ENABLED = !!process.env.COS_CALC_BB_MONOTONICITY;

describe("skyline monotonicity probe", () => {
  it("probes every axis the skyline is allowed to order on", () => {
    const orderProbes = AXIS_PROBES.filter((probe) => probe.role === "order-candidate");
    expect(new Set(orderProbes.map((probe) => probe.axis))).toEqual(new Set(ORDER_AXIS_NAMES));
  });

  it("keeps the exact-match candidates out of the order axes", () => {
    const exactProbes = AXIS_PROBES.filter((probe) => probe.role === "exact-match-candidate");
    expect(exactProbes.length).toBeGreaterThan(0);
    for (const probe of exactProbes) {
      expect(ORDER_AXIS_NAMES).not.toContain(probe.axis as SkylineAxisName);
    }
  });

  it.skipIf(!SWEEP_ENABLED)("re-derives the shipped demote set", async () => {
    const rust = (await loadRustForNode()) as unknown as RustModuleLike;
    const results = runAllAxisProbes(rust);
    for (const result of results) {
      console.log(`  ${result.axis.padEnd(18)} ${result.role.padEnd(22)} ${result.verdict} -> ${result.skylineRole}`);
    }
    const demoted = new Set(
      results
        .filter((result) => result.role === "order-candidate" && result.skylineRole !== "order")
        .map((result) => result.axis as SkylineAxisName),
    );
    expect([...demoted].sort()).toEqual([...PROBED_NON_MONOTONE_ORDER_AXES].sort());
  }, 1_800_000);
});
