import { describe, expect, it } from "vitest";
import { creatureByName } from "./creatureData";
import { breathSpecs } from "./data";
import { MODELED_ABILITY_REFERENCE_DRAFTS } from "../pages/referenceContent";

// The ONE place live game data is checked on purpose. Behavioral tests own their
// inputs (synthetic fixtures); this asserts SCHEMA/SHAPE invariants over the
// whole live roster - properties that must hold for the engine to read the data
// at all, regardless of the exact numbers - so a routine wiki sync that merely
// changes values never reds it, but a sync that produces structurally BROKEN
// data (a dropped stat, a NaN, a wrong-typed value) does, loudly and in one place.
// See docs/data_refresh.md ("Tests and data coupling").
//
// NOT checked here: that a listed ability "has a value". A null ability value is
// a legitimate state - the wiki lists some abilities with no value to mean the
// creature effectively doesn't have it (e.g. Veishyadar's phantom Shadow
// Barrage), and the engine correctly treats that as absent. "Present => has a
// value" is therefore not an invariant, and asserting it would false-flag a
// legitimate, permanent data shape.

// Stat fields the engine reads directly; a missing / NaN one corrupts the whole
// simulation, so each must be a finite number on every creature.
const REQUIRED_STATS = ["tier", "health", "weight", "damage", "biteCooldown"] as const;

describe("creature data integrity", () => {
  const creatures = Object.values(creatureByName);

  it("every creature has finite required stats (tier/health/weight/damage/biteCooldown)", () => {
    const offenders: string[] = [];
    for (const creature of creatures) {
      const stats = creature.stats as Record<string, unknown>;
      for (const key of REQUIRED_STATS) {
        const value = stats?.[key];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          offenders.push(`${creature.name}.${key} = ${JSON.stringify(value)}`);
        }
      }
    }
    expect(
      offenders,
      "creatures with a missing or non-finite required stat - the engine would propagate NaN. Fix the scraped data.",
    ).toEqual([]);
  });

  it("every ability value is null, a finite number, or a string (well-typed)", () => {
    const offenders: string[] = [];
    for (const creature of creatures) {
      const abilities = [
        ...(creature.passiveAbilities ?? []),
        ...(creature.activatedAbilities ?? []),
        ...(creature.breathAbilities ?? []),
      ];
      for (const ability of abilities) {
        const value = ability.value;
        const wellTyped =
          value === null || (typeof value === "number" && Number.isFinite(value)) || typeof value === "string";
        if (!wellTyped) {
          offenders.push(`${creature.name} / ${ability.name} value = ${JSON.stringify(value)}`);
        }
      }
    }
    expect(
      offenders,
      "ability values must be null | finite number | string - anything else (NaN, object, undefined) is a " +
        "corrupted scrape that the engine can't read. Fix the scraped data.",
    ).toEqual([]);
  });
});

// A breath's capacity and its refill rate are the two numbers that decide how
// much a breath contributes over a whole fight, and the entries state both. The
// engine reads them from `breath_specs.runtime.json`, so a wiki sync that moves
// either one silently makes the Reference wrong. This is the seam that catches
// it: the prose and the data are diffed, not pinned.
describe("breath entries state the capacity and refill the engine runs on", () => {
  const trim = (n: number) => String(Number(n.toFixed(4)));

  it("every spec-backed breath entry quotes its own capacity and refill rate", () => {
    const offenders: string[] = [];
    for (const spec of breathSpecs) {
      const capacity = spec.stats?.capacity;
      const regenRate = spec.stats?.regenRate;
      if (!capacity || !regenRate) continue;

      const entry = MODELED_ABILITY_REFERENCE_DRAFTS.find((draft) => draft.name === spec.name);
      if (!entry) {
        offenders.push(`${spec.name}: no Reference entry`);
        continue;
      }
      const prose = entry.mechanics.join(" ");
      if (!prose.includes(`${trim(capacity)} seconds of firing`)) {
        offenders.push(`${spec.name}: entry does not state capacity ${trim(capacity)}`);
      }
      if (!prose.includes(`1 unit every ${trim(regenRate)} seconds`)) {
        offenders.push(`${spec.name}: entry does not state a refill of 1 unit every ${trim(regenRate)} seconds`);
      }
      if (!prose.includes(`takes ${trim(capacity * regenRate)} seconds to refill`)) {
        offenders.push(`${spec.name}: entry does not state a full refill of ${trim(capacity * regenRate)} seconds`);
      }
    }
    expect(
      offenders,
      "A breath entry has to carry the capacity and refill rate the engine reads for it. Update the entry in " +
        "src/pages/referenceContent.ts to match data/breath_specs.runtime.json.",
    ).toEqual([]);
  });
});

describe("Charge", () => {
  it("carries one of the five kinds the entry names", () => {
    // [REF:ability_charge]
    // Bullet 1: "A creature carrying Charge carries one kind of it: Power,
    // Gore, Launch, Crush or Throw." The kind is the ability's value, and the
    // entry says what each one lands, so a sixth kind arriving in a wiki sync
    // would leave its carriers described by nothing.
    const KINDS = new Set(["Power", "Gore", "Launch", "Crush", "Throw"]);
    const offenders: string[] = [];
    let seen = 0;
    for (const [name, creature] of Object.entries(creatureByName)) {
      const abilities = [
        ...(creature.passiveAbilities ?? []),
        ...(creature.activatedAbilities ?? []),
        ...(creature.breathAbilities ?? []),
      ];
      for (const ability of abilities) {
        if (ability.name !== "Charge") continue;
        seen += 1;
        if (!KINDS.has(String(ability.value))) {
          offenders.push(`${name}: Charge value ${String(ability.value)}`);
        }
      }
    }
    expect(seen, "no creature carries Charge - the check would pass on an empty set").toBeGreaterThan(0);
    expect(
      offenders,
      "Charge's kind decides what it lands. A value the Charge entry does not name leaves its " +
        "carriers with nothing describing them - add the kind to the entry in referenceContent.ts.",
    ).toEqual([]);
  });
});
