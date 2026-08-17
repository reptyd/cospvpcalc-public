import { describe, expect, it } from "vitest";
import { applyRulesAndBuild } from "../engine";
import { buildBreathProfileByName, toRustBreathProfile } from "./rustBestBuildsRuntime";
import { makeSyntheticCreature } from "./__fixtures__/syntheticCreature";

// The special breaths are picked out by name in four shapes - a standalone
// constant (Plasma Beam), a regex family (the Lances), an id list with per-name
// branches inside it (Solar Beam / Spirit Glare / Heliolyth's Judgement) and a
// ternary chain (the support breaths). `toRustBreathProfile` and
// `buildBreathProfileByName` each carried a full copy, so a new special breath
// had to be added twice and the copies could part company in between. One of
// them is gone; this covers what the survivor has to keep getting right.
//
// The creature is synthetic and the breath name is the only input that varies,
// so nothing here reads a scraped magnitude.

describe("every Lance flavour in the roster carries its own ailment", () => {
  // The Reference: "Each aura tick deals 1% of the target's max HP and applies
  // 1 stack of the user's carrier-specific Lance ailment." The flavour in the
  // breath name IS that ailment, and `misc.rs` applies nothing at all when the
  // profile's `lanceStatusId` is null - so a flavour that fails to resolve is
  // an aura that ticks damage and no status.
  it.each([
    ["Lance (Bleed)", "Bleed_Status"],
    ["Lance (Burn)", "Burn_Status"],
    ["Lance (Disease)", "Disease_Status"],
    ["Lance (Frostbite)", "Frostbite_Status"],
    ["Lance (Injury)", "Injury_Status"],
    ["Lance (Necropoison)", "Necropoison_Status"],
    ["Lance (Radiation)", "Radiation_Status"],
  ])("%s applies %s", (breath, statusId) => {
    const profile = buildBreathProfileByName(breath);
    expect(profile?.specialKind).toBe("lance");
    expect(profile?.lanceStatusId).toBe(statusId);
  });
});

describe("the special breaths keep their own kind", () => {
  // One dispatch now serves both entry points, so this is what guards it:
  // each special name still reaches the branch that was written for it.
  it.each([
    ["Plasma Beam", "plasma_beam"],
    ["Solar Beam", "solar_beam"],
    ["Spirit Glare", "spirit_glare"],
    ["Heliolyth's Judgement", "heliolyth_judgement"],
    ["Heal Breath", "heal"],
    ["Miasma Breath", "miasma"],
    ["Energy Breath", "energy"],
    ["Cloud Breath", "cloud"],
  ])("%s -> %s", (breath, kind) => {
    expect(buildBreathProfileByName(breath)?.specialKind).toBe(kind);
  });

  it("Spirit Glare seeds Burn and Fear, the beams do not", () => {
    const seeded = buildBreathProfileByName("Spirit Glare")?.specialStatuses ?? [];
    expect(seeded.map((entry) => entry.statusId)).toEqual(
      expect.arrayContaining(["Burn_Status", "Fear_Status"]),
    );
    const solar = buildBreathProfileByName("Solar Beam")?.specialStatuses ?? [];
    expect(solar.map((entry) => entry.statusId)).not.toContain("Fear_Status");
  });

  it("a name with neither a spec row nor a special case builds nothing", () => {
    expect(buildBreathProfileByName("Not A Real Breath")).toBeNull();
  });
});

describe("the FinalStats entry point delegates to the one dispatch", () => {
  // `toRustBreathProfile` used to carry a second copy of every branch above.
  // It now reads its two build modifiers off `FinalStats` and hands the name
  // over, so this only has to prove the hand-off, not the branches.
  it.each(["Plasma Beam", "Lance (Necropoison)", "Spirit Glare", "Heal Breath", "Fire Breath"])(
    "%s",
    (breath) => {
      const built = applyRulesAndBuild(
        makeSyntheticCreature({ name: `BreathParity_${breath}`, stats: { breath } }),
      );
      expect(toRustBreathProfile(built)).toEqual(
        buildBreathProfileByName(breath, built.breathDamagePct ?? 0, built.breathRegenPct ?? 0),
      );
    },
  );
});
