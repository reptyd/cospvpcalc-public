/// <reference types="node" />
// The opponent's floor, read through the shipped WASM rather than through the
// engine's own unit tests. The ranking at a zero win rate orders on it, and the
// figure has to survive the crossing to be worth ordering on: the first cut of
// this feature assembled the summary with `min(floor, final HP)`, which reported
// every floor as 1 - the HP a corpse is pinned to - because the fight runs on
// past the first death and pins the other side too. Nothing in cargo caught
// that, because nothing in cargo assembles the summary.
import { describe, expect, it } from "vitest";
import { loadRustForNode, runMatchupSummary } from "./rustNodeMatchup";

type FloorSummary = {
  winner: "A" | "B" | "Draw";
  maxHpB: number;
  minHpBWhileAAlive: number;
  hpBAtADeath: number;
};

describe("the opponent's floor through the shipped WASM", () => {
  it("never reads above the opponent's HP at the source's death", async () => {
    const rustMod = await loadRustForNode();
    for (const [a, b] of [
      ["Adharcaiin", "Abyssal Geortharoc"],
      ["Kavouradis", "Abyssal Geortharoc"],
      ["Adharcaiin", "Korathos"],
      ["Kavouradis", "Eldervaine"],
    ] as const) {
      const r = runMatchupSummary(rustMod, a, b) as unknown as FloorSummary;
      expect(Number.isFinite(r.minHpBWhileAAlive), `${a} vs ${b}`).toBe(true);
      expect(r.minHpBWhileAAlive, `${a} vs ${b}`).toBeGreaterThanOrEqual(0);
      expect(r.minHpBWhileAAlive, `${a} vs ${b}`).toBeLessThanOrEqual(r.maxHpB);
      expect(r.minHpBWhileAAlive, `${a} vs ${b}`).toBeLessThanOrEqual(r.hpBAtADeath + 1e-9);
    }
  }, 60_000);

  it("reads zero on a fight the source wins, not the corpse's pinned 1 HP", async () => {
    const rustMod = await loadRustForNode();
    const r = runMatchupSummary(rustMod, "Kavouradis", "Eldervaine") as unknown as FloorSummary;
    expect(r.winner).toBe("A");
    expect(r.minHpBWhileAAlive).toBe(0);
  }, 60_000);

  it("separates from the at-death reading exactly when the opponent heals back up", async () => {
    const rustMod = await loadRustForNode();
    // Abyssal Geortharoc carries no healing, so the two readings are the same
    // figure. Korathos regenerates through the window, so the floor is the
    // lower of the two - the quantity the ranking wants, and the one the
    // at-death reading cannot give.
    const flat = runMatchupSummary(rustMod, "Adharcaiin", "Abyssal Geortharoc") as unknown as FloorSummary;
    expect(flat.minHpBWhileAAlive).toBeCloseTo(flat.hpBAtADeath, 6);

    const heals = runMatchupSummary(rustMod, "Adharcaiin", "Korathos") as unknown as FloorSummary;
    expect(heals.minHpBWhileAAlive).toBeLessThan(heals.hpBAtADeath);
  }, 60_000);
});
