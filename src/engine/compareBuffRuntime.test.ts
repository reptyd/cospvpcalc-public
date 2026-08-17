import { describe, expect, it } from "vitest";

import {
  applyCompareBuffRuntime,
  DEFAULT_COMPARE_BUFF_SELECTION,
  shareCompareAuraBuffs,
  type CompareBuffSelection,
} from "./compareBuffRuntime";
import { SPEC_CONSTANTS } from "./specConstants.generated";
import type { BuildOptions, FinalStats, InitialStatusOption } from "./types";

// Compare-only buff math lives entirely in TS (it is baked into FinalStats
// before the WASM boundary), so it never gets a Rust reference test. These
// unit tests pin each toggle to its Reference description so the compare-only
// surface can no longer drift silently (the same gap that let Aggressive /
// Scared diverge from their docs).

function minimalFinalStats(overrides: Partial<FinalStats> = {}): FinalStats {
  return {
    name: "Test",
    tier: 1,
    health: 1000,
    weight: 100,
    damage: 100,
    biteCooldown: 1,
    healthRegen: 100,
    stamina: 0,
    stamRegen: 100,
    walkAndSwimSpeed: 0,
    sprintSpeed: 0,
    turn: 0,
    venerationRate: 0,
    diet: "none",
    type: "test",
    mobilityOverride: "none",
    breath: "Test Breath",
    hasBreath: true,
    breathType: "Test Breath",
    appliedTraits: [],
    ...overrides,
  };
}

function makeBuild(plushies: string[] = []): BuildOptions {
  return { venerationStage: 0, traits: [], ascensionAssignments: [], plushies };
}

function withBuffs(overrides: Partial<CompareBuffSelection>): CompareBuffSelection {
  return { ...DEFAULT_COMPARE_BUFF_SELECTION, ...overrides };
}

function run(
  finalStats: FinalStats,
  buffs: Partial<CompareBuffSelection>,
  build: BuildOptions = makeBuild(),
  dayNight: "none" | "day" | "night" = "none",
  moon: "none" | "blueMoon" | "bloodMoon" = "none",
) {
  return applyCompareBuffRuntime(finalStats, build, withBuffs(buffs), dayNight, moon);
}

function findStatus(
  statuses: InitialStatusOption[],
  statusId: string,
): InitialStatusOption | undefined {
  return statuses.find((s) => s.statusId === statusId);
}

describe("applyCompareBuffRuntime - stat-modifier toggles", () => {
  it("damageBoost: +5% damage, +5% weight, -5% bite cooldown [REF:compare_damage_boost]", () => {
    const r = run(minimalFinalStats(), { damageBoost: true });
    expect(r.finalStats.damage).toBeCloseTo(105, 6);
    expect(r.finalStats.weight).toBeCloseTo(105, 6);
    expect(r.finalStats.biteCooldown).toBeCloseTo(0.95, 6);
  });

  it("regenBoost: +20% health/stam regen and 0.9x active cooldown [REF:compare_regen_boost]", () => {
    const r = run(minimalFinalStats(), { regenBoost: true });
    expect(r.finalStats.healthRegen).toBeCloseTo(120, 6);
    expect(r.finalStats.stamRegen).toBeCloseTo(120, 6);
    expect(r.activeCooldownMultiplier).toBeCloseTo(0.9, 6);
  });

  it("packHealerNearby: +25% health regen [REF:compare_pack_healer]", () => {
    const r = run(minimalFinalStats(), { packHealerNearby: true });
    expect(r.finalStats.healthRegen).toBeCloseTo(125, 6);
  });

  it("day and night move a photo diet only [REF:compare_day_night]", () => {
    const photo = minimalFinalStats({ diet: "Photovore" });
    const day = run(photo, {}, makeBuild(), "day");
    const night = run(photo, {}, makeBuild(), "night");
    expect(day.finalStats.damage).toBeCloseTo(105, 6);
    expect(day.finalStats.healthRegen).toBeCloseTo(115, 6);
    expect(night.finalStats.damage).toBeCloseTo(95, 6);
    expect(night.finalStats.healthRegen).toBeCloseTo(85, 6);

    const carnivore = minimalFinalStats({ diet: "Carnivore" });
    for (const time of ["day", "night"] as const) {
      const r = run(carnivore, {}, makeBuild(), time);
      expect(r.finalStats.damage).toBeCloseTo(100, 6);
      expect(r.finalStats.healthRegen).toBeCloseTo(100, 6);
    }
  });

  it("Eclipse at night reaches a diet day and night cannot [REF:compare_day_night]", () => {
    const carnivore = minimalFinalStats({ diet: "Carnivore" });
    const r = run(carnivore, {}, makeBuild(["Eclipse"]), "night");
    expect(r.finalStats.damage).toBeCloseTo(105, 6);
    expect(r.finalStats.healthRegen).toBeCloseTo(115, 6);
  });

  it("the two moon phases [REF:compare_moon]", () => {
    const blue = run(minimalFinalStats(), {}, makeBuild(), "none", "blueMoon");
    expect(blue.finalStats.damage).toBeCloseTo(50, 6);
    expect(blue.finalStats.healthRegen).toBeCloseTo(150, 6);
    expect(blue.finalStats.biteCooldown).toBeCloseTo(1, 6);

    const blood = run(minimalFinalStats(), {}, makeBuild(), "none", "bloodMoon");
    expect(blood.finalStats.damage).toBeCloseTo(150, 6);
    expect(blood.finalStats.biteCooldown).toBeCloseTo(0.5, 6);
    expect(blood.finalStats.healthRegen).toBeCloseTo(100, 6);
  });

  it("a moon phase reaches every diet [REF:compare_moon]", () => {
    for (const diet of ["Photovore", "Carnivore"]) {
      const r = run(minimalFinalStats({ diet }), {}, makeBuild(), "none", "bloodMoon");
      expect(r.finalStats.damage).toBeCloseTo(150, 6);
    }
  });

  it("Eclipse: applies only at night, and only once [REF:plushie_eclipse]", () => {
    const build = makeBuild(["Eclipse"]);
    const day = run(minimalFinalStats(), {}, build, "day");
    const night = run(minimalFinalStats(), {}, build, "night");
    const twice = run(minimalFinalStats(), {}, makeBuild(["Eclipse", "Eclipse"]), "night");

    expect(day.finalStats.damage).toBeCloseTo(100, 6);
    expect(day.finalStats.healthRegen).toBeCloseTo(100, 6);
    expect(night.finalStats.damage).toBeCloseTo(105, 6);
    expect(night.finalStats.healthRegen).toBeCloseTo(115, 6);
    expect(night.finalStats.stamRegen).toBeCloseTo(125, 6);

    // A second copy changes nothing.
    expect(twice.finalStats.damage).toBeCloseTo(night.finalStats.damage ?? 0, 6);
    expect(twice.finalStats.healthRegen).toBeCloseTo(night.finalStats.healthRegen ?? 0, 6);
    expect(twice.finalStats.stamRegen).toBeCloseTo(night.finalStats.stamRegen ?? 0, 6);
  });

  it("newborn seeds its status rather than baking the regen in", () => {
    const r = run(minimalFinalStats(), { newborn: true });
    // Newborn carries a meter effect as well as the regen, and both live on
    // the status, so nothing is applied to the stats here.
    expect(findStatus(r.initialStatuses, "Newborn_Status")).toBeTruthy();
    expect(r.finalStats.healthRegen).toBe(100);
  });

  it("spring water seeds a 300s status and leaves the stats alone", () => {
    const r = run(minimalFinalStats(), { springWater: true });
    expect(findStatus(r.initialStatuses, "Spring_Water_Status")?.remainingSec).toBe(300);
    expect(r.finalStats.healthRegen).toBe(100);
  });

  it("no toggles: stats unchanged and no statuses injected", () => {
    const r = run(minimalFinalStats(), {});
    expect(r.finalStats.damage).toBe(100);
    expect(r.finalStats.healthRegen).toBe(100);
    expect(r.initialStatuses).toHaveLength(0);
    expect(r.activeCooldownMultiplier).toBe(1);
  });
});

describe("applyCompareBuffRuntime - moon modifiers", () => {
  it("bloodMoon: +50% damage, -50% bite cooldown, +50% regens", () => {
    const r = run(minimalFinalStats(), {}, makeBuild(), "none", "bloodMoon");
    expect(r.finalStats.damage).toBeCloseTo(150, 6);
    expect(r.finalStats.biteCooldown).toBeCloseTo(0.5, 6);
    expect(r.finalStats.stamRegen).toBeCloseTo(150, 6);
  });

  it("blueMoon: -50% damage, +50% regens", () => {
    const r = run(minimalFinalStats(), {}, makeBuild(), "none", "blueMoon");
    expect(r.finalStats.damage).toBeCloseTo(50, 6);
    expect(r.finalStats.healthRegen).toBeCloseTo(150, 6);
    expect(r.finalStats.stamRegen).toBeCloseTo(150, 6);
  });
});

describe("applyCompareBuffRuntime - day/night (photo diets only)", () => {
  it("day boosts a photovore but leaves a non-photo diet untouched", () => {
    const photo = run(minimalFinalStats({ diet: "Photovore" }), {}, makeBuild(), "day");
    expect(photo.finalStats.damage).toBeCloseTo(105, 6);
    expect(photo.finalStats.healthRegen).toBeCloseTo(115, 6);

    const nonPhoto = run(minimalFinalStats({ diet: "Carnivore" }), {}, makeBuild(), "day");
    expect(nonPhoto.finalStats.damage).toBe(100);
    expect(nonPhoto.finalStats.healthRegen).toBe(100);
  });
});

describe("applyCompareBuffRuntime - injected timed statuses", () => {
  it("aggressive injects Aggressive_Status at ten stacks (Bear variant with Bear plushie)", () => {
    const plain = run(minimalFinalStats(), { aggressive: true });
    const ag = findStatus(plain.initialStatuses, "Aggressive_Status");
    expect(ag).toBeDefined();
    // Ten stacks, one off a second - the engine derives the 10-second window
    // from the count and the registry's per-stack second.
    expect(ag?.stacks).toBe(10);
    expect(findStatus(plain.initialStatuses, "Aggressive_Bear_Status")).toBeUndefined();

    const withBear = run(minimalFinalStats(), { aggressive: true }, makeBuild(["Bear"]));
    expect(findStatus(withBear.initialStatuses, "Aggressive_Bear_Status")).toBeDefined();
    expect(findStatus(withBear.initialStatuses, "Aggressive_Status")).toBeUndefined();
  });

  // The toggle only picks the status and its stack count. The -50% damage, and
  // the Bear variant's -45%, come from the Rust status multiplier.
  it("scared injects Scared_Status at ten stacks (Bear variant with Bear plushie) [REF:compare_scared_status]", () => {
    const plain = run(minimalFinalStats(), { scared: true });
    expect(findStatus(plain.initialStatuses, "Scared_Status")?.stacks).toBe(10);

    const withBear = run(minimalFinalStats(), { scared: true }, makeBuild(["Bear"]));
    expect(findStatus(withBear.initialStatuses, "Scared_Bear_Status")).toBeDefined();
    expect(findStatus(withBear.initialStatuses, "Scared_Status")).toBeUndefined();
  });

  // Mud Pile is the toggle, nothing more: the +25% regen and the doubled Bleed
  // and Poison heal rate belong to Muddy_Status in the Rust status path.
  it("muddy duration scales with Land plushie count (90s base, +90s per Land) [REF:compare_mud_pile]", () => {
    const base = run(minimalFinalStats(), { muddy: true });
    expect(findStatus(base.initialStatuses, "Muddy_Status")?.remainingSec).toBe(90);

    const twoLand = run(minimalFinalStats(), { muddy: true }, makeBuild(["Land", "Land"]));
    expect(findStatus(twoLand.initialStatuses, "Muddy_Status")?.remainingSec).toBe(270);
  });

  // What the seal does while it lasts is the Rust status; the toggle only hands
  // out the stacks, and only to the side that asked for it.
  it("guardiansSeal starts the fight with the seal a use of the ability grants [REF:compare_guardians_seal]", () => {
    const r = run(minimalFinalStats(), { guardiansSeal: true });
    const seal = findStatus(r.initialStatuses, "Guardian_Seal_Status");
    expect(seal?.stacks).toBe(SPEC_CONSTANTS.guardians_passage_seal_stacks);

    const off = run(minimalFinalStats(), {});
    expect(findStatus(off.initialStatuses, "Guardian_Seal_Status")).toBeUndefined();
  });

  it("cleanWater and refreshed inject their 180s statuses without an instant regen bump", () => {
    const r = run(minimalFinalStats(), { cleanWater: true, refreshed: true });
    expect(findStatus(r.initialStatuses, "Clean_Water_Status")?.remainingSec).toBe(180);
    expect(findStatus(r.initialStatuses, "Refreshed_Status")?.remainingSec).toBe(180);
    // The regen comes from the Rust status multiplier, not an instant applyPct.
    expect(r.finalStats.healthRegen).toBe(100);
  });
});

// Pack Healer is the one buff that is not personal. The sharing lived inside
// useCompareSimulation, where no test file exists at all, and flipping its `||`
// to `&&` left the aura reaching neither creature unless both had ticked the
// box - which reads as "the toggle does nothing" from either seat.
describe("Pack Healer is an aura, not a personal buff [REF:compare_pack_healer]", () => {
  const off = { ...DEFAULT_COMPARE_BUFF_SELECTION };

  it("one side turning it on covers both", () => {
    const [a, b] = shareCompareAuraBuffs({ ...off, packHealerNearby: true }, off);
    expect(a.packHealerNearby).toBe(true);
    expect(b.packHealerNearby).toBe(true);

    const [c, d] = shareCompareAuraBuffs(off, { ...off, packHealerNearby: true });
    expect(c.packHealerNearby).toBe(true);
    expect(d.packHealerNearby).toBe(true);
  });

  it("neither side gets it when neither asked", () => {
    const [a, b] = shareCompareAuraBuffs(off, off);
    expect(a.packHealerNearby).toBe(false);
    expect(b.packHealerNearby).toBe(false);
  });

  it("shares nothing else", () => {
    // Every other buff is per-side; sharing one of them would hand a creature a
    // bonus its own settings never asked for.
    const [a, b] = shareCompareAuraBuffs(
      { ...off, damageBoost: true, aggressive: true, guardiansSeal: true },
      off,
    );
    expect(a.damageBoost).toBe(true);
    expect(b.damageBoost).toBe(false);
    expect(b.aggressive).toBe(false);
    expect(b.guardiansSeal).toBe(false);
  });
});
