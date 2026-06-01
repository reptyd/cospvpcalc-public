/**
 * Tests for the TS↔Rust bridge converter. Three impedance
 * mismatches the Rust contract enforces silently — undetected by
 * `customAbilityRegistration.test.ts` because that suite mocks the
 * bridge entirely. Each case here failed silently in production
 * before this converter was added:
 *
 *   1. `timing_mode_override` enum value: snake_case → camelCase
 *      (Rust `SimpleAbilityTimingMode` is `#[serde(rename_all = "camelCase")]`).
 *   2. `apply_status_to_target.status` field names: `status_id` →
 *      `statusId`, `source_ability` → `sourceAbility` (Rust
 *      `SimpleAppliedStatus` has explicit `#[serde(rename = …)]`).
 *   3. WASM return values: `serde_wasm_bindgen` maps Rust BTreeMap
 *      to JS Map. UI does `.id` lookups → undefined.
 *
 * The converter is a recursive walker — these tests exercise it on
 * deeply nested structures (apply_status inside conditional inside
 * schedule) to catch any "only renames at top level" regression.
 */
import { describe, expect, it } from "vitest";
import {
  __test_specForRust as specForRust,
  __test_convertMaps as convertMaps,
} from "./customAbilityBridge";
import type { UserAbilitySpec } from "./customAbilityTypes";

function baseSpec(overrides: Partial<UserAbilitySpec> = {}): UserAbilitySpec {
  return {
    id: "user.test",
    display_name: "Test",
    utility: { kind: "const", value: 1 },
    is_available: { kind: "const", value: 1 },
    on_fire: {
      name: "Fire",
      effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 1 }],
    },
    ...overrides,
  };
}

describe("specForRust — timing_mode_override", () => {
  it("converts really_fast → reallyFast", () => {
    const out = specForRust(
      baseSpec({ timing_mode_override: "really_fast" }),
    ) as { timing_mode_override: string };
    expect(out.timing_mode_override).toBe("reallyFast");
  });

  it("converts semi_ideal → semiIdeal", () => {
    const out = specForRust(
      baseSpec({ timing_mode_override: "semi_ideal" }),
    ) as { timing_mode_override: string };
    expect(out.timing_mode_override).toBe("semiIdeal");
  });

  it.each(["fast", "ideal", "extreme"] as const)(
    "passes through %s unchanged (already matches Rust camelCase)",
    (mode) => {
      const out = specForRust(
        baseSpec({ timing_mode_override: mode }),
      ) as { timing_mode_override: string };
      expect(out.timing_mode_override).toBe(mode);
    },
  );

  it("leaves spec without timing_mode_override untouched", () => {
    const out = specForRust(baseSpec()) as Record<string, unknown>;
    expect(out.timing_mode_override).toBeUndefined();
  });

  it("preserves timing_user_override unchanged (no value mangling)", () => {
    const out = specForRust(
      baseSpec({ timing_user_override: "user.aggressive" }),
    ) as { timing_user_override: string };
    expect(out.timing_user_override).toBe("user.aggressive");
  });
});

describe("specForRust — SimpleAppliedStatus rename", () => {
  it("renames status_id → statusId on apply_status_to_target", () => {
    const out = specForRust(
      baseSpec({
        on_fire: {
          name: "Fire",
          effects: [
            {
              kind: "apply_status_to_target",
              target: "opponent",
              status: { status_id: "Burn_Status", stacks: 2, source_ability: null },
            },
          ],
        },
      }),
    ) as {
      on_fire: { effects: Array<{ status: Record<string, unknown> }> };
    };
    const status = out.on_fire.effects[0].status;
    expect(status.statusId).toBe("Burn_Status");
    expect(status.status_id).toBeUndefined();
    expect(status.stacks).toBe(2);
  });

  it("renames source_ability → sourceAbility when set, drops when null", () => {
    const setOut = specForRust(
      baseSpec({
        on_fire: {
          name: "Fire",
          effects: [
            {
              kind: "apply_status_to_target",
              target: "caster",
              status: {
                status_id: "Buff",
                stacks: 1,
                source_ability: "user.parent_ability",
              },
            },
          ],
        },
      }),
    ) as {
      on_fire: { effects: Array<{ status: Record<string, unknown> }> };
    };
    expect(setOut.on_fire.effects[0].status.sourceAbility).toBe("user.parent_ability");
    expect(setOut.on_fire.effects[0].status.source_ability).toBeUndefined();

    const nullOut = specForRust(
      baseSpec({
        on_fire: {
          name: "Fire",
          effects: [
            {
              kind: "apply_status_to_target",
              target: "caster",
              status: { status_id: "Buff", stacks: 1, source_ability: null },
            },
          ],
        },
      }),
    ) as {
      on_fire: { effects: Array<{ status: Record<string, unknown> }> };
    };
    expect(nullOut.on_fire.effects[0].status.sourceAbility).toBeUndefined();
    expect(nullOut.on_fire.effects[0].status.source_ability).toBeUndefined();
  });

  it("does NOT rename status_id on ClearStatus (direct field, snake_case in Rust)", () => {
    const out = specForRust(
      baseSpec({
        on_fire: {
          name: "Fire",
          effects: [
            {
              kind: "clear_status",
              target: "caster",
              status_id: "Burn_Status",
            },
          ],
        },
      }),
    ) as {
      on_fire: { effects: Array<Record<string, unknown>> };
    };
    expect(out.on_fire.effects[0].status_id).toBe("Burn_Status");
    expect(out.on_fire.effects[0].statusId).toBeUndefined();
  });

  it("renames inside conditional → repeat → schedule (deeply nested)", () => {
    // Eclipse Contest-style nesting: apply_status three levels deep
    // inside an if/else inside a schedule. Verifies the recursive
    // walker descends through C-block effects (then / otherwise /
    // body / effects) and still hits the SimpleAppliedStatus.
    const out = specForRust(
      baseSpec({
        on_fire: {
          name: "Fire",
          effects: [
            {
              kind: "schedule_effect",
              delay_sec: 6,
              effects: [
                {
                  kind: "conditional",
                  cond: { kind: "const", value: 1 },
                  then: [
                    {
                      kind: "repeat",
                      count: 3,
                      body: [
                        {
                          kind: "apply_status_to_target",
                          target: "opponent",
                          status: {
                            status_id: "Shock_Status",
                            stacks: 1,
                            source_ability: null,
                          },
                        },
                      ],
                    },
                  ],
                  otherwise: [
                    {
                      kind: "apply_status_to_target",
                      target: "caster",
                      status: {
                        status_id: "Confusion_Status",
                        stacks: 1,
                        source_ability: null,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    ) as Record<string, unknown>;
    const json = JSON.stringify(out);
    // Both nested apply_status payloads must end up as statusId.
    // No surviving `"status_id":"Shock_Status"` (the apply_status_to_target
    // payload). ClearStatus would survive — but this fixture has none.
    expect(json).toContain('"statusId":"Shock_Status"');
    expect(json).toContain('"statusId":"Confusion_Status"');
    expect(json).not.toMatch(/"status_id":"Shock_Status"/);
    expect(json).not.toMatch(/"status_id":"Confusion_Status"/);
  });

  it("renames inside trigger hooks (on_take_damage, on_round_start, on_tick)", () => {
    const status = {
      kind: "apply_status_to_target",
      target: "caster",
      status: { status_id: "Mark", stacks: 1, source_ability: null },
    } as const;
    const out = specForRust(
      baseSpec({
        triggers: {
          on_round_start: { name: "rs", effects: [status] },
          on_take_damage: { name: "td", effects: [status] },
          on_tick: {
            interval_sec: 1,
            effects: { name: "tick", effects: [status] },
          },
        },
      }),
    ) as Record<string, unknown>;
    const json = JSON.stringify(out);
    // Three occurrences (one per trigger), all converted.
    expect((json.match(/"statusId":"Mark"/g) ?? []).length).toBe(3);
    expect(json).not.toMatch(/"status_id":"Mark"/);
  });
});

describe("specForRust — JSON.stringify round-trip", () => {
  it("produces a JSON string the Rust contract would accept", () => {
    // Eclipse-Contest-shaped sanity: timing_mode + nested apply_status.
    // We check the JSON shape directly because that's what the
    // Rust deserializer sees.
    const out = specForRust(
      baseSpec({
        timing_mode_override: "really_fast",
        on_fire: {
          name: "Eclipse",
          effects: [
            {
              kind: "apply_status_to_target",
              target: "opponent",
              status: {
                status_id: "Shock_Status",
                stacks: 1,
                source_ability: null,
              },
            },
          ],
        },
      }),
    );
    const json = JSON.stringify(out);
    expect(json).toContain('"timing_mode_override":"reallyFast"');
    expect(json).toContain('"statusId":"Shock_Status"');
    // Rust struct field stays snake_case — only the enum VALUE is camelCase.
    expect(json).not.toContain('"timingModeOverride"');
  });
});

describe("convertMaps", () => {
  it("converts a top-level Map to a plain object", () => {
    const input = new Map<string, unknown>([
      ["ok", true],
      ["id", "user.x"],
      ["display_name", "X"],
    ]);
    const out = convertMaps(input) as Record<string, unknown>;
    expect(out.id).toBe("user.x");
    expect(out.ok).toBe(true);
    expect(out.display_name).toBe("X");
  });

  it("recursively unwraps nested Maps inside arrays and objects", () => {
    // Mimics what serde_wasm_bindgen returns for a list of objects:
    // an Array<Map>, where each Map has Map values. UI code does
    // `list.value[0].id` so this must come out fully plain.
    const inner = new Map<string, unknown>([
      ["id", "user.a"],
      ["display_name", "A"],
    ]);
    const out = convertMaps([inner, inner]) as Array<Record<string, unknown>>;
    expect(Array.isArray(out)).toBe(true);
    expect(out[0].id).toBe("user.a");
    expect(out[1].display_name).toBe("A");
  });

  it("passes through primitives and plain objects unchanged in shape", () => {
    expect(convertMaps(null)).toBe(null);
    expect(convertMaps(undefined)).toBe(undefined);
    expect(convertMaps(42)).toBe(42);
    expect(convertMaps("hello")).toBe("hello");
    expect(convertMaps(true)).toBe(true);
    const obj = { a: 1, b: [2, 3] };
    expect(convertMaps(obj)).toEqual(obj);
  });
});
