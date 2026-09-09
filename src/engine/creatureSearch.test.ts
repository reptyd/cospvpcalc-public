import { describe, expect, it } from "vitest";
import { evaluateNode, type QueryNode, type SearchableCreature } from "./creatureSearch";
import type { CreatureRuntime, EffectsCatalogByCreature } from "./types";

function target(creature: Partial<CreatureRuntime>, isSubspecies = false): SearchableCreature {
  return {
    creature: { name: "x", stats: { tier: 1, health: 1, weight: 1, damage: 1, biteCooldown: 1 }, ...creature } as CreatureRuntime,
    effects: {} as EffectsCatalogByCreature,
    isSubspecies,
    subspeciesBase: isSubspecies ? "x" : null,
  };
}

const hasAdrenaline: QueryNode = {
  kind: "predicate",
  id: "p1",
  predicate: { kind: "ability", abilityKind: "passiveOrActivated", name: "Adrenaline", mode: "has" },
};

describe("creatureSearch passive/activated merge", () => {
  it("matches an ability whether the data files it under passive or activated", () => {
    // The same ability is filed differently per creature in the wiki data
    // (Adrenaline: activated for most, passive for Valkurse). One filter must
    // find both.
    const activated = target({ activatedAbilities: [{ abilityId: "Adrenaline", name: "Adrenaline", value: null, semantics: "neutral", subtype: null }] });
    const passive = target({ passiveAbilities: [{ abilityId: "Adrenaline", name: "Adrenaline", value: null, semantics: "neutral", subtype: null }] });
    const neither = target({ passiveAbilities: [{ abilityId: "Grab", name: "Grab", value: null, semantics: "neutral", subtype: null }] });

    expect(evaluateNode(activated, hasAdrenaline)).toBe(true);
    expect(evaluateNode(passive, hasAdrenaline)).toBe(true);
    expect(evaluateNode(neither, hasAdrenaline)).toBe(false);
  });

  it("'lacks' is the inverse across both lists", () => {
    const lacks: QueryNode = {
      kind: "predicate",
      id: "p2",
      predicate: { kind: "ability", abilityKind: "passiveOrActivated", name: "Adrenaline", mode: "lacks" },
    };
    const passive = target({ passiveAbilities: [{ abilityId: "Adrenaline", name: "Adrenaline", value: null, semantics: "neutral", subtype: null }] });
    expect(evaluateNode(passive, lacks)).toBe(false);
    expect(evaluateNode(target({}), lacks)).toBe(true);
  });
});

describe("subspecies as the Variant categorical field", () => {
  const sub = target({}, true);
  const base = target({}, false);
  const isSub: QueryNode = { kind: "predicate", id: "p", predicate: { kind: "stat-cat", field: "subspecies", op: "eq", value: "Subspecies" } };
  const notSub: QueryNode = { kind: "predicate", id: "p", predicate: { kind: "stat-cat", field: "subspecies", op: "neq", value: "Subspecies" } };

  it("'Variant is Subspecies' keeps subspecies, drops the rest", () => {
    expect(evaluateNode(sub, isSub)).toBe(true);
    expect(evaluateNode(base, isSub)).toBe(false);
  });

  it("'Variant is not Subspecies' drops subspecies, keeps the rest", () => {
    expect(evaluateNode(sub, notSub)).toBe(false);
    expect(evaluateNode(base, notSub)).toBe(true);
  });
});
