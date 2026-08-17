import { describe, expect, it } from "vitest";
import {
  ABILITY_REGISTRY,
  deriveBoolConfigGates,
  deriveComposableSupportedActivatedNames,
  deriveComposableSupportedPassiveNames,
  deriveContourNoEffectPassiveNames,
  deriveContourPrebuiltActivatedNames,
  deriveContourTsNoOpActivatedNames,
  deriveContourTsNoOpPassiveNames,
  deriveGenericTrailStatus,
  deriveModeledOtherAbilities,
  deriveModeledOtherAbilityNames,
  deriveOverrideKeyNames,
  deriveOverrideKeys,
  deriveValueConfigGates,
  COMPOSABLE_ROUTED_NAMES,
} from "./abilityRegistry";
import { normalizeAbilityName } from "../shared/abilityNameAliases";

// The registry is now the authoritative source: every consumer list derives
// from it, so comparing a derive against its consumer would be tautological.
// Instead each derive is pinned to a frozen literal capturing its current
// correct output. An accidental registry edit (a flipped flag, a renamed gate
// key) shifts a derive and fails here on the exact list - this is the only
// guard for the config gates and override keys, which the roster eligibility
// snapshot does not exercise.
describe("ability registry derived lists", () => {
  it("derives COMPOSABLE_SUPPORTED_ACTIVATED_NAMES", () => {
    expect([...deriveComposableSupportedActivatedNames()]).toEqual([
      "Thorn Trap",
      "Toxic Trap",
      "Frost Snare",
      "Fortify",
      "Drowsy Area",
      "Unbridled Rage",
      "Hunters Curse",
      "Rewind",
      "Warden's Rage",
      "Adrenaline",
      "Lich Mark",
      "Frost Nova",
      "Reflux",
      "Totem",
      "Guardians Passage",
      "Reflect",
      "Cause Fear",
      "Grim Lariat",
      "Hunker",
      "Divination",
      "Poison Area",
      "Yolk Bomb",
      "Harden",
      "Cocoon",
      "Expunge",
      "Life Leech",
      "Cursed Sigil",
      "Spite",
      "Shadow Barrage",
      "Aura (Disease)",
      "Aura (Corrosion)",
      "Aura (Burn)",
    ]);
  });

  it("derives COMPOSABLE_SUPPORTED_PASSIVE_NAMES", () => {
    expect([...deriveComposableSupportedPassiveNames()]).toEqual([
      "Hunker",
      "Wing Shredder",
      "Serrated Teeth",
      "First Strike",
      "Warden's Resistance",
      "Berserk",
      "Guilt",
      "Unbreakable",
      "Sticky Fur",
      "Self-Destruct",
      "Quick Recovery",
      "Stubborn Stacker",
      "Block Bleed",
      "Block Burn",
      "Block Disease",
      "Block Frostbite",
      "Block Injury",
      "Block Necropoison",
      "Block Poison",
      "Bleed Attack",
      "Burn Attack",
      "Corrosion Attack",
      "Disease Attack",
      "Frostbite Attack",
      "Injury Attack",
      "Necropoison Attack",
      "Poison Attack",
      "Defensive Bleed",
      "Defensive Burn",
      "Defensive Corrosion",
      "Defensive Disease",
      "Defensive Frostbite",
      "Defensive Injury",
      "Defensive Necropoison",
      "Defensive Paralyze",
      "Defensive Poison",
      "Ligament Tear",
    ]);
  });

  it("derives the narrow MODELED_OTHER_ABILITY_NAMES set", () => {
    expect([...deriveModeledOtherAbilityNames()]).toEqual([
      "Thorn Trap",
      "Toxic Trap",
      "Frost Snare",
      "Fortify",
      "Drowsy Area",
      "Unbridled Rage",
      "Hunters Curse",
      "Rewind",
      "Warden's Rage",
      "Adrenaline",
      "Lich Mark",
      "Frost Nova",
      "Reflux",
      "Totem",
      "Guardians Passage",
      "Reflect",
      "Cause Fear",
      "Grim Lariat",
      "Hunker",
      "Divination",
      "Poison Area",
      "Yolk Bomb",
      "Harden",
      "Cocoon",
      "Expunge",
      "Life Leech",
      "Cursed Sigil",
      "Spite",
      "Shadow Barrage",
      "Aura (Disease)",
      "Aura (Corrosion)",
      "Aura (Burn)",
      "Wing Shredder",
      "Serrated Teeth",
      "First Strike",
      "Warden's Resistance",
      "Berserk",
      "Guilt",
      "Unbreakable",
      "Sticky Fur",
      "Self-Destruct",
      "Stubborn Stacker",
      "Ligament Tear",
      "Breath Resistance",
      "Toxic Trail",
      "Plague Trail",
      "Flame Trail",
      "Frost Trail",
      "Healing Step",
      "Two-Faced",
      "Lance",
      "Heal Breath",
      "Solar Beam",
      "Spirit Glare",
      "Cloud Breath",
    ]);
  });

  // The display-name list keeps its parenthetical subtypes verbatim (the
  // normalised set above and this list differ only in casing-preservation), so
  // wiki-sync / the data.ts backfill see the same names the old hand list gave.
  it("derives the MODELED_OTHER_ABILITIES display-name list", () => {
    expect(deriveModeledOtherAbilities()).toEqual([
      "Thorn Trap",
      "Toxic Trap",
      "Frost Snare",
      "Fortify",
      "Drowsy Area",
      "Unbridled Rage",
      "Hunters Curse",
      "Rewind",
      "Warden's Rage",
      "Adrenaline",
      "Lich Mark",
      "Frost Nova",
      "Reflux",
      "Totem",
      "Guardians Passage",
      "Reflect",
      "Cause Fear",
      "Grim Lariat",
      "Hunker",
      "Divination",
      "Poison Area",
      "Yolk Bomb",
      "Harden",
      "Cocoon",
      "Expunge",
      "Life Leech",
      "Cursed Sigil",
      "Spite",
      "Shadow Barrage",
      "Aura (Disease)",
      "Aura (Corrosion)",
      "Aura (Burn)",
      "Wing Shredder",
      "Serrated Teeth",
      "First Strike",
      "Warden's Resistance",
      "Berserk",
      "Guilt",
      "Unbreakable",
      "Sticky Fur",
      "Self-Destruct",
      "Stubborn Stacker",
      "Ligament Tear",
      "Breath Resistance",
      "Toxic Trail",
      "Plague Trail",
      "Flame Trail",
      "Frost Trail",
      "Healing Step",
      "Two-Faced",
      "Lance",
      "Heal Breath",
      "Solar Beam",
      "Spirit Glare",
      "Cloud Breath",
    ]);
  });

  it("derives CONTOUR_NO_EFFECT_PASSIVE_NAMES", () => {
    expect([...deriveContourNoEffectPassiveNames()]).toEqual([
      "Adrenaline",
      "Breath Resistance",
      "Volcanic",
      "Frosty",
      "Toxic Trail",
      "Plague Trail",
      "Flame Trail",
      "Frost Trail",
      "Healing Step",
      "Silent Hunter",
      "Ambush",
      "Charge Power",
      "Driver",
      "Block",
    ]);
  });

  it("derives CONTOUR_TS_NO_OP_PASSIVE_NAMES", () => {
    expect([...deriveContourTsNoOpPassiveNames()]).toEqual(["Channeling", "Gourmandizer"]);
  });

  it("derives CONTOUR_TS_NO_OP_ACTIVATED_NAMES", () => {
    expect([...deriveContourTsNoOpActivatedNames()]).toEqual([
      "Gourmandizer",
      "DefiledGround",
      "Defiled Ground",
    ]);
  });

  it("derives CONTOUR_PREBUILT_ACTIVATED_NAMES", () => {
    expect([...deriveContourPrebuiltActivatedNames()]).toEqual(["Harden", "Two-Faced"]);
  });

  it("derives the OVERRIDE_KEYS names", () => {
    expect(deriveOverrideKeys()).toEqual([
      "Fortify",
      "Unbridled Rage",
      "Hunters Curse",
      "Rewind",
      "Warden's Rage",
      "Adrenaline",
      "Frost Nova",
      "Guardians Passage",
      "Reflect",
      "Hunker",
      "Cocoon",
      "Life Leech",
    ]);
    // The normalised-set derive used by eligibility carries the same names.
    expect(deriveOverrideKeyNames()).toEqual(new Set(deriveOverrideKeys().map(normalizeAbilityName)));
  });

  it("derives GENERIC_TRAIL_STATUS", () => {
    expect(deriveGenericTrailStatus()).toEqual({
      "Necropoison Trail": "Necropoison_Status",
      "Radiation Trail": "Radiation_Status",
      "Blood Trail": "Bleed_Status",
    });
  });

  it("derives BOOL_CONFIG_GATES", () => {
    expect(deriveBoolConfigGates()).toEqual([
      { ability: "Thorn Trap", attackerKey: "attackerThornTrap", defenderKey: "defenderThornTrap" },
      { ability: "Toxic Trap", attackerKey: "attackerToxicTrap", defenderKey: "defenderToxicTrap" },
      { ability: "Frost Snare", attackerKey: "attackerFrostSnare", defenderKey: "defenderFrostSnare" },
      { ability: "Fortify", attackerKey: "attackerFortify", defenderKey: "defenderFortify" },
      { ability: "Drowsy Area", attackerKey: "attackerDrowsyArea", defenderKey: "defenderDrowsyArea" },
      { ability: "Unbridled Rage", attackerKey: "attackerUnbridledRage", defenderKey: "defenderUnbridledRage" },
      { ability: "Hunters Curse", attackerKey: "attackerHuntersCurse", defenderKey: "defenderHuntersCurse" },
      { ability: "Rewind", attackerKey: "attackerRewind", defenderKey: "defenderRewind" },
      { ability: "Warden's Rage", attackerKey: "attackerWardenRage", defenderKey: "defenderWardenRage" },
      { ability: "Adrenaline", attackerKey: "attackerAdrenaline", defenderKey: "defenderAdrenaline" },
      { ability: "Lich Mark", attackerKey: "attackerLichMark", defenderKey: "defenderLichMark" },
      { ability: "Frost Nova", attackerKey: "attackerFrostNova", defenderKey: "defenderFrostNova" },
      { ability: "Reflux", attackerKey: "attackerReflux", defenderKey: "defenderReflux" },
      { ability: "Totem", attackerKey: "attackerTotem", defenderKey: "defenderTotem" },
      {
        ability: "Guardians Passage",
        attackerKey: "attackerGuardiansPassage",
        defenderKey: "defenderGuardiansPassage",
      },
      { ability: "Reflect", attackerKey: "attackerReflect", defenderKey: "defenderReflect" },
      { ability: "Cause Fear", attackerKey: "attackerCauseFear", defenderKey: "defenderCauseFear" },
      { ability: "Grim Lariat", attackerKey: "attackerGrimLariat", defenderKey: "defenderGrimLariat" },
      { ability: "Hunker", attackerKey: "attackerHunker", defenderKey: "defenderHunker" },
      { ability: "Divination", attackerKey: "attackerDivination", defenderKey: "defenderDivination" },
      { ability: "Poison Area", attackerKey: "attackerPoisonArea", defenderKey: "defenderPoisonArea" },
      { ability: "Yolk Bomb", attackerKey: "attackerYolkBomb", defenderKey: "defenderYolkBomb" },
      { ability: "Harden", attackerKey: "attackerHarden", defenderKey: "defenderHarden" },
      { ability: "Cocoon", attackerKey: "attackerCocoon", defenderKey: "defenderCocoon" },
      { ability: "Expunge", attackerKey: "attackerExpunge", defenderKey: "defenderExpunge" },
    ]);
  });

  it("derives VALUE_CONFIG_GATES", () => {
    expect(deriveValueConfigGates()).toEqual([
      { ability: "Life Leech", attackerKey: "attackerLifeLeechValue", defenderKey: "defenderLifeLeechValue" },
      { ability: "Cursed Sigil", attackerKey: "attackerCursedSigilStacks", defenderKey: "defenderCursedSigilStacks" },
      { ability: "Spite", attackerKey: "attackerSpiteValue", defenderKey: "defenderSpiteValue" },
      { ability: "Shadow Barrage", attackerKey: "attackerShadowBarrageValue", defenderKey: "defenderShadowBarrageValue" },
    ]);
  });

  it("has no duplicate normalised ability names", () => {
    const seen = new Set<string>();
    for (const entry of ABILITY_REGISTRY) {
      const normalized = normalizeAbilityName(entry.name);
      expect(seen.has(normalized)).toBe(false);
      seen.add(normalized);
    }
  });

  // A configGate means the engine acts on the ability, but eligibility keys on
  // COMPOSABLE_ROUTED_NAMES (modeledOther plus partial). A config-bearing record that
  // forgets its routing flag would be treated as ignorable and silently fail open -
  // the engine sets the flag while eligibility skips the ability. Catch that here
  // instead of as a silent wrong result in a matchup.
  it("routes every config-bearing ability (configGate implies eligibility-routed)", () => {
    for (const entry of ABILITY_REGISTRY) {
      if (!entry.configGate) continue;
      expect(
        COMPOSABLE_ROUTED_NAMES.has(normalizeAbilityName(entry.name)),
        `"${entry.name}" has a configGate but is not in COMPOSABLE_ROUTED_NAMES — it would fail open. Set modeledOther: true (or mark it partial).`,
      ).toBe(true);
    }
  });
});
