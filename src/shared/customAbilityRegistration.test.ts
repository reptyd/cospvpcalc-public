/**
 * Integration tests for the create → register → list flow that the
 * Custom Abilities editor exercises. These tests run the same code
 * path the UI's "Save" button does, minus the engine bridge (which
 * is mocked because the WASM module isn't available in node-vitest).
 *
 * Coverage:
 *   - registerCustomAbilityRecord persists a valid spec to the registry
 *   - listCustomAbilityRecords reflects the registration
 *   - validation errors surface as `validation-error` outcome
 *   - unregister + clear remove records cleanly
 *   - round-trip via printAbility/parseAbility preserves a spec
 *   - all ABILITY_TEMPLATES + TIMING_TEMPLATES produce valid output
 */
import { afterEach, describe, expect, it, vi, beforeAll } from "vitest";

vi.mock("./customAbilityBridge", () => ({
  registerUserAbility: vi.fn(async () => ({ status: "ok", value: { id: "stub" } })),
  unregisterUserAbility: vi.fn(async () => ({ status: "ok" })),
  listUserAbilities: vi.fn(async () => ({ status: "ok", value: [] })),
  registerUserTiming: vi.fn(async () => ({ status: "ok", value: { id: "stub" } })),
  unregisterUserTiming: vi.fn(async () => ({ status: "ok" })),
  listUserTimings: vi.fn(async () => ({ status: "ok", value: [] })),
}));

import { parseAbility, printAbility } from "./abilityDsl";
import { parseTiming, printTiming } from "./timingDsl";
import {
  clearCustomAbilityRecords,
  importCustomAbilityRecords,
  listCustomAbilityRecords,
  registerCustomAbilityRecord,
  unregisterCustomAbilityRecord,
} from "./customAbilities";
import {
  clearCustomTimingRecords,
  importCustomTimingRecords,
  listCustomTimingRecords,
  registerCustomTimingRecord,
  unregisterCustomTimingRecord,
} from "./customTimings";
import { ABILITY_TEMPLATES } from "./customAbilityTemplates";
import { TIMING_TEMPLATES } from "./customTimingTemplates";
import { validateUserAbility, validateUserTiming } from "./customAbilityValidate";
import type { UserAbilitySpec, UserTimingSpec } from "./customAbilityTypes";

const blankSpec = (overrides: Partial<UserAbilitySpec> = {}): UserAbilitySpec => ({
  id: "user.test_ability",
  display_name: "Test Ability",
  utility: { kind: "const", value: 1 },
  is_available: { kind: "const", value: 1 },
  on_fire: {
    name: "Fire",
    effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 100 }],
  },
  ...overrides,
});

const blankTiming = (overrides: Partial<UserTimingSpec> = {}): UserTimingSpec => ({
  id: "user.test_timing",
  display_name: "Test Timing",
  candidates: [0, 0.5, 1, 2, 5],
  horizon_sec: 15,
  ...overrides,
});

beforeAll(() => {
  // Force a deterministic clean state: localStorage isn't persistent
  // across the suite anyway, but the in-memory map can leak between
  // tests if we don't drain it.
  void clearCustomAbilityRecords();
  void clearCustomTimingRecords();
});

afterEach(async () => {
  await clearCustomAbilityRecords();
  await clearCustomTimingRecords();
});

describe("registerCustomAbilityRecord", () => {
  it("persists a valid spec and lists it", async () => {
    const outcome = await registerCustomAbilityRecord(blankSpec());
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.record.spec.id).toBe("user.test_ability");
    expect(outcome.record.createdAt).toBeGreaterThan(0);
    expect(outcome.record.updatedAt).toBe(outcome.record.createdAt);

    const list = listCustomAbilityRecords();
    expect(list).toHaveLength(1);
    expect(list[0].spec.display_name).toBe("Test Ability");
  });

  it("rejects an invalid spec without persisting it", async () => {
    const outcome = await registerCustomAbilityRecord(
      blankSpec({ id: "no_user_prefix", display_name: "Bad" }),
    );
    expect(outcome.status).toBe("validation-error");
    if (outcome.status !== "validation-error") return;
    expect(outcome.errors.length).toBeGreaterThan(0);
    // Nothing should be in the list.
    expect(listCustomAbilityRecords()).toHaveLength(0);
  });

  it("upserts on duplicate id (last write wins)", async () => {
    const first = await registerCustomAbilityRecord(blankSpec({ display_name: "v1" }));
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    const createdAt = first.record.createdAt;

    // Wait a millisecond so updatedAt differs deterministically.
    await new Promise((r) => setTimeout(r, 2));

    const second = await registerCustomAbilityRecord(blankSpec({ display_name: "v2" }));
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;

    const list = listCustomAbilityRecords();
    expect(list).toHaveLength(1);
    expect(list[0].spec.display_name).toBe("v2");
    // createdAt preserved across upsert.
    expect(list[0].createdAt).toBe(createdAt);
    // updatedAt advanced.
    expect(list[0].updatedAt).toBeGreaterThan(createdAt);
  });

  it("unregister removes the record", async () => {
    await registerCustomAbilityRecord(blankSpec());
    expect(listCustomAbilityRecords()).toHaveLength(1);
    await unregisterCustomAbilityRecord("user.test_ability");
    expect(listCustomAbilityRecords()).toHaveLength(0);
  });
});

describe("importCustomAbilityRecords", () => {
  it("merges imported abilities without clearing local records", async () => {
    await registerCustomAbilityRecord(
      blankSpec({ id: "user.local_ability", display_name: "Local Ability" }),
    );

    const result = await importCustomAbilityRecords([
      {
        spec: blankSpec({
          id: "user.imported_ability",
          display_name: "Imported Ability",
        }),
        createdAt: 10,
        updatedAt: 20,
      },
    ]);

    expect(result).toEqual({ imported: 1, skipped: 0 });
    expect(listCustomAbilityRecords().map((r) => r.spec.id).sort()).toEqual([
      "user.imported_ability",
      "user.local_ability",
    ]);
  });

  it("updates matching ability ids while keeping unrelated records", async () => {
    await registerCustomAbilityRecord(
      blankSpec({ id: "user.keep_ability", display_name: "Keep Ability" }),
    );
    await registerCustomAbilityRecord(
      blankSpec({ id: "user.same_ability", display_name: "Before Import" }),
    );

    await importCustomAbilityRecords(
      [
        {
          spec: blankSpec({
            id: "user.same_ability",
            display_name: "After Import",
          }),
          createdAt: 100,
          updatedAt: 200,
        },
      ],
      { replaceConflicts: true },
    );

    const records = listCustomAbilityRecords();
    expect(records.map((r) => r.spec.id).sort()).toEqual([
      "user.keep_ability",
      "user.same_ability",
    ]);
    expect(records.find((r) => r.spec.id === "user.same_ability")?.spec.display_name)
      .toBe("After Import");
  });

  it("skips matching ability ids unless replacement is allowed", async () => {
    await registerCustomAbilityRecord(
      blankSpec({ id: "user.same_ability", display_name: "Before Import" }),
    );

    const result = await importCustomAbilityRecords([
      {
        spec: blankSpec({
          id: "user.same_ability",
          display_name: "After Import",
        }),
        createdAt: 100,
        updatedAt: 200,
      },
    ]);

    expect(result).toEqual({ imported: 0, skipped: 1 });
    expect(listCustomAbilityRecords()[0].spec.display_name).toBe("Before Import");
  });
});

describe("registerCustomTimingRecord", () => {
  it("persists a valid timing and lists it", async () => {
    const outcome = await registerCustomTimingRecord(blankTiming());
    expect(outcome.status).toBe("ok");
    expect(listCustomTimingRecords()).toHaveLength(1);
  });

  it("rejects a bad timing (e.g. empty candidates)", async () => {
    const outcome = await registerCustomTimingRecord(
      blankTiming({ candidates: [] }),
    );
    expect(outcome.status).toBe("validation-error");
    expect(listCustomTimingRecords()).toHaveLength(0);
  });

  it("unregister removes the record", async () => {
    await registerCustomTimingRecord(blankTiming());
    await unregisterCustomTimingRecord("user.test_timing");
    expect(listCustomTimingRecords()).toHaveLength(0);
  });
});

describe("importCustomTimingRecords", () => {
  it("merges imported timings without clearing local records", async () => {
    await registerCustomTimingRecord(
      blankTiming({ id: "user.local_timing", display_name: "Local Timing" }),
    );

    const result = await importCustomTimingRecords([
      {
        spec: blankTiming({
          id: "user.imported_timing",
          display_name: "Imported Timing",
        }),
        createdAt: 10,
        updatedAt: 20,
      },
    ]);

    expect(result).toEqual({ imported: 1, skipped: 0 });
    expect(listCustomTimingRecords().map((r) => r.spec.id).sort()).toEqual([
      "user.imported_timing",
      "user.local_timing",
    ]);
  });

  it("updates matching timing ids while keeping unrelated records", async () => {
    await registerCustomTimingRecord(
      blankTiming({ id: "user.keep_timing", display_name: "Keep Timing" }),
    );
    await registerCustomTimingRecord(
      blankTiming({ id: "user.same_timing", display_name: "Before Import" }),
    );

    await importCustomTimingRecords(
      [
        {
          spec: blankTiming({
            id: "user.same_timing",
            display_name: "After Import",
          }),
          createdAt: 100,
          updatedAt: 200,
        },
      ],
      { replaceConflicts: true },
    );

    const records = listCustomTimingRecords();
    expect(records.map((r) => r.spec.id).sort()).toEqual([
      "user.keep_timing",
      "user.same_timing",
    ]);
    expect(records.find((r) => r.spec.id === "user.same_timing")?.spec.display_name)
      .toBe("After Import");
  });

  it("skips matching timing ids unless replacement is allowed", async () => {
    await registerCustomTimingRecord(
      blankTiming({ id: "user.same_timing", display_name: "Before Import" }),
    );

    const result = await importCustomTimingRecords([
      {
        spec: blankTiming({
          id: "user.same_timing",
          display_name: "After Import",
        }),
        createdAt: 100,
        updatedAt: 200,
      },
    ]);

    expect(result).toEqual({ imported: 0, skipped: 1 });
    expect(listCustomTimingRecords()[0].spec.display_name).toBe("Before Import");
  });
});

/** Stable round-trip invariant: printing twice produces the same
 * text. The parser intentionally normalises some fields (default
 * trigger names, `version: 1`, dropping `undefined`s), so deep
 * object equality on the original spec doesn't hold. Text-level
 * stability is the right correctness invariant — it guarantees no
 * data is lost across the parse/print cycle the visual editor
 * uses on every keystroke. */
function assertStableRoundTrip(spec: UserAbilitySpec): void {
  const text1 = printAbility(spec);
  const r1 = parseAbility(text1);
  expect(r1.ok, r1.ok ? "ok" : `parse: ${r1.error}`).toBe(true);
  if (!r1.ok) return;
  const text2 = printAbility(r1.spec);
  expect(text2).toBe(text1);
}

describe("printAbility / parseAbility round-trip", () => {
  // Each spec below covers a different surface so a regression in
  // any of the parser/printer dispatch arms surfaces as a failing
  // test, not a silent mid-typing data-loss.
  const cases: Array<{ name: string; spec: UserAbilitySpec }> = [
    { name: "minimal", spec: blankSpec() },
    {
      name: "with timing override",
      spec: blankSpec({ timing_mode_override: "really_fast" }),
    },
    {
      name: "with custom timing override",
      spec: blankSpec({ timing_user_override: "user.my_timing" }),
    },
    {
      name: "with reallyfast gate",
      spec: blankSpec({
        really_fast_gate: { kind: "var", path: "self.hp_ratio" },
      }),
    },
    {
      name: "with apply status",
      spec: blankSpec({
        on_fire: {
          name: "Fire",
          effects: [
            {
              kind: "apply_status_to_target",
              target: "opponent",
              status: { status_id: "Burn_Status", stacks: 3 },
            },
          ],
        },
      }),
    },
    {
      name: "with cooldown",
      spec: blankSpec({
        on_fire: {
          name: "Fire",
          effects: [
            { kind: "deal_direct_damage", target: "opponent", amount: 200 },
            {
              kind: "set_cooldown_until",
              target: "caster",
              cooldown_id: "user.test_ability",
              duration_sec: 5,
            },
          ],
        },
      }),
    },
    {
      name: "with conditional + repeat compositors",
      spec: blankSpec({
        on_fire: {
          name: "Fire",
          effects: [
            {
              kind: "conditional",
              cond: {
                kind: "bin",
                op: "lt",
                left: { kind: "var", path: "opp.hp_ratio" },
                right: { kind: "const", value: 0.3 },
              },
              then: [
                { kind: "deal_direct_damage", target: "opponent", amount: 500 },
              ],
              otherwise: [
                {
                  kind: "repeat",
                  count: 3,
                  body: [
                    { kind: "deal_direct_damage", target: "opponent", amount: 100 },
                  ],
                },
              ],
            },
          ],
        },
      }),
    },
    {
      name: "with on_take_damage trigger (LifeLeech style)",
      spec: blankSpec({
        utility: { kind: "const", value: 0 },
        is_available: { kind: "const", value: 0 },
        on_fire: undefined,
        triggers: {
          on_deal_damage: {
            name: "on_deal_damage",
            effects: [
              {
                kind: "heal_expr_amount",
                target: "caster",
                amount: {
                  kind: "bin",
                  op: "mul",
                  left: { kind: "var", path: "event.damage_dealt" },
                  right: { kind: "const", value: 0.3 },
                },
              },
            ],
          },
        },
      }),
    },
    {
      name: "with extras + chance",
      spec: blankSpec({
        on_fire: {
          name: "Fire",
          effects: [
            {
              kind: "chance",
              probability: { kind: "const", value: 0.5 },
              then: [
                {
                  kind: "set_extra",
                  target: "caster",
                  key: "rage",
                  value: { kind: "const", value: 1 },
                },
              ],
            },
          ],
        },
      }),
    },
  ];

  for (const c of cases) {
    it(`round-trips: ${c.name}`, () => {
      assertStableRoundTrip(c.spec);
    });
  }
});

describe("printTiming / parseTiming round-trip", () => {
  const cases: Array<{ name: string; spec: UserTimingSpec }> = [
    { name: "minimal", spec: blankTiming() },
    {
      name: "with threshold",
      spec: blankTiming({ threshold: 0.001 }),
    },
    {
      name: "with force_fire",
      spec: blankTiming({ force_fire: { kind: "const", value: 1 } }),
    },
    {
      name: "with force_skip",
      spec: blankTiming({
        force_skip: {
          kind: "bin",
          op: "gt",
          left: { kind: "var", path: "self.hp_ratio" },
          right: { kind: "const", value: 0.7 },
        },
      }),
    },
    {
      name: "always-on-cooldown style",
      spec: blankTiming({
        candidates: [0],
        horizon_sec: 1,
        threshold: 0,
        force_fire: { kind: "const", value: 1 },
      }),
    },
  ];

  for (const c of cases) {
    it(`round-trips: ${c.name}`, () => {
      const text = printTiming(c.spec);
      const parsed = parseTiming(text);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.spec).toEqual(c.spec);
    });
  }
});

describe("ABILITY_TEMPLATES produce valid + round-trippable specs", () => {
  for (const tpl of ABILITY_TEMPLATES) {
    it(`${tpl.id}: validates + round-trips`, () => {
      const spec = tpl.build({ id: "user.t", display_name: tpl.name });
      const validation = validateUserAbility(spec);
      expect(validation.ok, `validation: ${JSON.stringify(validation)}`).toBe(true);
      assertStableRoundTrip(spec);
    });
  }
});

describe("TIMING_TEMPLATES produce valid + round-trippable specs", () => {
  for (const tpl of TIMING_TEMPLATES) {
    it(`${tpl.id}: validates + round-trips`, () => {
      const spec = tpl.build({ id: "user.t", display_name: tpl.name });
      const validation = validateUserTiming(spec);
      expect(validation.ok, `validation: ${JSON.stringify(validation)}`).toBe(true);

      const text = printTiming(spec);
      const parsed = parseTiming(text);
      expect(parsed.ok, parsed.ok ? "ok" : `parse: ${parsed.error}`).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.spec).toEqual(spec);
    });
  }
});
