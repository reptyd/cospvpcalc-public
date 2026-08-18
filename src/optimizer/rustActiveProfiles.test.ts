import { describe, expect, it } from "vitest";
import { getExplicitOnHitStatuses } from "./rustActiveProfiles";
import type { CreatureRuntime } from "../engine";

function carrier(passiveAbilities: CreatureRuntime["passiveAbilities"]): CreatureRuntime {
  return { passiveAbilities } as CreatureRuntime;
}

describe("getExplicitOnHitStatuses default stacks", () => {
  it("applies 10 Deep Wounds for Serrated Teeth when the row carries a null value", () => {
    // Every creature row stores Serrated Teeth as value:null; the game applies
    // BaseAilmentAmount=10 per hit, so the marshaller must default to 10, not 1.
    const entries = getExplicitOnHitStatuses(
      carrier([
        { abilityId: "Serrated Teeth", name: "Serrated Teeth", value: null, semantics: "neutral", subtype: null },
      ]),
    );
    const deepWounds = entries.find((e) => e.statusId === "Deep_Wounds_Status");
    expect(deepWounds?.stacks).toBe(10);
  });

  it("honors an explicit numeric value over the default", () => {
    const entries = getExplicitOnHitStatuses(
      carrier([
        { abilityId: "Serrated Teeth", name: "Serrated Teeth", value: 3, semantics: "neutral", subtype: null },
      ]),
    );
    expect(entries.find((e) => e.statusId === "Deep_Wounds_Status")?.stacks).toBe(3);
  });
});
