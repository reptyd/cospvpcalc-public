import { describe, expect, it } from "vitest";
import { parseTiming, printTiming } from "./timingDsl";

describe("parseTiming", () => {
  it("parses minimal timing", () => {
    const r = parseTiming(`
timing user.fast_burst "Fast Burst"
  candidates: 0, 0.1, 0.5
  horizon: 15
`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.id).toBe("user.fast_burst");
      expect(r.spec.display_name).toBe("Fast Burst");
      expect(r.spec.candidates).toEqual([0, 0.1, 0.5]);
      expect(r.spec.horizon_sec).toBe(15);
    }
  });

  it("parses optional threshold + force_skip / force_fire", () => {
    const r = parseTiming(`
timing user.x "X"
  candidates: 0, 1
  horizon: 30
  threshold: 0.001
  force_skip: self.hp_ratio < 0.1
  force_fire: opp.hp_ratio < 0.2
`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.threshold).toBe(0.001);
      expect(r.spec.force_skip).toBeTruthy();
      expect(r.spec.force_fire).toBeTruthy();
    }
  });

  it("rejects bad header", () => {
    expect(parseTiming("not a header").ok).toBe(false);
  });

  it("rejects negative candidates", () => {
    const r = parseTiming(`
timing user.x "X"
  candidates: 0, -1
  horizon: 15
`);
    expect(r.ok).toBe(false);
  });

  it("rejects empty candidates", () => {
    const r = parseTiming(`
timing user.x "X"
  candidates:
  horizon: 15
`);
    expect(r.ok).toBe(false);
  });
});

describe("printTiming round-trip", () => {
  const fixtures = [
    `timing user.x "X"
  candidates: 0, 0.5, 1
  horizon: 15`,
    `timing user.y "Y with skip"
  candidates: 0, 1
  horizon: 30
  threshold: 0.001
  force_skip: self.hp_ratio < 0.1`,
  ];

  for (const text of fixtures) {
    it(`survives parse → print → parse`, () => {
      const r1 = parseTiming(text);
      expect(r1.ok).toBe(true);
      if (!r1.ok) return;
      const printed = printTiming(r1.spec);
      const r2 = parseTiming(printed);
      expect(r2.ok).toBe(true);
      if (r2.ok) expect(r2.spec).toEqual(r1.spec);
    });
  }
});
