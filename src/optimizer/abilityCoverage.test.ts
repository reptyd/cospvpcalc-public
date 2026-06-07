import { describe, expect, it } from "vitest";
import { computeAbilityCoverageSummary, getAbilityCoverage } from "./abilityCoverage";
import { creaturesData } from "../engine/creatureData";

describe("ability coverage module", () => {
  it("returns sane aggregate counters", () => {
    const summary = computeAbilityCoverageSummary();
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.applied).toBeGreaterThanOrEqual(0);
    expect(summary.partial).toBeGreaterThanOrEqual(0);
    expect(summary.deferred).toBeGreaterThanOrEqual(0);
    expect(summary.outOfModel).toBeGreaterThanOrEqual(0);
    expect(summary.unresolved).toBeGreaterThanOrEqual(0);
    expect(summary.applied + summary.partial + summary.deferred + summary.outOfModel + summary.unresolved).toBe(summary.total);
  });

  it("returns normalized statuses for creature ability rows", () => {
    const creatureName = creaturesData[0]?.name;
    expect(creatureName).toBeTruthy();
    if (!creatureName) return;

    const rows = getAbilityCoverage(creatureName);
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(["modeled", "partial", "deferred", "out-of-model", "not-modeled"]).toContain(row.status);
    }
  });

  it("marks Gholbini Reflux as partial and Gourmandizer as partial", () => {
    const rows = getAbilityCoverage("Gholbini");

    expect(rows.find((row) => row.name === "Reflux")?.status).toBe("partial");
    expect(rows.find((row) => row.name === "Gourmandizer")?.status).toBe("partial");
  });

  it("marks Veishyadar Ligament Tear as modeled", () => {
    const rows = getAbilityCoverage("Veishyadar");

    expect(rows.find((row) => row.name === "Ligament Tear")?.status).toBe("modeled");
  });

  it("marks Crata Peretina Shock Area as out-of-model", () => {
    const rows = getAbilityCoverage("Crata Peretina");

    expect(rows.find((row) => row.name === "Shock Area")?.status).toBe("out-of-model");
  });

  it("marks Aseliorus Healing Step as modeled", () => {
    const rows = getAbilityCoverage("Aseliorus");

    expect(rows.find((row) => row.name === "Healing Step")?.status).toBe("modeled");
  });

  it("marks Lich Mark modeled across its carriers", () => {
    expect(getAbilityCoverage("Kaminaru").find((row) => row.name === "Lich Mark")?.status).toBe("modeled");
    expect(getAbilityCoverage("Kamigami").find((row) => row.name === "Lich Mark")?.status).toBe("modeled");
    expect(getAbilityCoverage("Okiamano").find((row) => row.name === "Lich Mark")?.status).toBe("modeled");
    expect(getAbilityCoverage("Astolo").find((row) => row.name === "Lich Mark")?.status).toBe("modeled");
    expect(getAbilityCoverage("Clovilowper").find((row) => row.name === "Lich Mark")?.status).toBe("modeled");
    expect(getAbilityCoverage("Clovilowper").find((row) => row.name === "Lich Mark")?.detail).toContain("Value Slowed");
    expect(getAbilityCoverage("Paru-Gama").find((row) => row.name === "Lich Mark")?.status).toBe("modeled");
    expect(getAbilityCoverage("Paru-Gama").find((row) => row.name === "Lich Mark")?.detail).toContain("Value Blurred Vision");
  });

  it("keeps Noxulumen Two-Faced modeled even if the effects catalog missed it", () => {
    expect(getAbilityCoverage("Noxulumen").find((row) => row.name === "Two-Faced")?.status).toBe("modeled");
  });

  it("keeps Orneep Injury Attack modeled via runtime status-attack backfill", () => {
    const injuryAttack = getAbilityCoverage("Orneep").find((row) => row.name === "Injury Attack");
    expect(injuryAttack?.status).toBe("modeled");
    expect(injuryAttack?.detail).toBe("Attack Injury +2");
  });

  it("shows the Unbreakable cap value in coverage rows", () => {
    const unbreakable = getAbilityCoverage("Oxidaizen").find((row) => row.name === "Unbreakable (12)");

    expect(unbreakable?.status).toBe("modeled");
  });

  it("marks Turrim Heliolyth's Judgement as modeled", () => {
    const rows = getAbilityCoverage("Turrim");

    expect(rows.find((row) => row.name === "Heliolyth's Judgement")?.status).toBe("modeled");
  });

  it("marks Militrua Channeling / Overcharged as out-of-model despite an unimplemented catalog def", () => {
    // Regression: Channeling carries a catalog `def`
    // (conditionalAuraStatusPulse) so collectModeledAbilityNames listed it as
    // "modeled", but the Rust engine has no Channeling handler and the
    // Reference declares it out-of-model. The authored Reference out-of-model
    // set now overrides the catalog heuristic.
    const rows = getAbilityCoverage("Militrua");
    expect(rows.find((row) => row.name === "Channeling")?.status).toBe("out-of-model");
    expect(rows.find((row) => row.name === "Overcharged")?.status).toBe("out-of-model");
  });

  it.each([
    ["Vulturobo", "Plasma Beam"],
  ])("marks %s %s as not modeled", (creatureName, abilityName) => {
    const rows = getAbilityCoverage(creatureName);

    expect(rows.find((row) => row.name === abilityName)?.status).toBe("not-modeled");
  });
});

