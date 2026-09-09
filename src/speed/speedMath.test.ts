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

  it("applies Momo to every diet that eats plants and to no other", () => {
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

  it("multiplies Walk / Swim by 1.1 and Sprint by 1.05 for the weekly Speed boost, and does not touch Fly", () => {
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

  it("carries the slows an opponent lands and offers none of them", () => {
    const byId = Object.fromEntries(SPEED_EFFECTS.map((effect) => [effect.id, effect]));
    const hostile = [
      "hostile_freeze",
      "hostile_sticky_trap",
      "hostile_torn_ligaments",
      "hostile_inked",
      "hostile_injury",
      "hostile_gale",
      "hostile_stolen_speed",
      "hostile_slowed",
    ];
    for (const id of hostile) {
      expect(byId[id], id).toBeDefined();
      expect(byId[id].hostile, id).toBe(true);
    }
    // A build cannot equip an enemy's ability, so the picker shows none of them.
    const offered = offeredEffects(flier, bare).map((effect) => effect.id);
    for (const id of hostile) {
      expect(offered, id).not.toContain(id);
    }
    // Cause Fear lands the same way and is offered, because on speed it is a
    // buff rather than a slow.
    expect(byId.fear.hostile).toBeUndefined();
  });

  // The seven that have an entry of their own carry their movement side there,
  // so the figures in those entries are the figures asserted here.
  // [REF:status_freeze] [REF:status_gale] [REF:status_slowed]
  // [REF:status_sticky_trap] [REF:status_stolen_speed]
  // [REF:status_torn_ligaments] [REF:status_injury]
  it("multiplies by the figure each entry states", () => {
    const byId = Object.fromEntries(SPEED_EFFECTS.map((effect) => [effect.id, effect]));
    const ctx = {
      tier: 3, packmates: 0, abilityValue: () => null, traitAscension: () => null, sameSpeciesPackmates: 0, diet: "carnivore", fillPct: 100, hasBear: false, eatsHerbivoreFood: false, leavesTheGround: false,
      isAquatic: false,
    };
    const factor = (id: string, channel: string) => {
      const op = (byId[id].resolve(ctx) as Record<string, { kind: string; value: number }>)[channel];
      expect(op?.kind, `${id}.${channel}`).toBe("multiply");
      return op.value;
    };
    expect(factor("hostile_freeze", "speed")).toBe(0.25);
    expect(factor("hostile_sticky_trap", "beached")).toBe(0.25);
    expect(factor("hostile_torn_ligaments", "speed")).toBe(0.5);
    expect(factor("hostile_injury", "fly")).toBe(0.75);
    expect(factor("hostile_gale", "sprint")).toBe(0.8);
    expect(factor("hostile_stolen_speed", "sprint")).toBe(0.8);
    expect(factor("hostile_slowed", "speed")).toBe(0.85);
  });

  it("gives each landed slow the channels its own targets name", () => {
    const byId = Object.fromEntries(SPEED_EFFECTS.map((effect) => [effect.id, effect]));
    // The channel sets are constants, so any context reads them.
    const ctx = {
      tier: 3, packmates: 0, abilityValue: () => null, traitAscension: () => null, sameSpeciesPackmates: 0, diet: "carnivore", fillPct: 100, hasBear: false, eatsHerbivoreFood: false, leavesTheGround: false,
      isAquatic: false,
    };

    // The movement side of each, which is what this test is about: an effect
    // may name stamina channels too, and those are a readout of their own.
    const movement = (id: string) =>
      Object.keys(byId[id].resolve(ctx))
        .filter((channel) => !["stamina", "staminaRegen", "glideRegen"].includes(channel))
        .sort();

    // Walk and swim alone: its other targets are stamina channels.
    expect(movement("hostile_torn_ligaments")).toEqual(["speed"]);
    // Flight is not among Inked's targets.
    expect(movement("hostile_inked")).toEqual(["speed", "sprint"]);
    // The three that name BeachedSpeed reach a beached aquatic; the rest do not.
    expect(movement("hostile_injury")).toEqual(["beached", "fly", "speed", "sprint"]);
    expect(movement("hostile_slowed")).toEqual(["fly", "speed", "sprint"]);
  });

  it("folds stamina off the same effects and only when a base is given", () => {
    const charged = { ...flier, activatedAbilities: [
      { abilityId: "Speed_Blitz", name: "Speed Blitz", value: null, semantics: "neutral" as const, subtype: null },
    ] };
    // No base, no stamina: a caller that wants speeds gets null rather than a
    // figure computed from a pool nobody supplied.
    const speedsOnly = evaluateSpeed({ creature: charged, build: bare, active: ["speed_blitz"] }).final;
    expect(speedsOnly.stamina).toBeNull();
    expect(speedsOnly.staminaRegen).toBeNull();

    // With one, the same contribution that lifted the speed lifts the rate.
    const withPool = evaluateSpeed({
      creature: charged, build: bare, active: ["speed_blitz"],
      staminaBase: { stamina: 100, staminaRegen: 10 },
    }).final;
    expect(withPool.stamina).toBe(100);
    expect(withPool.staminaRegen).toBeCloseTo(13, 10);

    // And Adrenaline raises the speed while taking the stamina rate to zero.
    const adrenal = { ...flier, activatedAbilities: [
      { abilityId: "Adrenaline", name: "Adrenaline", value: null, semantics: "neutral" as const, subtype: null },
    ] };
    const raging = evaluateSpeed({
      creature: adrenal, build: bare, active: ["adrenaline"],
      staminaBase: { stamina: 100, staminaRegen: 10 },
    }).final;
    expect(raging.staminaRegen).toBe(0);
    expect(raging.speed).toBeGreaterThan(withPool.speed! / 1.25 * 1.19);
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
    // A slow can hold the same way: Hunker lasts as long as the creature keeps
    // strafing, so its 25% is what the creature moves at throughout.
    expect(byId.posture_hunker.lasting).toBe(true);
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
