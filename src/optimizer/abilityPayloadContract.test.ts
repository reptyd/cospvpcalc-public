import { describe, expect, it } from "vitest";
import { applyRulesAndBuild } from "../engine/buildRules";
import { creatureByName } from "../engine/data";
import { EMPTY_BUILD_0 } from "../engine/engineTestFixtures";
import type { CreatureRuntime } from "../engine/types";
import { buildAbilityConfig } from "./buildAbilityConfig";
import { toRustBreathProfile, toRustStatusMeleeStats } from "./rustBestBuildsRuntime";
import type { RustComposableAbilityConfig, RustSimpleCombatantStats } from "./rustMatchupBridge";

// What the app hands the engine.
//
// The Rust reference tests build their own inputs, so they answer "does the
// engine do the right thing with this value" and say nothing about whether the
// value arrives. Every field below can be blanked at its source with the whole
// suite still green: Guilt's 0.5 becomes 1, Hunker's reduction becomes 0, a
// breath stops carrying its secondary ailment, a config gate reads false for
// every creature in the roster. The ability then silently does nothing in
// Compare and in Best Builds, and the engine is not at fault.
//
// So each row takes a real creature that has the ability, runs the real
// builder, and requires the field to have moved - and then takes a creature
// that does NOT have it and requires the same field to sit at its idle value.
// The second half is the half that matters: without it a field hard-wired to a
// constant would pass.
//
// Rows say what "moved" means rather than what the value is. The magnitudes are
// live roster data and a wiki sync moves them; pinning one here would make this
// a data test, which is what dataCoupledTestPolicy forbids.

const ROSTER = Object.values(creatureByName) as CreatureRuntime[];

function abilityNames(creature: CreatureRuntime): string[] {
  return [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? [])].map((a) => a.name);
}

function carrierOf(ability: string): CreatureRuntime {
  const found = ROSTER.find((c) => abilityNames(c).includes(ability));
  if (!found) throw new Error(`no creature in the roster carries ${ability}`);
  return found;
}

/** A creature without `ability`, and without any of `alsoWithout` muddying the read. */
function strangerTo(ability: string, ...alsoWithout: string[]): CreatureRuntime {
  const banned = [ability, ...alsoWithout];
  const found = ROSTER.find((c) => {
    const names = abilityNames(c);
    return banned.every((b) => !names.includes(b));
  });
  if (!found) throw new Error(`every creature carries one of ${banned.join(", ")}`);
  return found;
}

function meleeStatsFor(creature: CreatureRuntime): RustSimpleCombatantStats {
  return toRustStatusMeleeStats(creature, applyRulesAndBuild(creature, EMPTY_BUILD_0));
}

type StatContract = {
  ability: string;
  /** Other abilities that write the same field, kept off the control creature. */
  confoundedBy?: string[];
  moved: (stats: RustSimpleCombatantStats) => boolean;
};

const STAT_CONTRACTS: StatContract[] = [
  { ability: "Hunker", moved: (s) => (s.hunkerReductionPct ?? 0) > 0 },
  { ability: "Unbreakable", moved: (s) => (s.unbreakableDamageCapPct ?? 0) > 0 },
  { ability: "First Strike", moved: (s) => (s.firstStrikePct ?? 0) > 0 },
  { ability: "Berserk", moved: (s) => (s.berserkBiteCooldownMultiplier ?? 1) !== 1 },
  { ability: "Quick Recovery", moved: (s) => (s.quickRecoveryHpRatioThreshold ?? 0) > 0 },
  { ability: "Self-Destruct", moved: (s) => s.selfDestructProfile != null },
  { ability: "Guilt", moved: (s) => (s.damageTakenMultiplierOnBeingBitten ?? 1) < 1 },
  {
    ability: "Sticky Fur",
    // Every defensive on-hit-taken ability writes this list.
    confoundedBy: [
      "Defensive Bleed", "Defensive Burn", "Defensive Poison", "Defensive Frostbite",
      "Defensive Necropoison", "Defensive Disease", "Defensive Corrosion", "Defensive Injury",
      "Defensive Paralyze", "Serrated Teeth", "Wing Shredder",
    ],
    moved: (s) => (s.onHitTakenStatuses ?? []).length > 0,
  },
  {
    ability: "Breath Resistance",
    confoundedBy: ["Warden's Resistance"],
    moved: (s) => (s.breathResistance ?? 0) > 0,
  },
];

describe("what the melee-stat builder hands the engine", () => {
  for (const contract of STAT_CONTRACTS) {
    it(`${contract.ability} reaches the payload`, () => {
      expect(contract.moved(meleeStatsFor(carrierOf(contract.ability)))).toBe(true);
    });

    it(`${contract.ability} is what moves it, not something always on`, () => {
      const stranger = strangerTo(contract.ability, ...(contract.confoundedBy ?? []));
      expect(contract.moved(meleeStatsFor(stranger))).toBe(false);
    });
  }
});

type GateContract = {
  ability: string;
  read: (config: RustComposableAbilityConfig) => boolean | undefined;
};

const GATE_CONTRACTS: GateContract[] = [
  { ability: "Thorn Trap", read: (c) => c.attackerThornTrap },
  { ability: "Toxic Trap", read: (c) => c.attackerToxicTrap },
  { ability: "Frost Snare", read: (c) => c.attackerFrostSnare },
  { ability: "Fortify", read: (c) => c.attackerFortify },
  { ability: "Rewind", read: (c) => c.attackerRewind },
  { ability: "Reflect", read: (c) => c.attackerReflect },
  { ability: "Divination", read: (c) => c.attackerDivination },
  { ability: "Guardians Passage", read: (c) => c.attackerGuardiansPassage },
  { ability: "Cause Fear", read: (c) => c.attackerCauseFear },
  { ability: "Totem", read: (c) => c.attackerTotem },
  { ability: "Frost Nova", read: (c) => c.attackerFrostNova },
  { ability: "Adrenaline", read: (c) => c.attackerAdrenaline },
];

function configFor(source: CreatureRuntime, opponent: CreatureRuntime): RustComposableAbilityConfig {
  return buildAbilityConfig({
    sourceCreature: source,
    opponentCreature: opponent,
    includeTrails: true,
    trailsA: true,
    trailsB: true,
  });
}

describe("what the ability-config gates hand the engine", () => {
  // The config snapshots pin these as `false` for the fixtures they use, and no
  // fixture carries most of these abilities - so the pinned value proves nothing
  // and every one of these gates could be hard-wired false without a red test.
  for (const contract of GATE_CONTRACTS) {
    it(`${contract.ability} opens its gate for a carrier`, () => {
      const carrier = carrierOf(contract.ability);
      expect(contract.read(configFor(carrier, carrier))).toBe(true);
    });

    it(`${contract.ability} leaves its gate shut for a creature without it`, () => {
      const stranger = strangerTo(contract.ability);
      expect(contract.read(configFor(stranger, stranger))).toBe(false);
    });
  }
});

describe("what the breath builder hands the engine", () => {
  function breathFor(creature: CreatureRuntime) {
    return toRustBreathProfile(applyRulesAndBuild(creature, EMPTY_BUILD_0));
  }

  function firstCreatureWithBreath(predicate: (name: string) => boolean): CreatureRuntime {
    const found = ROSTER.find((c) => {
      const breath = (c.breathAbilities ?? [])[0]?.name;
      return typeof breath === "string" && predicate(breath);
    });
    if (!found) throw new Error("no creature in the roster has a breath matching that shape");
    return found;
  }

  it("a spec breath carries its secondary ailment", () => {
    // Blanking `specialStatuses` at the builder stops every breath applying
    // Corrosion, Burn, Frostbite or Slow, with the Rust breath tests still green
    // because they build their own profiles.
    const carrier = firstCreatureWithBreath((n) => n === "Acid Breath");
    const profile = breathFor(carrier);
    expect(profile?.specialStatuses?.length ?? 0).toBeGreaterThan(0);
  });

  it("a Lance breath carries its impact damage", () => {
    const carrier = firstCreatureWithBreath((n) => n.startsWith("Lance"));
    expect(breathFor(carrier)?.lanceDamagePct ?? 0).toBeGreaterThan(0);
  });

  it("Heal Breath carries its self-heal and its cleanse", () => {
    const carrier = firstCreatureWithBreath((n) => n === "Heal Breath");
    const profile = breathFor(carrier);
    expect(profile?.selfHealPct ?? 0).toBeGreaterThan(0);
    expect(profile?.cleanseStacks ?? 0).toBeGreaterThan(0);
  });

  it("an ordinary breath carries none of those", () => {
    // The control for all three above: the fields are driven by the breath, not
    // written for everyone.
    const plain = firstCreatureWithBreath((n) => n === "Fire Breath");
    const profile = breathFor(plain);
    expect(profile?.lanceDamagePct ?? 0).toBe(0);
    expect(profile?.selfHealPct ?? 0).toBe(0);
  });

  it("a breath-damage bonus reaches the breath's damage", () => {
    // Arcane and every trait / elder breath bonus ride this one multiply.
    const carrier = firstCreatureWithBreath((n) => n === "Fire Breath");
    const plain = toRustBreathProfile(applyRulesAndBuild(carrier, EMPTY_BUILD_0));
    const boosted = toRustBreathProfile(
      applyRulesAndBuild(carrier, { ...EMPTY_BUILD_0, plushies: ["Arcane"] }),
    );
    expect(plain?.dpsPct ?? 0).toBeGreaterThan(0);
    expect(boosted?.dpsPct ?? 0).toBeGreaterThan(plain?.dpsPct ?? 0);
  });
});
