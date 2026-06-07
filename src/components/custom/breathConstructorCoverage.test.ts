import { describe, expect, it } from "vitest";
import {
  ALL_BREATH_PROFILE_FIELDS,
  type CustomBreathProfile,
} from "../../engine/types";
import { normalizeCustomCreaturePayload } from "../../engine/customCreatureValidation";
import { BREATH_EDITOR_FIELDS } from "./BreathProfileEditor";

/**
 * Constructor-coverage + round-trip lock for custom breath.
 *
 * Two guarantees, mirroring the ability-effect coverage lock:
 *  1. Coverage - every `CustomBreathProfile` field is reachable in
 *     `BreathProfileEditor` (no JSON-only corners). `ALL_BREATH_PROFILE_FIELDS`
 *     derives from a compile-time-exhaustive registry, so adding a field to
 *     the type fails the build until classified, and the coverage test fails
 *     until a control is wired.
 *  2. Round-trip - a fully-populated profile survives the real save path
 *     (`normalizeCustomCreaturePayload` → `normalizeCreature` carry-through →
 *     `normalizeCustomBreathProfile` field rebuild) without losing a field.
 *     Both of those are field-by-field rebuilds that have silently dropped
 *     new fields in the past (see the userAbilityIds / customBreathProfile
 *     comments in customCreatureValidation.ts), so this is the regression
 *     guard for that whole class of bug.
 */

/** A profile with every field set to a distinct, finite, round-trippable
 *  value. Kept exhaustive by the keys assertion below. */
const FULLY_POPULATED_PROFILE: CustomBreathProfile = {
  dpsPct: 7,
  capacity: 12,
  regenRate: 9,
  critChancePct: 15,
  chain: 3,
  chainMaxStacks: 5,
  specialKind: "lance",
  selfHealPct: 4,
  cleanseStacks: 2,
  lanceDamagePct: 30,
  lanceChargeSec: 1.5,
  lanceCooldownSec: 8,
  lanceStatusId: "Burn_Status",
  autoFireDelaySec: 2.5,
  autoFireCooldownSec: 6,
  chargesMax: 4,
  chargeRegenSec: 10,
  specialStatuses: [{ statusId: "user.test_proc", stacks: 2 }],
};

describe("Custom-breath constructor coverage", () => {
  it("exposes a control for every schema field (no JSON-only corners)", () => {
    const missing = ALL_BREATH_PROFILE_FIELDS.filter(
      (field) => !BREATH_EDITOR_FIELDS.has(field),
    );
    expect(missing).toEqual([]);
  });

  it("exposes no controls for unknown fields", () => {
    const known = new Set<string>(ALL_BREATH_PROFILE_FIELDS);
    const extra = [...BREATH_EDITOR_FIELDS].filter((field) => !known.has(field));
    expect(extra).toEqual([]);
  });

  it("the round-trip fixture covers every field (stays exhaustive)", () => {
    expect(Object.keys(FULLY_POPULATED_PROFILE).sort()).toEqual(
      [...ALL_BREATH_PROFILE_FIELDS].sort(),
    );
  });
});

describe("Custom-breath save-path round-trip", () => {
  it("preserves every field through normalizeCustomCreaturePayload", () => {
    const result = normalizeCustomCreaturePayload({
      creature: {
        name: "Breath Round-trip Carrier",
        stats: {
          tier: 4,
          health: 1000,
          weight: 100,
          damage: 50,
          biteCooldown: 2,
          breath: "Custom",
        },
        customBreathProfile: FULLY_POPULATED_PROFILE,
      },
      effects: {},
    });

    expect(result.ok).toBe(true);
    expect(result.payload?.creature.customBreathProfile).toEqual(
      FULLY_POPULATED_PROFILE,
    );
  });
});
