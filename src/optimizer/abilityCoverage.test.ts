import { describe, expect, it } from "vitest";
import { computeAbilityCoverageSummary, getAbilityCoverage } from "./abilityCoverage";
import { creaturesData } from "../engine/creatureData";
import { REFERENCE_ABILITY_SCOPE } from "../pages/referenceContent";
import { normalizeAbilityName } from "../shared/abilityNameAliases";

const REFERENCE_ABILITY_SCOPE_NAMES = new Set(
  [...REFERENCE_ABILITY_SCOPE.keys()].map(normalizeAbilityName),
);
const REFERENCE_NAMES_LONGEST_FIRST = [...REFERENCE_ABILITY_SCOPE.keys()].sort(
  (left, right) => right.length - left.length,
);

/** Mirrors the variant handling in abilityCoverage: full name, parenthetical
 * stripped, or a base entry the name extends. */
function referenceKnows(name: string): boolean {
  if (REFERENCE_ABILITY_SCOPE_NAMES.has(normalizeAbilityName(name))) return true;
  const stripped = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (REFERENCE_ABILITY_SCOPE_NAMES.has(normalizeAbilityName(stripped))) return true;
  return REFERENCE_NAMES_LONGEST_FIRST.some((entry) => name.startsWith(`${entry} `));
}

describe("ability coverage module", () => {
  it("returns sane aggregate counters", () => {
    const summary = computeAbilityCoverageSummary();
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.applied).toBeGreaterThanOrEqual(0);
    expect(summary.partial).toBeGreaterThanOrEqual(0);
    expect(summary.speedBuildsOnly).toBeGreaterThanOrEqual(0);
    expect(summary.outOfModel).toBeGreaterThanOrEqual(0);
    expect(summary.unresolved).toBeGreaterThanOrEqual(0);
    expect(
      summary.applied +
        summary.partial +
        summary.speedBuildsOnly +
        summary.outOfModel +
        summary.unresolved,
    ).toBe(summary.total);
  });

  it("returns normalized statuses for creature ability rows", () => {
    const creatureName = creaturesData[0]?.name;
    expect(creatureName).toBeTruthy();
    if (!creatureName) return;

    const rows = getAbilityCoverage(creatureName);
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(["modeled", "partial", "speed-builds-only", "out-of-model", "not-modeled"]).toContain(
        row.status,
      );
    }
  });

  // Both used to read "partial" off a hand list that carried a routing fact
  // under a label's name. The Reference calls Reflux Modeled and Gourmandizer
  // Compare-only, and the label follows the entry now; the engine still routes
  // both (abilityRegistry's routedDespitePartialModel).
  it("marks Gholbini Reflux and Gourmandizer as modeled, the way their entries read", () => {
    const rows = getAbilityCoverage("Gholbini");

    expect(rows.find((row) => row.name === "Reflux")?.status).toBe("modeled");
    expect(rows.find((row) => row.name === "Gourmandizer")?.status).toBe("modeled");
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

  it("marks Vulturobo Plasma Beam as modeled - it is the creature's breath and fires via toRustBreathProfile", () => {
    // Plasma Beam is a breath (stats.breath = "Plasma Beam"), modeled as the
    // plasma_beam special kind. It is also in NOT_MODELED_ABILITIES as a
    // standalone ability name, but the breath route is checked first, so a
    // creature that actually carries it as its breath reads "modeled".
    const rows = getAbilityCoverage("Vulturobo");

    expect(rows.find((row) => row.name === "Plasma Beam")?.status).toBe("modeled");
  });

  it("derives modeled from the Reference: compare-toggle + base-name (value variant) abilities", () => {
    // A Compare-toggle ability is modeled (the toggle simulates it; the effect
    // is just opt-in, not unmodeled). Reference-derived, no hand list.
    expect(getAbilityCoverage("Angelic Warden").find((r) => r.name.startsWith("Broodwatcher"))?.status).toBe("modeled");
    // "Base (Variant)" is ONE ability whose parenthetical is a value: it matches
    // its single base Reference entry (Aura), regardless of the variant.
    expect(getAbilityCoverage("Kehmador").find((r) => r.name.startsWith("Aura"))?.status).toBe("modeled");
  });

  it("marks generic-channel damage trails (Radiation / Necropoison) as modeled", () => {
    // Regression: these are modeled by the engine's generic trail channel
    // (GENERIC_TRAIL_STATUS) but were greyed because MODELED_OTHER_ABILITIES
    // only listed the four dedicated flavor trails (Flame/Frost/Plague/Toxic).
    const radiation = getAbilityCoverage("Zeoarex").find((row) => row.name.startsWith("Radiation Trail"));
    expect(radiation?.status).toBe("modeled");
    const necropoison = getAbilityCoverage("Glysgadota").find((row) => row.name.startsWith("Necropoison Trail"));
    expect(necropoison?.status).toBe("modeled");
  });

  it("normalizeAbilityName is idempotent and matches the shared normalizer across every dataset ability name", async () => {
    const { normalizeAbilityName } = await import("./abilityCoverageRegistry");
    const { normalizeAbilityDisplayName } = await import("../shared/abilityNameAliases");
    const names = new Set<string>();
    for (const creature of creaturesData) {
      for (const ability of [
        ...(creature.passiveAbilities ?? []),
        ...(creature.activatedAbilities ?? []),
        ...(creature.breathAbilities ?? []),
      ]) {
        names.add(ability.name);
      }
    }
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) {
      const normalized = normalizeAbilityName(name);
      expect(normalizeAbilityName(normalized)).toBe(normalized);
      expect(normalized).toBe(normalizeAbilityDisplayName(name));
    }
  });

  it("invalidates the per-creature coverage cache when a custom creature is edited", async () => {
    const { registerCustomCreatureRecord } = await import("../engine/customCreatures");
    const name = "__CoverageCacheEditCreature__";
    const stats = { tier: 1, health: 1000, weight: 1000, damage: 100, biteCooldown: 1, healthRegen: 1 };

    await registerCustomCreatureRecord(
      { creature: { name, stats, passiveAbilities: [{ abilityId: "Block Bleed", name: "Block Bleed", value: 0.5, semantics: "block", subtype: null }] }, effects: {} },
      { replace: true },
    );
    let rows = getAbilityCoverage(name);
    expect(rows.some((r) => r.name === "Block Bleed")).toBe(true);

    // Edit: swap the ability. Without cache invalidation the old row would stick.
    await registerCustomCreatureRecord(
      { creature: { name, stats, passiveAbilities: [{ abilityId: "Block Burn", name: "Block Burn", value: 0.5, semantics: "block", subtype: null }] }, effects: {} },
      { replace: true },
    );
    rows = getAbilityCoverage(name);
    expect(rows.some((r) => r.name === "Block Burn")).toBe(true);
    expect(rows.some((r) => r.name === "Block Bleed")).toBe(false);
  });

  it("surfaces Statuses-tab effects as their own kind-tagged chips without duplicating ability-backed rows", async () => {
    const { ensureCustomCreatureCatalogBridge } = await import("../engine/customCreatureCatalogBridge");
    const { registerEphemeralCustomCreature } = await import("../engine/customCreatures");
    ensureCustomCreatureCatalogBridge();
    registerEphemeralCustomCreature({
      creature: {
        name: "__CoverageStatusTabCreature__",
        stats: { tier: 1, health: 1000, weight: 1000, damage: 100, biteCooldown: 1 },
        // A backing ability AND a tab status: the ability must show once, no dup.
        passiveAbilities: [
          { abilityId: "Block Bleed", name: "Block Bleed", value: 0.5, semantics: "block", subtype: null },
        ],
      } as never,
      effects: {
        applyStatusOnHit: [{ statusId: "Aftershock", stacks: 1, sourceAbility: "" }],
        resistStatus: [{ statusId: "Aftershock", fraction: 0.25, sourceAbility: "" }],
      } as never,
      appetite: null,
      iconName: null,
    });

    const rows = getAbilityCoverage("__CoverageStatusTabCreature__");
    const names = rows.map((r) => r.name);
    // Tab statuses appear, tagged with their kind.
    expect(names).toContain("Aftershock (Offensive)");
    expect(names).toContain("Aftershock (Block / Resist)");
    // The ability-backed Block Bleed shows once (as the ability), not also as a
    // duplicate "Bleed (Block / Resist)" explicit chip.
    expect(names).toContain("Block Bleed");
    expect(names).not.toContain("Bleed (Block / Resist)");
  });

  // Gale was on twelve creatures with no Reference entry at all, which is how it
  // ended up in a hand list nothing kept in step. The label comes from the entry
  // now, so an ability with no entry and no auto-detected effect reads
  // "not-modeled" because nothing decided rather than because someone did. This
  // is the gate that names those before a reader sees one.
  //
  // Generic families - "Block Bleed", "Poison Attack", "Defensive Burn" - are
  // deliberately absent from the Reference: they are the status catalog wearing
  // an ability name, and the auto-detection resolves every one of them.
  it("no ability on a real creature is labelled by default rather than by decision", () => {
    const undecided = new Set<string>();
    for (const creature of creaturesData) {
      for (const row of getAbilityCoverage(creature.name)) {
        if (row.status !== "not-modeled") continue;
        if (referenceKnows(row.name)) continue;
        undecided.add(row.name);
      }
    }
    expect(
      [...undecided].sort(),
      "These abilities are on real creatures, have no Reference entry, and nothing detects them " +
        "either, so Compare shows 'not-modeled' with no one having said so. Add an entry in " +
        "src/pages/referenceContent.ts.",
    ).toEqual([]);
  });
});
