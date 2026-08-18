import { describe, expect, it } from "vitest";
import { applyCompareSpecialAbilities, STRENGTH_IN_NUMBERS_MAX_ALLIES } from "./compareSpecialAbilityRuntime";
import { DEFAULT_COMPARE_SPECIAL_ABILITIES } from "../components/compare/compareSpecialAbilities";
import type { CreatureRuntime, FinalStats } from "./types";

// The stat side of the Compare special-ability toggles, one toggle at a time.
// Each toggle needs the ability as well as the switch, so every case here is
// paired with the same toggle on a creature that lacks it.

function stats(): FinalStats {
  return {
    name: "Probe",
    health: 1000,
    weight: 1000,
    damage: 100,
    biteCooldown: 2,
    healthRegen: 100,
    stamRegen: 100,
    walkAndSwimSpeed: 100,
    sprintSpeed: 100,
    hasBreath: false,
    breathType: null,
    appliedTraits: [],
  } as unknown as FinalStats;
}

function creatureWith(...abilities: string[]): CreatureRuntime {
  return {
    name: "Probe",
    stats: {} as CreatureRuntime["stats"],
    passiveAbilities: abilities.map((name) => ({
      abilityId: name.replace(/\s+/g, "_"),
      name,
      value: null,
      semantics: "neutral",
      subtype: null,
    })),
  };
}

const OFF = DEFAULT_COMPARE_SPECIAL_ABILITIES;

describe("Compare special abilities", () => {
  it("Volcanic gives half again on health regeneration and nothing else [REF:compare_volcanic]", () => {
    const carrier = creatureWith("Volcanic");
    const on = applyCompareSpecialAbilities(stats(), carrier, { ...OFF, volcanic: true });
    expect(on.healthRegen).toBeCloseTo(150, 6);
    // "and nothing else" - the entry says the toggle is the stat side only.
    expect(on.damage).toBeCloseTo(100, 6);
    expect(on.weight).toBeCloseTo(1000, 6);
    expect(on.health).toBeCloseTo(1000, 6);
    expect(on.stamRegen).toBeCloseTo(100, 6);

    const off = applyCompareSpecialAbilities(stats(), carrier, OFF);
    expect(off.healthRegen).toBeCloseTo(100, 6);

    // The toggle assumes the condition, it does not hand out the ability.
    const stranger = applyCompareSpecialAbilities(stats(), creatureWith(), { ...OFF, volcanic: true });
    expect(stranger.healthRegen).toBeCloseTo(100, 6);
  });

  it("Frosty gives a quarter more health regeneration and nothing else [REF:compare_frosty]", () => {
    const carrier = creatureWith("Frosty");
    const on = applyCompareSpecialAbilities(stats(), carrier, { ...OFF, frosty: true });
    expect(on.healthRegen).toBeCloseTo(125, 6);
    expect(on.damage).toBeCloseTo(100, 6);
    expect(on.weight).toBeCloseTo(1000, 6);
    expect(on.health).toBeCloseTo(1000, 6);

    const off = applyCompareSpecialAbilities(stats(), carrier, OFF);
    expect(off.healthRegen).toBeCloseTo(100, 6);

    const stranger = applyCompareSpecialAbilities(stats(), creatureWith(), { ...OFF, frosty: true });
    expect(stranger.healthRegen).toBeCloseTo(100, 6);
  });

  it("Frosty also reaches a creature a plushie granted it to [REF:compare_frosty]", () => {
    const granted = {
      ...stats(),
      plushieGrantedOtherAbilities: [{ name: "Frosty", value: null, semantics: "neutral" }],
    } as FinalStats;
    const on = applyCompareSpecialAbilities(granted, creatureWith(), { ...OFF, frosty: true });
    expect(on.healthRegen).toBeCloseTo(125, 6);
  });

  it("Strength In Numbers adds per ally, up to nine [REF:compare_strength_in_numbers]", () => {
    const carrier = creatureWith("Strength In Numbers");
    const withAllies = (allies: number) =>
      applyCompareSpecialAbilities(stats(), carrier, {
        ...OFF,
        strengthInNumbers: true,
        strengthInNumbersAllies: allies,
      });

    expect(withAllies(0).damage).toBeCloseTo(100, 6);
    expect(withAllies(1).damage).toBeCloseTo(101.5, 6);
    expect(withAllies(4).damage).toBeCloseTo(106, 6);
    expect(withAllies(STRENGTH_IN_NUMBERS_MAX_ALLIES).damage).toBeCloseTo(113.5, 6);

    // Nine is the ceiling the entry states, so a tenth ally adds nothing.
    expect(withAllies(20).damage).toBeCloseTo(withAllies(STRENGTH_IN_NUMBERS_MAX_ALLIES).damage ?? 0, 6);

    // Damage only - the entry says the stamina side is not modeled here.
    expect(withAllies(9).stamRegen).toBeCloseTo(100, 6);

    const stranger = applyCompareSpecialAbilities(stats(), creatureWith(), {
      ...OFF,
      strengthInNumbers: true,
      strengthInNumbersAllies: 9,
    });
    expect(stranger.damage).toBeCloseTo(100, 6);
  });
});
