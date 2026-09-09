import { describe, expect, it } from "vitest";
import { buildPlushieRustStatusBlockFractions } from "./rustStatusBlockFractions";

// The last thing that happens to a plushie's block before the engine sees it.
// Sparkler, Ginger Snapper and Ember Spirit each carry a weakness alongside
// their blocks, as a negative percent. Clamping that percent to zero here would
// drop the entry and leave the wearer the blocks alone.

describe("plushie block fractions handed to the engine", () => {
  it("passes a weakness through as a negative fraction [REF:plushie_sparkler]", () => {
    const built = buildPlushieRustStatusBlockFractions({
      plushieStatusBlockPct: {
        Poison_Status: 15,
        Frostbite_Status: 15,
        Burn_Status: 15,
        Bleed_Status: -20,
      },
    });
    expect(built).toEqual({
      Bleed_Status: -0.2,
      Burn_Status: 0.15,
      Frostbite_Status: 0.15,
      Poison_Status: 0.15,
    });
  });

  it("drops a channel that says nothing", () => {
    const built = buildPlushieRustStatusBlockFractions({
      plushieStatusBlockPct: { Bleed_Status: 0, Burn_Status: 7.5 },
    });
    expect(built).toEqual({ Burn_Status: 0.075 });
  });

  it("keeps the keys sorted so the payload is stable", () => {
    const built = buildPlushieRustStatusBlockFractions({
      plushieStatusBlockPct: { Poison_Status: 10, Bleed_Status: -5, Burn_Status: 1 },
    });
    expect(Object.keys(built)).toEqual(["Bleed_Status", "Burn_Status", "Poison_Status"]);
  });

  it("survives a missing map", () => {
    expect(buildPlushieRustStatusBlockFractions({})).toEqual({});
  });
});
