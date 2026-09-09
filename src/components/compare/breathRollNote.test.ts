import { describe, expect, it } from "vitest";
import { describeBreathRolls } from "./breathRollNote";
import { breathAilmentsOnTarget, type BreathAilment } from "../../engine/breathAilmentText";

const burn = (probability: number, stacks: number | null = 1): BreathAilment => ({
  name: "Burn",
  probability,
  stacks,
  target: "opponent",
});

describe("the note under the breath roll modes", () => {
  it("states the schedule a chance keeps as a share of ticks", () => {
    expect(describeBreathRolls("even", 25, [burn(20)])).toBe(
      "Every chance lands as a whole event, spaced as evenly as the chance allows: "
        + "a crit on one tick in four and one stack of Burn on one tick in five.",
    );
  });

  it("reduces a chance that does not divide the ticks whole", () => {
    expect(describeBreathRolls("even", 0, [burn(30)])).toContain("three ticks in ten");
  });

  it("calls a certainty every tick rather than one tick in one", () => {
    expect(describeBreathRolls("even", 0, [burn(100, 2)])).toContain("2 stacks of Burn on every tick");
  });

  it("resolves the crit to its flat factor and the ailment to its fraction", () => {
    expect(describeBreathRolls("pseudo", 25, [burn(20)])).toBe(
      "No chance is drawn - on every tick the 25% crit chance becomes a flat 1.125x "
        + "and Burn lands 0.2 of a stack.",
    );
  });

  it("names every chance it draws", () => {
    expect(describeBreathRolls("random", 25, [burn(20)])).toBe(
      "The 25% crit chance and the 20% chance of one stack of Burn are drawn on every tick, "
        + "so one run differs from the next.",
    );
  });

  it("states the rule without numbers for a breath the spec table does not describe", () => {
    expect(describeBreathRolls("even", 0, [])).toBe(
      "Every chance lands as a whole event, spaced as evenly as the chance allows.",
    );
  });
});

describe("the chances a breath rolls onto its target", () => {
  const prose = "It can also inflict Slowed Status (Probability = 30%, no stacking), "
    + "and self-apply Muddy (Probability = 50%, STACKS = 2).";

  it("leaves out what the breath rolls onto its own user", () => {
    expect(breathAilmentsOnTarget(prose).map((a) => a.name)).toEqual(["Slowed Status"]);
  });

  it("quotes the chance the game gives where the prose disagrees", () => {
    expect(breathAilmentsOnTarget(prose, "Glacier Breath")[0].probability).toBe(15);
    expect(breathAilmentsOnTarget(prose)[0].probability).toBe(30);
  });
});
