import { describe, expect, it } from "vitest";
import type { BuildOptions, CreatureRuntime, CreatureStats } from "../engine/types";
import { STAMINA_CHANNELS, type StaminaChannel, type SpeedReadout } from "./speedChannels";
import { evaluateSpeed, offeredEffects } from "./speedMath";

// The stamina claims of the Reference, one claim per test, against the code that
// computes the figure. The movement half lives in referenceMovement.test.ts; the
// split follows the two channel lists rather than the two files being a
// convenience.
//
// Every expected number is written out here for the same reason it is there:
// reading it off the entry would make the check agree with the sentence by
// construction.

/** A pool and a rate that share no digits with each other or with the glide
 * rate, so a factor landing on one channel can never be read off another. */
const PROBE: CreatureStats = {
  tier: 2,
  health: 1000,
  weight: 100,
  damage: 100,
  biteCooldown: 1,
  healthRegen: 0,
  walkAndSwimSpeed: 40,
  sprintSpeed: 100,
  flySpeed: 60,
  stamina: 200,
  stamRegen: 4,
  glideStaminaRegen: 7,
  takeoffMultiplier: 20,
  diet: "Carnivore",
  type: "Semi-Aquatic",
};

function probe(abilities: string[] = [], overrides: Partial<CreatureStats> = {}): CreatureRuntime {
  return {
    name: "Stamina probe",
    stats: { ...PROBE, ...overrides },
    passiveAbilities: abilities.map((name) => ({
      abilityId: name.replace(/[^A-Za-z0-9]+/g, "_"),
      name,
      value: null,
      semantics: "neutral",
      subtype: null,
    })),
    activatedAbilities: [],
    breathAbilities: [],
  };
}

const BARE: BuildOptions = {
  venerationStage: 0,
  traits: [],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [],
  elder: "None",
};

const STAMINA_BASE = { stamina: PROBE.stamina, staminaRegen: PROBE.stamRegen };

type Held = {
  creature?: CreatureRuntime;
  build?: Partial<BuildOptions>;
  active?: string[];
  packmates?: number;
  sameSpeciesPackmates?: number;
};

function held({
  creature = probe(),
  build = {},
  active = [],
  packmates = 0,
  sameSpeciesPackmates = 0,
}: Held = {}): SpeedReadout {
  return evaluateSpeed({
    creature,
    build: { ...BARE, ...build },
    active,
    packmates,
    sameSpeciesPackmates,
    staminaBase: STAMINA_BASE,
  }).final;
}

const ids = (creature: CreatureRuntime) => offeredEffects(creature, BARE).map((effect) => effect.id);

/** All three stamina channels at once. Asserting the whole row turns a claim
 * about one into a claim that the effect left the other two alone. */
function row(readout: SpeedReadout): Record<StaminaChannel, number | null> {
  const out = {} as Record<StaminaChannel, number | null>;
  for (const channel of STAMINA_CHANNELS) {
    const value = readout[channel];
    out[channel] = value === null ? null : Math.round(value * 1e6) / 1e6;
  }
  return out;
}

const UNTOUCHED = { stamina: 200, staminaRegen: 4, glideRegen: 7, takeoff: 20 };

describe("the plushies that move a pool or a rate", () => {
  it("raises the stamina rate by 25% for Eclipse, at night [REF:plushie_eclipse]", () => {
    expect(row(held({ build: { plushies: ["Eclipse"] }, active: ["night_time"] }))).toEqual({ stamina: 200, staminaRegen: 5, glideRegen: 7, takeoff: 20 });
  });

  it("leaves every stamina channel untouched for Eclipse by day [REF:plushie_eclipse]", () => {
    expect(row(held({ build: { plushies: ["Eclipse"] } }))).toEqual(UNTOUCHED);
  });

  it("adds 0.5 to the gliding rate for Reindeer, additively [REF:plushie_reindeer]", () => {
    expect(row(held({ build: { plushies: ["Reindeer"] } }))).toEqual({ stamina: 200, staminaRegen: 4, glideRegen: 7.5, takeoff: 20 });
  });
});

describe("the abilities that move a pool or a rate", () => {
  const withAbility = (name: string, id: string) => row(held({ creature: probe([name]), active: [id] }));

  it("multiplies the stamina rate by 1.3 for Speed Blitz [REF:ability_speed_blitz]", () => {
    expect(withAbility("Speed Blitz", "speed_blitz")).toEqual({ stamina: 200, staminaRegen: 5.2, glideRegen: 7, takeoff: 20 });
  });

  it("holds both rates at zero for Adrenaline [REF:ability_adrenaline]", () => {
    expect(withAbility("Adrenaline", "adrenaline")).toEqual({ stamina: 200, staminaRegen: 0, glideRegen: 0, takeoff: 20 });
  });

  it("holds both rates at zero for Unbridled Rage [REF:ability_unbridled_rage]", () => {
    expect(withAbility("Unbridled Rage", "unbridled_rage")).toEqual({ stamina: 200, staminaRegen: 0, glideRegen: 0, takeoff: 20 });
  });

  it("multiplies the pool by 1.5 and the stamina rate by 2 for Agile Swimmer [REF:ability_agile_swimmer]", () => {
    expect(withAbility("Agile Swimmer", "agile_swimmer")).toEqual({ stamina: 300, staminaRegen: 8, glideRegen: 7, takeoff: 20 });
  });

  it("multiplies the stamina rate by 2 for Berserk [REF:ability_berserk]", () => {
    expect(withAbility("Berserk", "berserk")).toEqual({ stamina: 200, staminaRegen: 8, glideRegen: 7, takeoff: 20 });
  });

  it("multiplies the stamina rate by 2 for Warden's Rage [REF:ability_wardens_rage]", () => {
    expect(withAbility("Warden's Rage", "wardens_rage")).toEqual({ stamina: 200, staminaRegen: 8, glideRegen: 7, takeoff: 20 });
  });

  it("multiplies the stamina rate by 3 for a Stamina Puddle [REF:ability_stamina_puddle]", () => {
    expect(withAbility("Stamina Puddle", "stamina_puddle")).toEqual({ stamina: 200, staminaRegen: 12, glideRegen: 7, takeoff: 20 });
  });

  it("multiplies the stamina rate by 1.25 for Frosty [REF:compare_frosty]", () => {
    expect(withAbility("Frosty", "frosty")).toEqual({ stamina: 200, staminaRegen: 5, glideRegen: 7, takeoff: 20 });
  });

  it("reaches Frosty through a Minty Wiggler as well as through the passive [REF:compare_frosty]", () => {
    const viaPlushie = row(held({ build: { plushies: ["Minty Wiggler"] }, active: ["frosty"] }));
    expect(viaPlushie.staminaRegen).toBe(5);
    expect(row(held({ active: ["frosty"] }))).toEqual(UNTOUCHED);
  });
});

describe("the movement slows that also cost a rate", () => {
  it("multiplies the stamina rate by 0.8 for Stolen Speed [REF:status_stolen_speed]", () => {
    expect(row(held({ active: ["hostile_stolen_speed"] }))).toEqual({
      stamina: 200,
      staminaRegen: 3.2,
      glideRegen: 7,
      takeoff: 20,
    });
  });

  it("takes a tenth off both rates for Torn Ligaments [REF:status_torn_ligaments]", () => {
    expect(row(held({ active: ["hostile_torn_ligaments"] }))).toEqual({
      stamina: 200,
      staminaRegen: 3.6,
      glideRegen: 6.3,
      takeoff: 20,
    });
  });
});

describe("the whole stamina readout", () => {
  it("returns null on every stamina channel when no base is supplied", () => {
    const speedsOnly = evaluateSpeed({ creature: probe(), build: BARE, active: [] }).final;
    expect(row(speedsOnly)).toEqual({ stamina: null, staminaRegen: null, glideRegen: null, takeoff: null });
  });
});

describe("weather, water and the pack", () => {
  it("raises both rates by 25% for Violent Winds [REF:speed_effect_violent_winds]", () => {
    expect(row(held({ active: ["violent_winds"] }))).toEqual({ stamina: 200, staminaRegen: 5, glideRegen: 8.75, takeoff: 20 });
  });

  it("very nearly stops both rates for Hypothermia [REF:status_hypothermia]", () => {
    expect(row(held({ active: ["hypothermia"] }))).toEqual({ stamina: 200, staminaRegen: 0.08, glideRegen: 0.14, takeoff: 20 });
  });

  it("lowers the stamina rate by 20% for Ashy Lungs [REF:status_ashy_lungs]", () => {
    expect(row(held({ active: ["ashy_lungs"] }))).toEqual({ stamina: 200, staminaRegen: 3.2, glideRegen: 7, takeoff: 20 });
  });

  it("raises the pool and the stamina rate by 25% each for Enriched [REF:speed_effect_enriched]", () => {
    expect(row(held({ active: ["enriched"] }))).toEqual({ stamina: 250, staminaRegen: 5, glideRegen: 7, takeoff: 20 });
  });

  it("raises the stamina rate by 20% for Clean Water [REF:status_clean_water]", () => {
    expect(row(held({ active: ["clean_water"] }))).toEqual({ stamina: 200, staminaRegen: 4.8, glideRegen: 7, takeoff: 20 });
  });

  it("raises the stamina rate by 10% for Pack Migration [REF:speed_effect_pack_migration]", () => {
    expect(row(held({ active: ["pack_migration"] }))).toEqual({ stamina: 200, staminaRegen: 4.4, glideRegen: 7, takeoff: 20 });
  });

  it("raises the stamina rate by 50% for either moon phase [REF:compare_moon]", () => {
    for (const id of ["blood_moon", "blue_moon"]) {
      expect(row(held({ active: [id] })), id).toEqual({ stamina: 200, staminaRegen: 6, glideRegen: 7, takeoff: 20 });
    }
  });
});

describe("the two diets the day and night statuses reach", () => {
  const photo = (diet: string) => probe([], { diet });

  it("reaches a photovore and a photocarnivore and nobody else [REF:compare_day_night]", () => {
    for (const diet of ["Photovore", "Photocarnivore"]) {
      expect(row(held({ creature: photo(diet), active: ["day_time"] })).staminaRegen, diet).toBe(5);
      expect(row(held({ creature: photo(diet), active: ["night_time"] })).staminaRegen, diet).toBe(3);
    }
    for (const diet of ["Carnivore", "Herbivore", "Omnivore"]) {
      expect(row(held({ creature: photo(diet), active: ["day_time"] })), diet).toEqual(UNTOUCHED);
      expect(row(held({ creature: photo(diet), active: ["night_time"] })), diet).toEqual(UNTOUCHED);
    }
  });

  it("raises the pool by 25% for a photovore drinking spring water, and nobody else [REF:status_spring_water]", () => {
    expect(row(held({ creature: photo("Photovore"), active: ["spring_water"] }))).toEqual({
      stamina: 250,
      staminaRegen: 4,
      glideRegen: 7,
      takeoff: 20,
    });
    expect(row(held({ creature: photo("Photocarnivore"), active: ["spring_water"] }))).toEqual(UNTOUCHED);
  });
});

describe("the states and abilities that cost a rate", () => {
  it("halves the stamina rate for Aggressive, and Bear lifts the whole term [REF:status_aggressive]", () => {
    expect(row(held({ active: ["posture_aggressive"] }))).toEqual({ stamina: 200, staminaRegen: 2, glideRegen: 7, takeoff: 20 });
    const withBear = held({ build: { plushies: ["Bear"] }, active: ["posture_aggressive"] });
    expect(row(withBear).staminaRegen).toBeCloseTo(2.2, 6);
  });

  it("halves the stamina rate for the Aftershock Earthquake leaves on its user [REF:status_aftershock]", () => {
    expect(row(held({ creature: probe(["Earthquake"]), active: ["aftershock"] }))).toEqual({
      stamina: 200,
      staminaRegen: 2,
      glideRegen: 7,
      takeoff: 20,
    });
    expect(ids(probe())).not.toContain("aftershock");
  });

  it("adds 7% a same-species packmate and stops at nine [REF:compare_strength_in_numbers]", () => {
    const kin = probe(["Strength In Numbers"]);
    const rates = [0, 1, 3, 5, 9].map(
      (sameSpeciesPackmates) => row(held({ creature: kin, active: ["strength_in_numbers"], sameSpeciesPackmates })).staminaRegen,
    );
    expect(rates).toEqual([4, 4.28, 4.84, 5.4, 6.52]);
  });
});

describe("the rates an opponent lands", () => {
  it("lowers the stamina rate by 20% for Sickly, which is also Defiled Sickly [REF:status_sickly]", () => {
    expect(row(held({ active: ["hostile_sickly"] }))).toEqual({ stamina: 200, staminaRegen: 3.2, glideRegen: 7, takeoff: 20 });
  });

  it("lowers the stamina rate by 25% for Frostbite [REF:status_frostbite]", () => {
    expect(row(held({ active: ["hostile_frostbite"] }))).toEqual({ stamina: 200, staminaRegen: 3, glideRegen: 7, takeoff: 20 });
  });

  it("takes a percentage point off the stamina rate for one Poison stack [REF:status_poison]", () => {
    expect(row(held({ active: ["hostile_poison"] }))).toEqual({ stamina: 200, staminaRegen: 3.96, glideRegen: 7, takeoff: 20 });
  });

  it("offers none of the four an opponent lands", () => {
    for (const id of ["hostile_sickly", "hostile_frostbite", "hostile_poison", "hostile_stolen_speed"]) {
      expect(ids(probe()), id).not.toContain(id);
    }
  });
});

describe("what leaving the ground costs", () => {
  const UNTOUCHED_BUT_TAKEOFF = (takeoff: number) => ({
    stamina: 200,
    staminaRegen: 4,
    glideRegen: 7,
    takeoff,
  });

  it("raises takeoff by 15% for Rain and touches nothing else [REF:speed_effect_weather_rain]", () => {
    expect(row(held({ active: ["weather_rain"] }))).toEqual(UNTOUCHED_BUT_TAKEOFF(23));
  });

  it("raises takeoff by 10% for Snow [REF:speed_effect_weather_snow]", () => {
    expect(row(held({ active: ["weather_snow"] }))).toEqual(UNTOUCHED_BUT_TAKEOFF(22));
  });

  it("raises takeoff by 25% for a Thunderstorm [REF:speed_effect_weather_thunderstorm]", () => {
    expect(row(held({ active: ["weather_thunderstorm"] }))).toEqual(UNTOUCHED_BUT_TAKEOFF(25));
  });

  it("raises takeoff and lowers flight for a Monsoon, fliers only [REF:speed_effect_weather_monsoon]", () => {
    // The probe is Semi-Aquatic, so the whole of it is inert.
    expect(row(held({ active: ["weather_monsoon"] }))).toEqual(UNTOUCHED);

    const flier = probe([], { type: "Flier" });
    const under = held({ creature: flier, active: ["weather_monsoon"] });
    expect(row(under)).toEqual({ stamina: 200, staminaRegen: 4, glideRegen: 5.6, takeoff: 23 });
    expect(under.fly).toBeCloseTo(48, 6);
  });

  it("lowers the stamina rate by 25% for Ash Fall [REF:speed_effect_ash_fall]", () => {
    expect(row(held({ active: ["ash_fall"] }))).toEqual({
      stamina: 200,
      staminaRegen: 3,
      glideRegen: 7,
      takeoff: 20,
    });
  });

  it("halves takeoff for a Horned Beetlefly, and quarters it for a pair [REF:plushie_horned_beetlefly]", () => {
    expect(row(held({ build: { plushies: ["Horned Beetlefly"] } }))).toEqual(UNTOUCHED_BUT_TAKEOFF(10));
    expect(row(held({ build: { plushies: ["Horned Beetlefly", "Horned Beetlefly"] } })).takeoff).toBeCloseTo(5, 6);
  });

  it("lowers takeoff by a quarter for Swift Scales, alongside its speeds [REF:ability_swift_scales]", () => {
    const guardian = probe(["Swift Scales"]);
    expect(row(held({ creature: guardian, active: ["swift_scales"] })).takeoff).toBe(15);
  });

  it("reads None for takeoff when no base is supplied", () => {
    const speedsOnly = evaluateSpeed({ creature: probe(), build: BARE, active: [] }).final;
    expect(speedsOnly.takeoff).toBeNull();
  });
});
