import { describe, expect, it } from "vitest";
import { cloneStateForProjection } from "./combatPrimitives";

describe("cloneStateForProjection", () => {
  it("deep-clones plain state-like objects without aliasing nested collections", () => {
    const original = {
      hp: 1000,
      hunkerOn: false,
      statuses: {
        Burn_Status: {
          stacks: 2,
          nextTickAt: 3,
          remainingSec: 5,
        },
      },
      rewindHistory: [
        {
          time: 1,
          hp: 1200,
          statuses: {
            Bleed_Status: {
              stacks: 1,
              nextTickAt: 2,
              remainingSec: 4,
            },
          },
        },
      ],
      approxNotes: ["x"],
    };

    const cloned = cloneStateForProjection(original);
    cloned.statuses.Burn_Status.stacks = 9;
    cloned.rewindHistory[0].statuses.Bleed_Status.stacks = 7;
    cloned.approxNotes.push("y");

    expect(original.statuses.Burn_Status.stacks).toBe(2);
    expect(original.rewindHistory[0]?.statuses.Bleed_Status.stacks).toBe(1);
    expect(original.approxNotes).toEqual(["x"]);
  });
});
