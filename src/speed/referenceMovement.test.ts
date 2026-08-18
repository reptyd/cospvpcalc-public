import { describe, expect, it } from "vitest";
import type { BuildOptions, CreatureRuntime, CreatureStats } from "../engine/types";
import { traits as traitRoster } from "../engine/buildData";
import {
  baseChannels,
  CHANNEL_LABELS,
  LOWER_IS_BETTER,
  READOUT_CHANNELS,
  SPEED_CHANNELS,
  type SpeedChannel,
  type SpeedReadout,
} from "./speedChannels";
import { SPEED_EFFECTS } from "./speedEffects";
import { buildContext, evaluateSpeed, offeredEffects } from "./speedMath";
import { optimizableChannels } from "./speedSearch";

// The Movement entries of the Reference, one claim per test, against the code
// that computes the figure. Every expected number is written out here. Reading
// it off the entry instead would make the check agree with the sentence by
// construction, and would go quiet the moment the sentence was reworded.
//
// The [REF:<id>] markers are what referenceCoverage.test.ts counts, so an entry
// keeps its cover only while the body carrying its marker still asserts.
//
// Claims these entries make about something other than a movement figure are
// out of scope here: durations, the grounding Cocooning applies, the tiers of
// the packmates Sea School counts. Speed Builds computes none of them.

/** One creature carrying every movement channel at a value of its own, so a
 * factor landing on one channel can never be read off another. Tier 2 and a
 * swimmer, which is what opens Sea School's two gates. */
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
  beachSpeed: 25,
  turn: 2,
  ambush: 1.3,
  flySprintMultiplier: 0.5,
  diet: "Carnivore",
  type: "Semi-Aquatic",
};

function probe(abilities: string[] = [], overrides: Partial<CreatureStats> = {}): CreatureRuntime {
  return {
    name: "Movement probe",
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

type Held = {
  creature?: CreatureRuntime;
  build?: Partial<BuildOptions>;
  active?: string[];
  packmates?: number;
  fillPct?: number;
};

function held({ creature = probe(), build = {}, active = [], packmates = 0, fillPct = 100 }: Held = {}): SpeedReadout {
  return evaluateSpeed({ creature, build: { ...BARE, ...build }, active, packmates, fillPct }).final;
}

/** The six stored channels at once. Asserting the whole row is what turns a
 * claim about one channel into a claim that the effect left the other five
 * alone. Rounded because the registry multiplies in binary floating point. */
function row(readout: SpeedReadout): Record<SpeedChannel, number | null> {
  const out = {} as Record<SpeedChannel, number | null>;
  for (const channel of SPEED_CHANNELS) {
    const value = readout[channel];
    out[channel] = value === null ? null : Math.round(value * 1e6) / 1e6;
  }
  return out;
}

const ids = (creature: CreatureRuntime) => offeredEffects(creature, BARE).map((effect) => effect.id);

describe("Amped", () => {
  it("multiplies Walk / Swim, Sprint and Fly by 1.1, and moves nothing else [REF:speed_effect_amped]", () => {
    const charged = probe(["Overcharged"]);
    expect(row(held({ creature: charged }))).toEqual({
      speed: 40, sprint: 100, fly: 60, beached: 25, turn: 2, ambushFactor: 1.3,
    });
    expect(row(held({ creature: charged, active: ["amped"] }))).toEqual({
      speed: 44, sprint: 110, fly: 66, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });

  it("reaches only a creature that owns Overcharged [REF:speed_effect_amped]", () => {
    expect(ids(probe(["Overcharged"]))).toContain("amped");
    expect(ids(probe())).not.toContain("amped");
    expect(row(held({ creature: probe(), active: ["amped"] }))).toEqual({
      speed: 40, sprint: 100, fly: 60, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });
});

describe("Cocooning", () => {
  it("multiplies Walk / Swim, Sprint, Fly and Beached by 0.3 [REF:speed_effect_cocooning]", () => {
    expect(row(held({ creature: probe(["Cocoon"]), active: ["cocooning"] }))).toEqual({
      speed: 12, sprint: 30, fly: 18, beached: 7.5, turn: 2, ambushFactor: 1.3,
    });
  });

  it("reaches only a creature that owns Cocoon [REF:speed_effect_cocooning]", () => {
    expect(ids(probe(["Cocoon"]))).toContain("cocooning");
    expect(ids(probe())).not.toContain("cocooning");
    expect(held({ creature: probe(), active: ["cocooning"] }).sprint).toBe(100);
  });
});

describe("Cower", () => {
  it("multiplies Walk / Swim and Sprint by 1.25 and does not touch Fly [REF:speed_effect_posture_cower]", () => {
    expect(row(held({ active: ["posture_cower"] }))).toEqual({
      speed: 50, sprint: 125, fly: 60, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });

  it("takes that factor to 1.375 with Bear [REF:speed_effect_posture_cower]", () => {
    expect(row(held({ build: { plushies: ["Bear"] }, active: ["posture_cower"] }))).toEqual({
      speed: 55, sprint: 137.5, fly: 60, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });

  it("leaves every channel where it was when Bear is held alone [REF:speed_effect_posture_cower]", () => {
    expect(row(held({ build: { plushies: ["Bear"] } }))).toEqual({
      speed: 40, sprint: 100, fly: 60, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });

  it("is open to a creature that owns nothing - no ability gates the posture [REF:speed_effect_posture_cower]", () => {
    const bare = probe();
    expect(bare.passiveAbilities).toHaveLength(0);
    expect(ids(bare)).toContain("posture_cower");
    expect(held({ creature: bare, active: ["posture_cower"] }).sprint).toBe(125);
  });
});

describe("Egg Speed", () => {
  it("pays 1.25 at tiers 1 to 3, 1.35 at tier 4 and 1.45 at tier 5 [REF:speed_effect_event_speed]", () => {
    for (const tier of [1, 2, 3]) {
      expect(row(held({ creature: probe([], { tier }), active: ["event_speed"] })), `tier ${tier}`).toEqual({
        speed: 50, sprint: 125, fly: 75, beached: 25, turn: 2, ambushFactor: 1.3,
      });
    }
    expect(row(held({ creature: probe([], { tier: 4 }), active: ["event_speed"] }))).toEqual({
      speed: 54, sprint: 135, fly: 81, beached: 25, turn: 2, ambushFactor: 1.3,
    });
    expect(row(held({ creature: probe([], { tier: 5 }), active: ["event_speed"] }))).toEqual({
      speed: 58, sprint: 145, fly: 87, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });

  it("falls back to 1.25 for a tier outside 1 to 5 [REF:speed_effect_event_speed]", () => {
    for (const tier of [0, 6, 9]) {
      expect(held({ creature: probe([], { tier }), active: ["event_speed"] }).sprint, `tier ${tier}`).toBe(125);
    }
  });

  it("comes off a pickup, so no ability gates it [REF:speed_effect_event_speed]", () => {
    const bare = probe();
    expect(bare.passiveAbilities).toHaveLength(0);
    expect(ids(bare)).toContain("event_speed");
  });
});

describe("Heart Speed", () => {
  it("pays 1.25 at tiers 1 to 3, 1.35 at tier 4 and 1.45 at tier 5 [REF:speed_effect_heart_speed]", () => {
    for (const tier of [1, 2, 3]) {
      expect(row(held({ creature: probe([], { tier }), active: ["heart_speed"] })), `tier ${tier}`).toEqual({
        speed: 50, sprint: 125, fly: 75, beached: 25, turn: 2, ambushFactor: 1.3,
      });
    }
    expect(row(held({ creature: probe([], { tier: 4 }), active: ["heart_speed"] }))).toEqual({
      speed: 54, sprint: 135, fly: 81, beached: 25, turn: 2, ambushFactor: 1.3,
    });
    expect(row(held({ creature: probe([], { tier: 5 }), active: ["heart_speed"] }))).toEqual({
      speed: 58, sprint: 145, fly: 87, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });

  it("falls back to 1.25 for a tier outside 1 to 5 [REF:speed_effect_heart_speed]", () => {
    for (const tier of [0, 6, 9]) {
      expect(held({ creature: probe([], { tier }), active: ["heart_speed"] }).sprint, `tier ${tier}`).toBe(125);
    }
  });

  it("comes off a pickup, so no ability gates it [REF:speed_effect_heart_speed]", () => {
    const bare = probe();
    expect(bare.passiveAbilities).toHaveLength(0);
    expect(ids(bare)).toContain("heart_speed");
  });
});

describe("Guardians Passage", () => {
  // The factor the oracle never reached: its rule anchored the number to the end
  // of the sentence, and this bullet carries a trailing clause after it.
  it("multiplies Walk / Swim, Sprint and Fly by 0.1 while channeling [REF:speed_effect_guardians_passage_channel]", () => {
    expect(row(held({ creature: probe(["Guardians Passage"]), active: ["guardians_passage_channel"] }))).toEqual({
      speed: 4, sprint: 10, fly: 6, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });

  it("reaches only a creature that owns Guardians Passage [REF:speed_effect_guardians_passage_channel]", () => {
    expect(ids(probe(["Guardians Passage"]))).toContain("guardians_passage_channel");
    expect(ids(probe())).not.toContain("guardians_passage_channel");
    expect(held({ creature: probe(), active: ["guardians_passage_channel"] }).sprint).toBe(100);
  });
});

describe("Sea School", () => {
  const school = (packmates: number, overrides: Partial<CreatureStats> = {}) =>
    held({ creature: probe([], overrides), active: ["sea_school"], packmates });

  it("multiplies Walk / Swim and Sprint by 1 plus 0.05 per counted packmate [REF:speed_effect_sea_school]", () => {
    expect(row(school(1))).toEqual({ speed: 42, sprint: 105, fly: 60, beached: 25, turn: 2, ambushFactor: 1.3 });
    expect(row(school(2))).toEqual({ speed: 44, sprint: 110, fly: 60, beached: 25, turn: 2, ambushFactor: 1.3 });
    expect(row(school(3))).toEqual({ speed: 46, sprint: 115, fly: 60, beached: 25, turn: 2, ambushFactor: 1.3 });
  });

  it("caps the count at six, for a 1.3 multiplier [REF:speed_effect_sea_school]", () => {
    for (const packmates of [6, 9, 26]) {
      expect(row(school(packmates)), `${packmates} packmates`).toEqual({
        speed: 52, sprint: 130, fly: 60, beached: 25, turn: 2, ambushFactor: 1.3,
      });
    }
  });

  it("resolves to nothing below one packmate [REF:speed_effect_sea_school]", () => {
    expect(row(school(0))).toEqual({ speed: 40, sprint: 100, fly: 60, beached: 25, turn: 2, ambushFactor: 1.3 });
  });

  it("pays only a carrier of tier 1 or 2 [REF:speed_effect_sea_school]", () => {
    expect(row(school(6, { tier: 1 })).sprint).toBe(130);
    expect(row(school(6, { tier: 2 })).sprint).toBe(130);
    expect(row(school(6, { tier: 3 })).sprint).toBe(100);
  });

  it("pays only a creature that swims [REF:speed_effect_sea_school]", () => {
    expect(row(school(6, { type: "Aquatic" })).sprint).toBe(130);
    expect(row(school(6, { type: "Semi-Aquatic" })).sprint).toBe(130);
    expect(row(school(6, { type: "Terrestrial" })).sprint).toBe(100);
  });
});

describe("Speed Boost", () => {
  it("multiplies Walk / Swim by 1.1 and Sprint by 1.05, and does not touch Fly [REF:speed_effect_creature_speed_boost]", () => {
    expect(row(held({ active: ["creature_speed_boost"] }))).toEqual({
      speed: 44, sprint: 105, fly: 60, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });
});

describe("Speed Gift", () => {
  it("multiplies Walk / Swim, Sprint and Fly by 1.2 [REF:speed_effect_speed_gift]", () => {
    expect(row(held({ creature: probe(["Speed Steal"]), active: ["speed_gift"] }))).toEqual({
      speed: 48, sprint: 120, fly: 72, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });

  it("reaches only a creature that owns Speed Steal [REF:speed_effect_speed_gift]", () => {
    expect(ids(probe(["Speed Steal"]))).toContain("speed_gift");
    expect(ids(probe())).not.toContain("speed_gift");
    expect(held({ creature: probe(), active: ["speed_gift"] }).sprint).toBe(100);
  });
});

describe("Speed trait", () => {
  const atStage = (venerationStage: number) => held({ build: { venerationStage, traits: ["Speed"] } });

  it("multiplies Walk / Swim, Sprint and Fly by 1.035 with no ascension [REF:speed_effect_trait_speed]", () => {
    expect(row(atStage(0))).toEqual({
      speed: 41.4, sprint: 103.5, fly: 62.1, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });

  it("walks the six steps +3.5%, +5%, +6.5%, +8%, +9.5% and +11% [REF:speed_effect_trait_speed]", () => {
    const sprints = [0, 1, 2, 3, 4, 5].map((stage) => row(atStage(stage)).sprint);
    expect(sprints).toEqual([103.5, 105, 106.5, 108, 109.5, 111]);
  });

  it("gives a sole slotted trait every stage, and splits the budget with a second [REF:speed_effect_trait_speed]", () => {
    expect(atStage(5).sprint).toBeCloseTo(111, 6);
    const split = held({
      build: {
        venerationStage: 5,
        traits: ["Speed", "Damage"],
        ascensionAssignments: ["Speed", "Speed", "Damage", "Damage", "Damage"],
      },
    });
    expect(row(split).sprint).toBe(106.5);
  });

  it("is the only trait in the roster that moves a movement channel [REF:speed_effect_trait_speed]", () => {
    const names = traitRoster.map((trait) => trait.name);
    expect(names).toContain("Speed");
    const others = names.filter((name) => name !== "Speed");
    expect(others.length).toBeGreaterThan(0);
    for (const name of others) {
      expect(row(held({ build: { venerationStage: 5, traits: [name] } })), name).toEqual({
        speed: 40, sprint: 100, fly: 60, beached: 25, turn: 2, ambushFactor: 1.3,
      });
    }
  });
});

describe("Sugar Rush", () => {
  const grazer = probe([], { diet: "Herbivore" });

  it("adds a flat 1 to Fly, and adds it after every multiplier [REF:speed_effect_sugar_rush]", () => {
    expect(row(held({ creature: grazer, build: { plushies: ["Momo"] } }))).toEqual({
      speed: 40, sprint: 100, fly: 61, beached: 25, turn: 2, ambushFactor: 1.3,
    });
    // Chick lifts every channel by a twentieth. Fly reads 60 x 1.05 + 1, not
    // (60 + 1) x 1.05, which is what makes the 1 a floor rather than a share.
    expect(row(held({ creature: grazer, build: { plushies: ["Momo", "Chick"] } }))).toEqual({
      speed: 42, sprint: 105, fly: 64, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });

  it("pays every plant eater and no meat eater [REF:speed_effect_sugar_rush]", () => {
    const fly = (diet: string) => held({ creature: probe([], { diet }), build: { plushies: ["Momo"] } }).fly;
    for (const diet of ["Herbivore", "Omnivore", "Photovore"]) expect(fly(diet), diet).toBe(61);
    for (const diet of ["Carnivore", "Photocarnivore"]) expect(fly(diet), diet).toBe(60);
  });

  it("does not double for a second Momo [REF:speed_effect_sugar_rush]", () => {
    expect(held({ creature: grazer, build: { plushies: ["Momo", "Momo"] } }).fly).toBe(61);
  });
});

describe("Swift Scales", () => {
  it("multiplies Walk / Swim and Sprint by 1.4 and Fly by 1.75 [REF:speed_effect_swift_scales]", () => {
    expect(row(held({ creature: probe(["Swift Scales"]), active: ["swift_scales"] }))).toEqual({
      speed: 56, sprint: 140, fly: 105, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });

  it("reaches only a creature that owns Swift Scales [REF:speed_effect_swift_scales]", () => {
    expect(ids(probe(["Swift Scales"]))).toContain("swift_scales");
    expect(ids(probe())).not.toContain("swift_scales");
    expect(held({ creature: probe(), active: ["swift_scales"] }).sprint).toBe(100);
  });
});

describe("Windstorm", () => {
  it("multiplies Walk / Swim, Sprint and Fly by 1.15 [REF:speed_effect_windstorm]", () => {
    expect(row(held({ active: ["windstorm"] }))).toEqual({
      speed: 46, sprint: 115, fly: 69, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });

  it("is weather, so no ability gates it [REF:speed_effect_windstorm]", () => {
    const bare = probe();
    expect(bare.passiveAbilities).toHaveLength(0);
    expect(ids(bare)).toContain("windstorm");
  });
});

describe("Movement Channels", () => {
  it("reads the six movement stats straight off the creature [REF:speed_channels]", () => {
    expect(row(baseChannels(probe()))).toEqual({
      speed: 40, sprint: 100, fly: 60, beached: 25, turn: 2, ambushFactor: 1.3,
    });
  });

  it("carries every declared channel as a column, and the ambush multiplier as none [REF:speed_channels]", () => {
    expect(READOUT_CHANNELS.map((channel) => CHANNEL_LABELS[channel])).toEqual([
      "Walk / Swim", "Sprint", "Ambush", "Fly", "Fly sprint", "Beached", "Turn",
    ]);
    // It is a multiplier, so it is never printed beside a column of speeds.
    expect(CHANNEL_LABELS.ambushFactor).toBe("Ambush multiplier");
    expect(READOUT_CHANNELS).not.toContain("ambushFactor");
  });

  it("lets only Bunny raise the ambush multiplier [REF:speed_channels]", () => {
    // Resolved against a context generous enough that every conditional effect
    // returns whatever it can return.
    const generous = buildContext(
      probe([], { diet: "Herbivore" }),
      { ...BARE, venerationStage: 5, traits: ["Speed"], plushies: ["Bear"] },
      125,
      6,
    );
    const raisers = SPEED_EFFECTS.filter((effect) => effect.resolve(generous).ambushFactor !== undefined);
    expect(raisers.map((effect) => effect.label)).toEqual(["Bunny"]);
    expect(held({ build: { plushies: ["Bunny"] } }).ambushFactor).toBeCloseTo(1.3975, 10);
  });

  it("derives Fly sprint as Fly times one plus the fly-sprint bonus [REF:speed_channels]", () => {
    expect(SPEED_CHANNELS).not.toContain("flySprint");
    // The creature's bonus is 0.5, so the factor is 1.5.
    expect(baseChannels(probe()).flySprint).toBe(90);
    // Sky adds 2 to Fly, and Fly sprint follows it.
    expect(held({ build: { plushies: ["Sky"] } }).fly).toBe(62);
    expect(held({ build: { plushies: ["Sky"] } }).flySprint).toBe(93);
  });

  it("derives Ambush as Sprint times the ambush multiplier [REF:speed_channels]", () => {
    expect(SPEED_CHANNELS).not.toContain("ambush");
    expect(baseChannels(probe()).ambush).toBeCloseTo(130, 6);
    // Chick lifts Sprint to 105, and Ambush follows it.
    const chick = held({ build: { plushies: ["Chick"] } });
    expect(chick.sprint).toBeCloseTo(105, 6);
    expect(chick.ambush).toBeCloseTo(136.5, 6);
  });

  it("counts Turn the other way and ranks nothing on it [REF:speed_channels]", () => {
    expect([...LOWER_IS_BETTER]).toEqual(["turn"]);
    const rankable = optimizableChannels();
    expect(rankable.has("turn")).toBe(false);
    expect(rankable.has("sprint")).toBe(true);
  });

  it("reads None for a stat the creature does not carry [REF:speed_channels]", () => {
    const grounded = baseChannels(probe([], { flySpeed: undefined, beachSpeed: undefined }));
    expect(grounded.fly).toBeNull();
    expect(grounded.flySprint).toBeNull();
    expect(grounded.beached).toBeNull();
    expect(grounded.sprint).toBe(100);
  });
});
