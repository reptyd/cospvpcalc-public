import { describe, expect, it } from "vitest";
import type { BuildOptions, CreatureRuntime } from "../engine/types";
import { SPEED_EFFECTS } from "./speedEffects";
import { evaluateSpeed, offeredEffects } from "./speedMath";

const flier: CreatureRuntime = {
  name: "Test Flier",
  stats: {
    tier: 3,
    health: 1000,
    weight: 1000,
    damage: 100,
    biteCooldown: 1,
    healthRegen: 10,
    stamina: 100,
    stamRegen: 3,
    walkAndSwimSpeed: 30,
    sprintSpeed: 100,
    turn: 2,
    venerationRate: 1,
    diet: "Carnivore",
    type: "Flier",
    breath: "N/A",
    appetite: 50,
    flySpeed: 60,
    flySprintMultiplier: 1.5,
    glideStaminaRegen: 2,
    takeoffMultiplier: 4,
  } as CreatureRuntime["stats"],
  passiveAbilities: [{ abilityId: "Agile_Swimmer", name: "Agile Swimmer", value: 60, semantics: "neutral", subtype: null }],
  activatedAbilities: [{ abilityId: "Speed_Blitz", name: "Speed Blitz", value: null, semantics: "neutral", subtype: null }],
  breathAbilities: [],
};

/** The 184 creatures that carry an ambush multiplier run 1.2 to 1.75, and 86%
 * of them sit at 1.3 or below. */
const ambusher: CreatureRuntime = { ...flier, stats: { ...flier.stats, ambush: 1.3 } };

const bare: BuildOptions = {
  venerationStage: 0,
  traits: [],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [],
  elder: "None",
};

describe("speed evaluation", () => {
  it("leaves a bare build at the creature's own numbers", () => {
    const { base, final } = evaluateSpeed({ creature: flier, build: bare });
    expect(final.speed).toBe(base.speed);
    expect(final.sprint).toBe(base.sprint);
    // flySprintMultiplier is stored as the bonus, so 1.5 means x2.5.
    expect(final.flySprint).toBeCloseTo(60 * 2.5, 10);
  });

  it("reports channels the creature does not have as null", () => {
    const grounded: CreatureRuntime = { ...flier, stats: { ...flier.stats, flySpeed: undefined, beachSpeed: undefined } };
    const { final } = evaluateSpeed({ creature: grounded, build: bare });
    expect(final.fly).toBeNull();
    expect(final.flySprint).toBeNull();
    expect(final.beached).toBeNull();
  });

  it("takes the Speed trait to +11% at full ascension", () => {
    const build: BuildOptions = { ...bare, venerationStage: 5, traits: ["Speed"] };
    const { final } = evaluateSpeed({ creature: flier, build });
    expect(final.sprint).toBeCloseTo(100 * 1.11, 10);
    expect(final.fly).toBeCloseTo(60 * 1.11, 10);
  });

  it("splits ascension between two slotted traits", () => {
    const build: BuildOptions = {
      ...bare,
      venerationStage: 5,
      traits: ["Speed", "Damage"],
      ascensionAssignments: ["Speed", "Speed", "Damage", "Damage", "Damage"],
    };
    const { final } = evaluateSpeed({ creature: flier, build });
    expect(final.sprint).toBeCloseTo(100 * (1.035 + 2 * 0.015), 10);
  });

  it("stacks plushies multiplicatively and adds Sky's flat bonus last", () => {
    const build: BuildOptions = { ...bare, plushies: ["Chick", "Sky"] };
    const { final } = evaluateSpeed({ creature: flier, build });
    expect(final.fly).toBeCloseTo(60 * 1.05 + 2, 10);
    // Sky touches nothing but fly speed.
    expect(final.sprint).toBeCloseTo(100 * 1.05, 10);
  });

  it("spreads the elder's speed bonus over every movement channel", () => {
    const { final } = evaluateSpeed({ creature: flier, build: { ...bare, elder: "Devious" } });
    expect(final.speed).toBeCloseTo(30 * 1.075, 10);
    expect(final.sprint).toBeCloseTo(100 * 1.075, 10);
    expect(final.fly).toBeCloseTo(60 * 1.075, 10);
  });

  it("leaves speed alone for an elder that does not touch it", () => {
    const { final } = evaluateSpeed({ creature: flier, build: { ...bare, elder: "Gentle" } });
    expect(final.sprint).toBe(100);
  });

  it("applies a doubled plushie twice", () => {
    const { final } = evaluateSpeed({ creature: flier, build: { ...bare, plushies: ["Chick", "Chick"] } });
    expect(final.sprint).toBeCloseTo(100 * 1.05 ** 2, 10);
  });

  it("refuses to double a unique plushie", () => {
    const { final } = evaluateSpeed({ creature: flier, build: { ...bare, plushies: ["Knox", "Knox"] } });
    expect(final.speed).toBeCloseTo(30 * 1.05, 10);
  });

  it("refuses to double a plushie the roster will not let you hold twice", () => {
    const { final } = evaluateSpeed({ creature: flier, build: { ...bare, plushies: ["Mylo", "Mylo"] } });
    expect(final.sprint).toBeCloseTo(100 * 1.025, 10);
  });

  it("applies Knox to walking only [REF:plushie_knox]", () => {
    const { final } = evaluateSpeed({ creature: flier, build: { ...bare, plushies: ["Knox"] } });
    expect(final.speed).toBeCloseTo(30 * 1.05, 10);
    expect(final.sprint).toBe(100);
  });

  it("scales Agile Swimmer off the creature's own value", () => {
    const { final } = evaluateSpeed({ creature: flier, build: bare, active: ["agile_swimmer"] });
    expect(final.speed).toBeCloseTo(30 * 1.6, 10);
    expect(final.fly).toBe(60);
  });

  it("gives Cower a further 10% with Bear", () => {
    const plain = evaluateSpeed({ creature: flier, build: bare, active: ["posture_cower"] });
    const withBear = evaluateSpeed({ creature: flier, build: { ...bare, plushies: ["Bear"] }, active: ["posture_cower"] });
    expect(plain.final.sprint).toBeCloseTo(100 * 1.25, 10);
    expect(withBear.final.sprint).toBeCloseTo(100 * 1.375, 10);
  });

  it("ramps Gourmandizer with appetite fill", () => {
    const glutton: CreatureRuntime = {
      ...flier,
      passiveAbilities: [
        ...(flier.passiveAbilities ?? []),
        { abilityId: "Gourmandizer", name: "Gourmandizer", value: null, semantics: "neutral", subtype: null },
      ],
    };
    const full = evaluateSpeed({ creature: glutton, build: bare, active: ["gourmandizer"], fillPct: 100 });
    const half = evaluateSpeed({ creature: glutton, build: bare, active: ["gourmandizer"], fillPct: 112.5 });
    const stuffed = evaluateSpeed({ creature: glutton, build: bare, active: ["gourmandizer"], fillPct: 125 });
    expect(full.final.sprint).toBe(100);
    expect(half.final.sprint).toBeCloseTo(100 * 0.9625, 10);
    expect(stuffed.final.sprint).toBeCloseTo(100 * 0.925, 10);
  });

  it("pays Momo out on sight, to everything that eats a plant", () => {
    const build: BuildOptions = { ...bare, plushies: ["Momo"] };
    const withDiet = (diet: string) =>
      evaluateSpeed({ creature: { ...flier, stats: { ...flier.stats, diet } }, build }).final.fly;

    for (const diet of ["Herbivore", "Omnivore", "Photovore"]) {
      expect(withDiet(diet), diet).toBe(61);
    }
    for (const diet of ["Carnivore", "Photocarnivore"]) {
      expect(withDiet(diet), diet).toBe(60);
    }
  });

  it("pays the weekly Speed boost differently to walking and sprinting", () => {
    const { final } = evaluateSpeed({ creature: flier, build: bare, active: ["creature_speed_boost"] });
    expect(final.speed).toBeCloseTo(30 * 1.1, 10);
    expect(final.sprint).toBeCloseTo(100 * 1.05, 10);
    expect(final.fly).toBe(60);
  });

  it("only offers effects the creature owns", () => {
    const offered = offeredEffects(flier, bare).map((e) => e.id);
    expect(offered).toContain("speed_blitz");
    expect(offered).toContain("agile_swimmer");
    expect(offered).toContain("posture_cower");
    expect(offered).not.toContain("posture_hunker");
    expect(offered).not.toContain("harden");
    // Amped reads as weather but is not: a thunderstorm only Amps a creature
    // carrying Overcharged, so offering it to the rest is a switch that turns
    // on something they cannot have.
    expect(offered).not.toContain("amped");
  });

  it("marks as lasting only the effects a fight cannot outlast", () => {
    const byId = Object.fromEntries(SPEED_EFFECTS.map((effect) => [effect.id, effect]));
    // These hold while their condition does - a week of boost, the weather, a
    // school swimming beside you - so a fight never sees one lapse.
    expect(byId.creature_speed_boost.lasting).toBe(true);
    expect(byId.windstorm.lasting).toBe(true);
    expect(byId.sea_school.lasting).toBe(true);
    // A passive holds while the creature is in the water it swims in.
    expect(byId.agile_swimmer.lasting).toBe(true);
    // Everything else runs on a timer or ends when the player moves.
    expect(byId.amped.lasting).toBeUndefined();
    expect(byId.speed_blitz.lasting).toBeUndefined();
    expect(byId.posture_cower.lasting).toBeUndefined();
  });

  it("slows every channel while Guardian's Passage is channeling", () => {
    const inkpujin: CreatureRuntime = {
      ...flier,
      activatedAbilities: [
        { abilityId: "Guardians_Passage", name: "Guardians Passage", value: null, semantics: "neutral", subtype: null },
      ],
    };
    expect(offeredEffects(flier, bare).map((e) => e.id)).not.toContain("guardians_passage_channel");

    const bareRun = evaluateSpeed({ creature: inkpujin, build: bare });
    const channeling = evaluateSpeed({ creature: inkpujin, build: bare, active: ["guardians_passage_channel"] });
    // A tenth of each, and no channel escapes it - the game's own targets name
    // swim sprint alongside the rest.
    expect(channeling.final.speed).toBeCloseTo((bareRun.final.speed ?? 0) * 0.1, 10);
    expect(channeling.final.sprint).toBeCloseTo((bareRun.final.sprint ?? 0) * 0.1, 10);
    expect(channeling.final.fly).toBeCloseTo((bareRun.final.fly ?? 0) * 0.1, 10);
  });

  it("offers Amped to a creature with Overcharged", () => {
    const charged: CreatureRuntime = {
      ...flier,
      passiveAbilities: [{ abilityId: "Overcharged", name: "Overcharged", value: null, semantics: "neutral", subtype: null }],
    };
    expect(offeredEffects(charged, bare).map((e) => e.id)).toContain("amped");
  });

  it("gives Sea School per packmate, and only to a low-tier swimmer", () => {
    const swimmer: CreatureRuntime = { ...flier, stats: { ...flier.stats, tier: 2, type: "Semi-Aquatic" } };
    const alone = evaluateSpeed({ creature: swimmer, build: bare, active: ["sea_school"], packmates: 0 });
    const paired = evaluateSpeed({ creature: swimmer, build: bare, active: ["sea_school"], packmates: 2 });
    const full = evaluateSpeed({ creature: swimmer, build: bare, active: ["sea_school"], packmates: 6 });
    const overfull = evaluateSpeed({ creature: swimmer, build: bare, active: ["sea_school"], packmates: 9 });
    expect(alone.final.sprint).toBe(100);
    expect(paired.final.sprint).toBeCloseTo(100 * 1.1, 10);
    expect(full.final.sprint).toBeCloseTo(100 * 1.3, 10);
    expect(overfull.final.sprint).toBeCloseTo(100 * 1.3, 10);
    // It never touches flight, whatever the count.
    expect(full.final.fly).toBe(60);

    // A tier 3 swimmer is outside the ailment, a tier 2 land creature outside
    // the realm that carries it.
    const bigSwimmer: CreatureRuntime = { ...swimmer, stats: { ...swimmer.stats, tier: 3 } };
    const walker: CreatureRuntime = { ...swimmer, stats: { ...swimmer.stats, type: "Terrestrial" } };
    for (const creature of [bigSwimmer, walker]) {
      expect(evaluateSpeed({ creature, build: bare, active: ["sea_school"], packmates: 6 }).final.sprint).toBe(100);
    }
  });

  it("does not offer an effect that cannot move a number", () => {
    const offered = offeredEffects(flier, bare).map((e) => e.id);
    // The test flier is a tier 3 land creature, so Sea School can never reach it.
    expect(offered).not.toContain("sea_school");
    const swimmer: CreatureRuntime = { ...flier, stats: { ...flier.stats, tier: 2, type: "Aquatic" } };
    expect(offeredEffects(swimmer, bare).map((e) => e.id)).toContain("sea_school");
    // Gourmandizer resolves to nothing at a full appetite, but the fill control
    // reaches 125, so it stays on offer.
    const glutton: CreatureRuntime = {
      ...flier,
      passiveAbilities: [
        ...(flier.passiveAbilities ?? []),
        { abilityId: "Gourmandizer", name: "Gourmandizer", value: null, semantics: "neutral", subtype: null },
      ],
    };
    expect(offeredEffects(glutton, bare).map((e) => e.id)).toContain("gourmandizer");
  });


  it("reads ambush as sprint times the creature's multiplier [REF:speed_ambush]", () => {
    const { base, final } = evaluateSpeed({ creature: ambusher, build: bare });
    expect(base.ambush).toBeCloseTo(100 * 1.3, 10);
    expect(final.ambush).toBeCloseTo(100 * 1.3, 10);
  });

  it("carries a sprint buff into ambush", () => {
    const { final } = evaluateSpeed({ creature: ambusher, build: { ...bare, plushies: ["Chick"] } });
    expect(final.sprint).toBeCloseTo(100 * 1.05, 10);
    expect(final.ambush).toBeCloseTo(100 * 1.05 * 1.3, 10);
  });

  it("reports no ambush for a creature without the multiplier", () => {
    const { final } = evaluateSpeed({ creature: flier, build: { ...bare, plushies: ["Bunny"] } });
    expect(final.ambushFactor).toBeNull();
    expect(final.ambush).toBeNull();
  });

  it("lifts the ambush multiplier with Bunny, and nothing else [REF:plushie_bunny]", () => {
    const { final } = evaluateSpeed({ creature: ambusher, build: { ...bare, plushies: ["Bunny"] } });
    expect(final.sprint).toBe(100);
    expect(final.speed).toBe(30);
    expect(final.ambush).toBeCloseTo(100 * 1.3 * 1.075, 10);
  });

  it("applies a doubled Bunny twice", () => {
    const { final } = evaluateSpeed({ creature: ambusher, build: { ...bare, plushies: ["Bunny", "Bunny"] } });
    expect(final.ambush).toBeCloseTo(100 * 1.3 * 1.075 ** 2, 10);
  });

  it("ignores a plushie effect whose plushie is not equipped", () => {
    const { contributions } = evaluateSpeed({ creature: flier, build: bare });
    expect(contributions).toHaveLength(0);
  });
});
