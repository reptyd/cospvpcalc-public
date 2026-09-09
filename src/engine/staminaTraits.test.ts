import { describe, expect, it } from "vitest";
import { applyTraitModifier, resolveTraitPercent } from "./buildProgressionRuntime";
import { getCreatureSpecificPlushieModifiers } from "./plushieBuildMappings";
import type { CreatureRuntime } from "./types";

// The two traits that move a stamina figure. They are applied by the build
// layer rather than by the Speed Builds registry, because a fight reads a pool
// and a rate and the registry never reaches a fight - so a row there would both
// miss the fight and, since Speed Builds takes the built figures as its base,
// apply the trait a second time.

function stats(): CreatureRuntime["stats"] {
  return {
    tier: 2,
    health: 1000,
    weight: 100,
    damage: 100,
    biteCooldown: 1,
    healthRegen: 0,
    stamina: 200,
    stamRegen: 4,
  } as CreatureRuntime["stats"];
}

const at = (traitId: string, ascension: number) => {
  const s = stats();
  applyTraitModifier(s, traitId, resolveTraitPercent(traitId, ascension));
  return s;
};

describe("Max Stamina trait", () => {
  it("raises the pool by 15% with no ascension and leaves the rate alone", () => {
    const s = at("Max_Stamina", 0);
    expect(s.stamina).toBeCloseTo(230, 6);
    expect(s.stamRegen).toBeCloseTo(4, 6);
  });

  it("walks 1.15 + 0.025 x n for n from 0 to 5", () => {
    const pools = [0, 1, 2, 3, 4, 5].map((a) => at("Max_Stamina", a).stamina ?? 0);
    for (const [i, expected] of [230, 235, 240, 245, 250, 255].entries()) {
      expect(pools[i], `ascension ${i}`).toBeCloseTo(expected, 6);
    }
  });
});

describe("Stamina Regen trait", () => {
  it("raises the rate by 20% with no ascension and leaves the pool alone", () => {
    const s = at("Stamina_Regen", 0);
    expect(s.stamRegen).toBeCloseTo(4.8, 6);
    expect(s.stamina).toBeCloseTo(200, 6);
  });

  it("walks 1.2 + 0.035 x n for n from 0 to 5", () => {
    const rates = [0, 1, 2, 3, 4, 5].map((a) => at("Stamina_Regen", a).stamRegen ?? 0);
    for (const [i, expected] of [4.8, 4.94, 5.08, 5.22, 5.36, 5.5].entries()) {
      expect(rates[i], `ascension ${i}`).toBeCloseTo(expected, 6);
    }
  });
});

// The plushies whose whole effect is a stamina figure divide the same way the
// two traits do: the build layer applies them, because a fight reads a pool and
// a rate, and the Speed Builds registry leaves them alone so the figure is not
// counted twice.
describe("the plushies that move a pool or a rate", () => {
  const modifiersFor = (plushie: string) => getCreatureSpecificPlushieModifiers(false, plushie) ?? [];

  it("raises the pool by 10% for Stick [REF:plushie_stick]", () => {
    expect(modifiersFor("Stick")).toEqual([
      { stat: "staminaPct", op: "addPct", value: 10, note: "Stick" },
    ]);
  });

  it("raises the stamina rate by 25% for Rock [REF:plushie_rock]", () => {
    expect(modifiersFor("Rock")).toEqual([
      { stat: "stamRegenPct", op: "addPct", value: 25, note: "Rock" },
    ]);
  });

  it("lowers the stamina rate by 25% for Swan [REF:plushie_swan]", () => {
    expect(modifiersFor("Swan")).toEqual([
      { stat: "stamRegenPct", op: "addPct", value: -25, note: "Swan" },
    ]);
  });

  it("raises the pool by 20% for Partridge and leaves its movement side alone [REF:plushie_partridge]", () => {
    expect(modifiersFor("Partridge")).toEqual([
      { stat: "staminaPct", op: "addPct", value: 20, note: "Partridge" },
    ]);
  });
});
