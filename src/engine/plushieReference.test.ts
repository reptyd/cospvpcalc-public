import { describe, expect, it } from "vitest";
import { plushieByName } from "./data";
import { baseStats } from "./engine.test.helpers";
import { buildFinalFromStats, EMPTY_BUILD_0 } from "./engineTestFixtures";
import { applyRulesAndBuild } from "./buildRules";
import { PLUSHIE_REFERENCE_DRAFTS } from "../pages/referenceContent";
import type { FinalStats } from "./types";

// What every plushie does to a build, written out one plushie at a time from its
// Reference entry.
//
// A plushie is folded into FinalStats here in TS - plushieBuildMappings and
// plushieBuildRuntime do it before anything reaches the WASM boundary - so
// equipping one on a probe creature and reading the stats back is the whole of
// what the model does with it.
//
// Each row is the plushie's entire contract with the build, not a sample of it.
// The comparison is exact in both directions: every effect listed has to be
// applied, and nothing outside the row is allowed to move. That second half is
// what makes a row worth writing - it is how a plushie that quietly gained an
// effect gets caught, and why a row with no effects at all (every Out of model
// plushie, and the handful whose effect lives in another subsystem) still earns
// its place here.
//
// Rows say nothing about movement speed or the Compare-only buffs. Those are
// carried elsewhere and checked where they live: Movement Speed entries against
// the Speed Builds model, and Bear / Land / Eclipse / Darkstar against
// compareBuffRuntime.

type Contract = {
  /** The Reference entry this row is written from. */
  ref: string;
  /** Percent the build moves a scaling stat by. */
  damagePct?: number;
  weightPct?: number;
  healthRegenPct?: number;
  biteCooldownPct?: number;
  /** Fields that accumulate from zero rather than scaling a stat. */
  breathResistance?: number;
  breathDamagePct?: number;
  breathRegenPct?: number;
  reflectAvgPct?: number;
  muddyStrengthBoostPct?: number;
  hungerDrainPct?: number;
  thirstDrainPct?: number;
  appetiteCapacityPct?: number;
  /** Stacks the plushie adds to a bite it lands, or to a bite it takes. */
  onHit?: Record<string, number>;
  onHitTaken?: Record<string, number>;
  /** Percent of a status the plushie blocks. Negative is a weakness. */
  blockPct?: Record<string, number>;
  /** Abilities the plushie hands the wearer. */
  grants?: string[];
  /** Why the build is silent, for a plushie whose entry says it does something. */
  carriedElsewhere?: string;
};

/** A row with the prose-only fields stripped, which is what a build produces. */
type Effects = Omit<Contract, "ref" | "carriedElsewhere">;

const CONTRACTS: Record<string, Contract> = {
  // --- Stat movers ---
  Arcane: { ref: "[REF:plushie_arcane]", breathDamagePct: 12.5 },
  "Astral Quetzal": { ref: "[REF:plushie_astral_quetzal]", healthRegenPct: -25, breathResistance: 0.5, blockPct: { Bleed_Status: 50 } },
  Cat: { ref: "[REF:plushie_cat]", damagePct: -2.5, onHit: { Bleed_Status: 1 } },
  Chick: { ref: "[REF:plushie_chick]", weightPct: -7.5 },
  Coal: { ref: "[REF:plushie_coal]", weightPct: 3.5 },
  Cow: { ref: "[REF:plushie_cow]", damagePct: -5, weightPct: 10 },
  Heart: { ref: "[REF:plushie_heart]", weightPct: -5, healthRegenPct: 30 },
  Hum: { ref: "[REF:plushie_hum]", weightPct: 2.5 },
  "Ice Wolf": { ref: "[REF:plushie_ice_wolf]", damagePct: 5 },
  Knight: { ref: "[REF:plushie_knight]", damagePct: -5, reflectAvgPct: 5 },
  "Magichorn Prongbug": { ref: "[REF:plushie_magichorn_prongbug]", healthRegenPct: 10 },
  Mo: { ref: "[REF:plushie_mo]", damagePct: 2.5 },
  Oceanwing: { ref: "[REF:plushie_oceanwing]", muddyStrengthBoostPct: 50 },
  Rod: { ref: "[REF:plushie_rod]", healthRegenPct: 10 },
  Serpent: { ref: "[REF:plushie_serpent]", damagePct: -10 },
  Sky: { ref: "[REF:plushie_sky]", weightPct: -10 },
  Void: { ref: "[REF:plushie_void]", damagePct: 7.5 },

  // --- Appetite ---
  Aerodon: { ref: "[REF:plushie_aerodon]", thirstDrainPct: -15 },
  Euvatops: { ref: "[REF:plushie_euvatops]", hungerDrainPct: -15 },
  Palmtree: { ref: "[REF:plushie_palmtree]", appetiteCapacityPct: 10 },

  // --- Status carriers ---
  "Ember Spirit": { ref: "[REF:plushie_ember_spirit]", onHitTaken: { Burn_Status: 0.5 }, blockPct: { Frostbite_Status: -7.5 } },
  "Frost Dragon": { ref: "[REF:plushie_frost_dragon]", hungerDrainPct: -5, thirstDrainPct: -5, blockPct: { Frostbite_Status: 25 } },
  Ghost: { ref: "[REF:plushie_ghost]", blockPct: { Bleed_Status: 7.5 } },
  "Ginger Snapper": { ref: "[REF:plushie_ginger_snapper]", onHitTaken: { Frostbite_Status: 0.5 }, blockPct: { Burn_Status: -5 } },
  "Haunt Dragon": { ref: "[REF:plushie_haunt_dragon]", onHit: { Poison_Status: 0.5 } },
  Heartsnake: { ref: "[REF:plushie_heartsnake]", onHitTaken: { Poison_Status: 0.75 } },
  "Jammy Slug": { ref: "[REF:plushie_jammy_slug]", damagePct: -5, onHitTaken: { Necropoison_Status: 0.5 } },
  "Maple Leaflet": { ref: "[REF:plushie_maple_leaflet]", blockPct: { Injury_Status: 22.5 } },
  "Pig-Lantern": { ref: "[REF:plushie_pig_lantern]", damagePct: -2.5, onHit: { Burn_Status: 0.5 } },
  Sparkler: {
    ref: "[REF:plushie_sparkler]",
    blockPct: { Poison_Status: 15, Frostbite_Status: 15, Burn_Status: 15, Bleed_Status: -20 },
  },
  Tannenbaum: { ref: "[REF:plushie_tannenbaum]", biteCooldownPct: 5, onHit: { Frostbite_Status: 0.5 } },
  "Vampire Bat": {
    ref: "[REF:plushie_vampire_bat]",
    damagePct: -2.5,
    onHitTaken: { Bleed_Status: 1 },
    blockPct: { Bleed_Status: 2.5 },
  },

  // --- Ability granters ---
  Goldfish: { ref: "[REF:plushie_goldfish]", grants: ["Iron Stomach"] },
  "Minty Wiggler": { ref: "[REF:plushie_minty_wiggler]", grants: ["Frosty"] },
  "Pie Chomper": { ref: "[REF:plushie_pie_chomper]", healthRegenPct: -25, grants: ["Serrated Teeth"] },

  // --- Modeled, but the build is not where the effect lands ---
  "Baby Dragon": { ref: "[REF:plushie_baby_dragon]", breathRegenPct: 20 },
  Bear: { ref: "[REF:plushie_bear]", carriedElsewhere: "scales the Aggressive and Scared emote buffs in compareBuffRuntime" },
  Darkstar: { ref: "[REF:plushie_darkstar]", carriedElsewhere: "a Compare battle-setting toggle, not a build modifier" },
  Eclipse: { ref: "[REF:plushie_eclipse]", carriedElsewhere: "only at night, applied by compareBuffRuntime" },
  Knox: { ref: "[REF:plushie_knox]", carriedElsewhere: "moves nothing the stand-and-fight model carries" },
  Land: { ref: "[REF:plushie_land]", carriedElsewhere: "multiplies Muddy Status duration in compareBuffRuntime" },
  Seal: { ref: "[REF:plushie_seal]", carriedElsewhere: "moves nothing the stand-and-fight model carries" },
};

/** Everything else states it is out of model, and the build has to agree. */
const OUT_OF_MODEL: Record<string, Contract> = {
  Aerix: { ref: "[REF:plushie_aerix]" },
  "Blessed Bean": { ref: "[REF:plushie_blessed_bean]" },
  Bunny: { ref: "[REF:plushie_bunny]" },
  Catalyst: { ref: "[REF:plushie_catalyst]" },
  "Cavity Critter": { ref: "[REF:plushie_cavity_critter]" },
  "Clover Blossom": { ref: "[REF:plushie_clover_blossom]" },
  Clownfish: { ref: "[REF:plushie_clownfish]" },
  "Creator Star": { ref: "[REF:plushie_creator_star]" },
  Dolt: { ref: "[REF:plushie_dolt]" },
  "Egg Gobbler": { ref: "[REF:plushie_egg_gobbler]" },
  "Egg Shell": { ref: "[REF:plushie_egg_shell]" },
  "Eggy Snake": { ref: "[REF:plushie_eggy_snake]" },
  Elemental: { ref: "[REF:plushie_elemental]" },
  Fox: { ref: "[REF:plushie_fox]" },
  "Golden Bulb": { ref: "[REF:plushie_golden_bulb]" },
  "Horned Beetlefly": { ref: "[REF:plushie_horned_beetlefly]" },
  "Humming Frost": { ref: "[REF:plushie_humming_frost]" },
  Icebreaker: { ref: "[REF:plushie_icebreaker]" },
  Jackrabbit: { ref: "[REF:plushie_jackrabbit]" },
  "Jotun Scale": { ref: "[REF:plushie_jotun_scale]" },
  "Lunar Qilin": { ref: "[REF:plushie_lunar_qilin]" },
  "Magic Frog": { ref: "[REF:plushie_magic_frog]" },
  Momo: { ref: "[REF:plushie_momo]" },
  Mylo: { ref: "[REF:plushie_mylo]" },
  Notes: { ref: "[REF:plushie_notes]" },
  Octroma: { ref: "[REF:plushie_octroma]" },
  Owl: { ref: "[REF:plushie_owl]" },
  Partridge: { ref: "[REF:plushie_partridge]" },
  Reindeer: { ref: "[REF:plushie_reindeer]" },
  Rock: { ref: "[REF:plushie_rock]" },
  Rosevine: { ref: "[REF:plushie_rosevine]" },
  Sea: { ref: "[REF:plushie_sea]" },
  "Smore Cat": { ref: "[REF:plushie_smore_cat]" },
  "Snowflake Sneak": { ref: "[REF:plushie_snowflake_sneak]" },
  Snowman: { ref: "[REF:plushie_snowman]" },
  Springbok: { ref: "[REF:plushie_springbok]" },
  Springram: { ref: "[REF:plushie_springram]" },
  Stick: { ref: "[REF:plushie_stick]" },
  "Stitch Head": { ref: "[REF:plushie_stitch_head]" },
  Succulant: { ref: "[REF:plushie_succulant]" },
  Swan: { ref: "[REF:plushie_swan]" },
};

const SCALING: Array<[keyof Effects, keyof FinalStats]> = [
  ["damagePct", "damage"],
  ["weightPct", "weight"],
  ["healthRegenPct", "healthRegen"],
  ["biteCooldownPct", "biteCooldown"],
];

const ABSOLUTE: Array<[keyof Effects, keyof FinalStats]> = [
  ["breathResistance", "breathResistance"],
  ["breathDamagePct", "breathDamagePct"],
  ["breathRegenPct", "breathRegenPct"],
  ["reflectAvgPct", "plushieReflectAvgPct"],
  ["muddyStrengthBoostPct", "muddyStrengthBoostPct"],
  ["hungerDrainPct", "hungerDrainPct"],
  ["thirstDrainPct", "thirstDrainPct"],
  ["appetiteCapacityPct", "appetiteCapacityPct"],
];

/** Non-zero on every channel so a multiplicative modifier shows as a ratio. */
function probe() {
  return baseStats({
    name: "PlushieContractProbe",
    health: 1000,
    weight: 1000,
    damage: 1000,
    biteCooldown: 10,
    healthRegen: 100,
    stamRegen: 100,
    walkAndSwimSpeed: 100,
    sprintSpeed: 100,
  });
}

const PROBE = probe();
const BASE = buildFinalFromStats(PROBE.name, PROBE, EMPTY_BUILD_0);

/** The contract the build actually honours for one plushie, in the row's own shape. */
function observed(name: string): Effects {
  return readContract(BASE, buildFinalFromStats(PROBE.name, PROBE, { ...EMPTY_BUILD_0, plushies: [name] }));
}

/** The difference between two builds, in a row's own shape. */
function readContract(base: FinalStats, built: FinalStats): Effects {
  const found: Effects = {};
  for (const [key, stat] of SCALING) {
    const before = Number(base[stat] ?? 0);
    const after = Number(built[stat] ?? 0);
    if (before === 0 || Math.abs(after - before) < 1e-9) continue;
    const pct = (after / before - 1) * 100;
    (found[key] as number) = Math.round(pct * 1e6) / 1e6;
  }
  for (const [key, stat] of ABSOLUTE) {
    const value = Number(built[stat] ?? 0);
    if (Math.abs(value) < 1e-9) continue;
    (found[key] as number) = Math.round(value * 1e6) / 1e6;
  }
  const records: Array<[keyof Effects, keyof FinalStats]> = [
    ["onHit", "plushieStatusOnHit"],
    ["onHitTaken", "plushieStatusOnHitTaken"],
    ["blockPct", "plushieStatusBlockPct"],
  ];
  for (const [key, field] of records) {
    const value = built[field] as Record<string, number> | undefined;
    if (value && Object.keys(value).length > 0) {
      (found[key] as Record<string, number>) = value;
    }
  }
  const granted = built.plushieGrantedOtherAbilities;
  if (granted && granted.length > 0) found.grants = granted.map((a) => a.name);
  return found;
}

/** A row minus the prose-only fields, so it can be compared with what ran. */
function effectsOf(contract: Contract): Effects {
  const { ref: _ref, carriedElsewhere: _why, ...effects } = contract;
  return effects;
}

/** The marker a row must carry, read from the entry it is written from. */
function refFor(name: string): string {
  const entry = PLUSHIE_REFERENCE_DRAFTS.find((e) => e.name === name);
  return `[REF:${entry?.id}]`;
}

describe("plushie reference against the build", () => {
  for (const [name, contract] of Object.entries(CONTRACTS)) {
    it(`${name} moves what its entry says, and nothing else`, () => {
      expect(plushieByName[name], `${name} is not in plushies.runtime.json`).toBeDefined();
      expect(contract.ref).toBe(refFor(name));
      expect(observed(name)).toEqual(effectsOf(contract));
    });
  }

  for (const [name, row] of Object.entries(OUT_OF_MODEL)) {
    it(`${name} is out of model, so the build moves nothing`, () => {
      expect(plushieByName[name], `${name} is not in plushies.runtime.json`).toBeDefined();
      expect(row.ref).toBe(refFor(name));
      expect(observed(name)).toEqual({});
    });
  }

  it("covers every plushie the reference lists", () => {
    // Without this, a new plushie lands with no row and the suite stays green
    // while saying nothing about it.
    const documented = new Set([...Object.keys(CONTRACTS), ...Object.keys(OUT_OF_MODEL)]);
    const missing = PLUSHIE_REFERENCE_DRAFTS.map((e) => e.name)
      .filter((name) => plushieByName[name])
      .filter((name) => !documented.has(name));
    expect(missing, "these plushies have a Reference entry but no row above").toEqual([]);

    const stale = [...documented].filter((name) => !plushieByName[name]);
    expect(stale, "these rows name a plushie our data does not carry").toEqual([]);
  });

  it("agrees with our own data on which plushies stack", () => {
    const wrong: string[] = [];
    for (const entry of PLUSHIE_REFERENCE_DRAFTS) {
      const local = plushieByName[entry.name];
      if (!local) continue;
      const corpus = [entry.summary, ...entry.mechanics, ...entry.notes].join(" ");
      const saysUnique = /\bunique\b/i.test(corpus);
      const saysStackable = /\bstackable\b/i.test(corpus);
      // An entry is free to stay silent - most Out of model ones do, and there is
      // nothing to disagree about when it says nothing.
      if (!saysUnique && !saysStackable) continue;
      const isUnique = local.stackRule === "unique";
      if (saysUnique !== isUnique) {
        wrong.push(`${entry.name}: the entry says ${saysUnique ? "Unique" : "Stackable"}; our data says ${local.stackRule}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

// Stubborn Stacker replaces four plushies' effects outright, so what those four
// do is a claim about plushies and is written out here beside them. Each row is
// the whole of what the entry says that plushie becomes, and the build has to
// produce exactly it - the replacement is the point, so an effect the plushie
// normally carries surviving alongside the override is a failure.
const STUBBORN_STACKER: Record<string, Contract> = {
  Cat: { ref: "[REF:ability_stubborn_stacker]", healthRegenPct: 10, blockPct: { Bleed_Status: 5 } },
  "Pig-Lantern": { ref: "[REF:ability_stubborn_stacker]", damagePct: 5, blockPct: { Burn_Status: 5 } },
  "Haunt Dragon": { ref: "[REF:ability_stubborn_stacker]", blockPct: { Poison_Status: 5 } },
  Tannenbaum: { ref: "[REF:ability_stubborn_stacker]", biteCooldownPct: -5, blockPct: { Frostbite_Status: 5 } },
};

describe("Stubborn Stacker rewrites four plushies", () => {
  const CARRIER = "StubbornStackerProbe";
  /** The same probe creature, but carrying the passive that swaps the effects. */
  const carrier = {
    name: CARRIER,
    stats: PROBE,
    passiveAbilities: [{ abilityId: "Stubborn Stacker", name: "Stubborn Stacker", value: null, semantics: "neutral" as const, subtype: null }],
  };
  const carrierBase = applyRulesAndBuild(carrier, EMPTY_BUILD_0);

  for (const [plushie, contract] of Object.entries(STUBBORN_STACKER)) {
    it(`${plushie} becomes what the entry says on a carrier`, () => {
      // [REF:ability_stubborn_stacker]
      const built = applyRulesAndBuild(carrier, { ...EMPTY_BUILD_0, plushies: [plushie] });
      expect(readContract(carrierBase, built)).toEqual(effectsOf(contract));
    });

    it(`${plushie} does something else without the ability`, () => {
      // [REF:ability_stubborn_stacker]
      // The override only exists because the plushie's own effect differs. If the
      // two ever matched, the rows above would pass while proving nothing.
      expect(observed(plushie)).not.toEqual(effectsOf(contract));
    });
  }
});
