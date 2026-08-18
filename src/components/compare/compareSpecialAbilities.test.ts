import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMPARE_SPECIAL_ABILITIES,
  creatureHasAbility,
  defiledGroundActive,
  type CompareSpecialAbilityState,
} from "./compareSpecialAbilities";
import type { CreatureRuntime } from "../../engine/types";

const creature = (abilities: string[]): CreatureRuntime =>
  ({
    name: "Test",
    activatedAbilities: abilities.map((name) => ({ name })),
  }) as unknown as CreatureRuntime;

const withDefiledGround = (on: boolean): CompareSpecialAbilityState => ({
  ...DEFAULT_COMPARE_SPECIAL_ABILITIES,
  defiledGround: on,
});

describe("defiledGroundActive", () => {
  it("needs both the switch and the ability", () => {
    const owner = creature(["Defiled Ground"]);
    expect(defiledGroundActive(withDefiledGround(true), owner)).toBe(true);
    expect(defiledGroundActive(withDefiledGround(false), owner)).toBe(false);
    expect(defiledGroundActive(withDefiledGround(true), creature(["Volcanic"]))).toBe(false);
    expect(defiledGroundActive(withDefiledGround(true), undefined)).toBe(false);
  });

  it("is the one gate both halves of the ability read", () => {
    // The owner's bonus and the opponent's Sickly come from the same fact, so a
    // fight can never have one without the other.
    const abilities = withDefiledGround(true);
    const owner = creature(["Defiled Ground"]);
    const opponent = creature([]);

    expect(defiledGroundActive(abilities, owner)).toBe(true);
    expect(defiledGroundActive(abilities, opponent)).toBe(false);
  });
});

describe("creatureHasAbility", () => {
  it("reads passive, activated and breath lists alike", () => {
    const c = {
      name: "Test",
      passiveAbilities: [{ name: "Spite" }],
      activatedAbilities: [{ name: "Fortify" }],
      breathAbilities: [{ name: "Ice Breath" }],
    } as unknown as CreatureRuntime;

    expect(creatureHasAbility(c, "Spite")).toBe(true);
    expect(creatureHasAbility(c, "Fortify")).toBe(true);
    expect(creatureHasAbility(c, "Ice Breath")).toBe(true);
    expect(creatureHasAbility(c, "Rewind")).toBe(false);
    expect(creatureHasAbility(undefined, "Spite")).toBe(false);
  });
});
