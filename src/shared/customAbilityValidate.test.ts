import { describe, expect, it } from "vitest";
import {
  validateUserAbility,
  validateUserStatus,
  validateUserTiming,
} from "./customAbilityValidate";
import type {
  UserAbilitySpec,
  UserStatusSpec,
  UserTimingSpec,
} from "./customAbilityTypes";

function sampleAbility(overrides: Partial<UserAbilitySpec> = {}): UserAbilitySpec {
  return {
    id: "user.test_ability",
    display_name: "Test Ability",
    utility: { kind: "const", value: 1 },
    is_available: { kind: "const", value: 1 },
    on_fire: {
      name: "Test",
      effects: [
        { kind: "deal_direct_damage", target: "opponent", amount: 100 },
      ],
    },
    ...overrides,
  };
}

function sampleTiming(overrides: Partial<UserTimingSpec> = {}): UserTimingSpec {
  return {
    id: "user.test_timing",
    display_name: "Test Timing",
    candidates: [0.0, 0.5, 1.5],
    horizon_sec: 12,
    ...overrides,
  };
}

describe("validateUserAbility", () => {
  it("accepts a minimal valid spec", () => {
    expect(validateUserAbility(sampleAbility())).toEqual({ ok: true });
  });

  it("rejects missing user. namespace", () => {
    const result = validateUserAbility(sampleAbility({ id: "builtin.cheat" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /namespace/i.test(e))).toBe(true);
    }
  });

  it("rejects empty display_name", () => {
    const result = validateUserAbility(sampleAbility({ display_name: "  " }));
    expect(result.ok).toBe(false);
  });

  it("rejects empty effect list", () => {
    const result = validateUserAbility(
      sampleAbility({ on_fire: { name: "x", effects: [] } }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects negative damage in effects", () => {
    const result = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "x",
          effects: [{ kind: "deal_direct_damage", target: "opponent", amount: -1 }],
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("recurses into nested expressions", () => {
    const result = validateUserAbility(
      sampleAbility({
        utility: {
          kind: "if",
          cond: { kind: "var", path: "" }, // empty var path - invalid
          then: { kind: "const", value: 1 },
          otherwise: { kind: "const", value: 0 },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("utility.cond"))).toBe(true);
    }
  });

  it("validates apply_status_to_target requires status_id", () => {
    const result = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "x",
          effects: [
            {
              kind: "apply_status_to_target",
              target: "opponent",
              status: { status_id: "", stacks: 1 },
            },
          ],
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("validates set_cooldown_until requires cooldown_id and non-negative duration", () => {
    const result = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "x",
          effects: [
            {
              kind: "set_cooldown_until",
              target: "caster",
              cooldown_id: "",
              duration_sec: -5,
            },
          ],
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("accepts a clamp expression with valid sub-trees", () => {
    const result = validateUserAbility(
      sampleAbility({
        utility: {
          kind: "clamp",
          value: { kind: "var", path: "self.hp_ratio" },
          lo: { kind: "const", value: 0 },
          hi: { kind: "const", value: 1 },
        },
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects clamp with empty var path inside", () => {
    const result = validateUserAbility(
      sampleAbility({
        utility: {
          kind: "clamp",
          value: { kind: "var", path: "" },
          lo: { kind: "const", value: 0 },
          hi: { kind: "const", value: 1 },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("utility.value"))).toBe(true);
    }
  });

  it("validates new math operators recursively", () => {
    const result = validateUserAbility(
      sampleAbility({
        utility: {
          kind: "una",
          op: "abs",
          operand: {
            kind: "bin",
            op: "pow",
            left: { kind: "una", op: "sqrt", operand: { kind: "var", path: "self.hp" } },
            right: { kind: "const", value: 2 },
          },
        },
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("accepts conditional effect with valid branches", () => {
    const result = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "execute",
          effects: [
            {
              kind: "conditional",
              cond: {
                kind: "bin",
                op: "lt",
                left: { kind: "var", path: "opponent.hp_ratio" },
                right: { kind: "const", value: 0.3 },
              },
              then: [{ kind: "deal_direct_damage", target: "opponent", amount: 500 }],
              otherwise: [{ kind: "deal_direct_damage", target: "opponent", amount: 100 }],
            },
          ],
        },
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects conditional with empty then-branch", () => {
    const result = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "x",
          effects: [
            {
              kind: "conditional",
              cond: { kind: "const", value: 1 },
              then: [],
              otherwise: [],
            },
          ],
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects repeat with non-integer or zero count", () => {
    const result = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "x",
          effects: [
            {
              kind: "repeat",
              count: 0,
              body: [{ kind: "deal_direct_damage", target: "opponent", amount: 1 }],
            },
          ],
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("warns when repeat count exceeds engine cap", () => {
    const result = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "x",
          effects: [
            {
              kind: "repeat",
              count: 200,
              body: [{ kind: "deal_direct_damage", target: "opponent", amount: 1 }],
            },
          ],
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /exceeds engine cap/.test(e))).toBe(true);
    }
  });

  it("accepts a passive ability with only triggers", () => {
    // No on_fire - pure reactive Reflect.
    const result = validateUserAbility({
      ...sampleAbility(),
      on_fire: undefined,
      triggers: {
        on_take_damage: {
          name: "Reflect",
          effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 50 }],
        },
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects spec with neither on_fire nor any populated trigger", () => {
    const result = validateUserAbility({
      ...sampleAbility(),
      on_fire: undefined,
      triggers: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => /trigger hook/i.test(e) || /on_fire/.test(e)),
      ).toBe(true);
    }
  });

  it("validates an on_tick trigger with positive interval", () => {
    const result = validateUserAbility(
      sampleAbility({
        triggers: {
          on_tick: {
            interval_sec: 1.0,
            effects: {
              name: "DoT",
              effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 10 }],
            },
          },
        },
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("warns when on_tick interval is below the engine floor", () => {
    const result = validateUserAbility(
      sampleAbility({
        triggers: {
          on_tick: {
            interval_sec: 0.001,
            effects: {
              name: "Tick",
              effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 1 }],
            },
          },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /below engine floor/i.test(e))).toBe(true);
    }
  });

  it("rejects on_tick with non-positive interval", () => {
    const result = validateUserAbility(
      sampleAbility({
        triggers: {
          on_tick: {
            interval_sec: 0,
            effects: {
              name: "T",
              effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 1 }],
            },
          },
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts modify_stat with valid fields", () => {
    const result = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "Buff",
          effects: [
            {
              kind: "modify_stat",
              target: "caster",
              field: "damage",
              mode: "mul",
              value: 1.5,
              duration_sec: 10,
            },
          ],
        },
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects modify_stat with non-snake_case field", () => {
    const result = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "x",
          effects: [
            {
              kind: "modify_stat",
              target: "caster",
              field: "DamageBoost!",
              mode: "add",
              value: 50,
              duration_sec: 5,
            },
          ],
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts trigger_ability with user.* id", () => {
    const result = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "Combo",
          effects: [
            { kind: "trigger_ability", ability_id: "user.other_ability" },
          ],
        },
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects trigger_ability with empty or builtin id", () => {
    const empty = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "x",
          effects: [{ kind: "trigger_ability", ability_id: "" }],
        },
      }),
    );
    expect(empty.ok).toBe(false);
    const builtin = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "x",
          effects: [{ kind: "trigger_ability", ability_id: "builtin.fortify" }],
        },
      }),
    );
    expect(builtin.ok).toBe(false);
  });

  it("validates new effect kinds round-trip", () => {
    // Each new kind exercises validate at least once.
    const cases: Array<UserAbilitySpec["on_fire"]> = [
      { name: "x", effects: [{ kind: "set_hp", target: "caster", value: 100 }] },
      {
        name: "x",
        effects: [
          { kind: "transfer_hp", from: "opponent", to: "caster", amount: 200 },
        ],
      },
      { name: "x", effects: [{ kind: "swap_hp_ratio" }] },
      {
        name: "x",
        effects: [{ kind: "clear_status", target: "caster", status_id: "Bleed_Status" }],
      },
      {
        name: "x",
        effects: [
          {
            kind: "modify_status_stacks",
            target: "opponent",
            status_id: "Burn_Status",
            mode: "add",
            value: 3,
          },
        ],
      },
      { name: "x", effects: [{ kind: "dispel_all_statuses", target: "caster" }] },
      {
        name: "x",
        effects: [
          {
            kind: "cooldown_reset",
            target: "caster",
            cooldown_id: "user.test",
            which: "cooldown",
          },
        ],
      },
      {
        name: "x",
        effects: [{ kind: "interrupt_next_hit", target: "opponent", delay_sec: 2 }],
      },
      { name: "x", effects: [{ kind: "consume_breath", target: "caster", amount: 5 }] },
      { name: "x", effects: [{ kind: "restore_breath", target: "caster", amount: 5 }] },
    ];
    for (const on_fire of cases) {
      const r = validateUserAbility(sampleAbility({ on_fire }));
      expect(r).toEqual({ ok: true });
    }
  });

  it("rejects transfer_hp with same from and to", () => {
    const r = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "x",
          effects: [
            { kind: "transfer_hp", from: "caster", to: "caster", amount: 50 },
          ],
        },
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects modify_status_stacks with mul mode", () => {
    const r = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "x",
          effects: [
            {
              kind: "modify_status_stacks",
              target: "caster",
              status_id: "X",
              mode: "mul",
              value: 2,
            },
          ],
        },
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("validates Expr-driven effect kinds", () => {
    const cases: UserAbilitySpec["on_fire"][] = [
      {
        name: "x",
        effects: [
          {
            kind: "deal_expr_damage",
            target: "opponent",
            amount: {
              kind: "bin",
              op: "mul",
              left: { kind: "var", path: "opponent.hp" },
              right: { kind: "const", value: 0.5 },
            },
          },
        ],
      },
      {
        name: "x",
        effects: [
          {
            kind: "heal_expr_amount",
            target: "caster",
            amount: { kind: "var", path: "self.statuses_count" },
          },
        ],
      },
      {
        name: "x",
        effects: [
          {
            kind: "apply_status_expr_stacks",
            target: "opponent",
            status_id: "Bleed_Status",
            stacks: { kind: "const", value: 3 },
          },
        ],
      },
      {
        name: "x",
        effects: [
          {
            kind: "set_hp_expr",
            target: "opponent",
            value: { kind: "const", value: 1 },
          },
        ],
      },
      {
        name: "x",
        effects: [
          {
            kind: "modify_stat_expr",
            target: "caster",
            field: "damage",
            mode: "mul",
            value: { kind: "const", value: 1.5 },
            duration_sec: { kind: "const", value: 10 },
          },
        ],
      },
    ];
    for (const on_fire of cases) {
      const r = validateUserAbility(sampleAbility({ on_fire }));
      expect(r).toEqual({ ok: true });
    }
  });

  it("rejects Expr-driven variants with malformed sub-Expr", () => {
    const r = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "x",
          effects: [
            {
              kind: "deal_expr_damage",
              target: "opponent",
              amount: { kind: "var", path: "" }, // empty var path
            },
          ],
        },
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("accepts timing_mode_override", () => {
    const r = validateUserAbility(
      sampleAbility({ timing_mode_override: "really_fast" }),
    );
    expect(r).toEqual({ ok: true });
  });

  it("rejects modify_stat with negative duration", () => {
    const result = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "x",
          effects: [
            {
              kind: "modify_stat",
              target: "caster",
              field: "damage",
              mode: "add",
              value: 1,
              duration_sec: -5,
            },
          ],
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("validates nested compositors (conditional inside repeat)", () => {
    const result = validateUserAbility(
      sampleAbility({
        on_fire: {
          name: "machine gun execute",
          effects: [
            {
              kind: "repeat",
              count: 5,
              body: [
                {
                  kind: "conditional",
                  cond: {
                    kind: "bin",
                    op: "gt",
                    left: { kind: "var", path: "opponent.hp" },
                    right: { kind: "const", value: 0 },
                  },
                  then: [
                    { kind: "deal_direct_damage", target: "opponent", amount: 50 },
                  ],
                  otherwise: [],
                },
              ],
            },
          ],
        },
      }),
    );
    expect(result).toEqual({ ok: true });
  });
});

describe("validateUserTiming", () => {
  it("accepts a minimal valid spec", () => {
    expect(validateUserTiming(sampleTiming())).toEqual({ ok: true });
  });

  it("rejects empty candidates", () => {
    const result = validateUserTiming(sampleTiming({ candidates: [] }));
    expect(result.ok).toBe(false);
  });

  it("rejects negative candidate", () => {
    const result = validateUserTiming(sampleTiming({ candidates: [0, -1] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("candidates[1]"))).toBe(true);
    }
  });

  it("rejects negative horizon", () => {
    const result = validateUserTiming(sampleTiming({ horizon_sec: -1 }));
    expect(result.ok).toBe(false);
  });

  it("rejects negative threshold when set", () => {
    const result = validateUserTiming(sampleTiming({ threshold: -0.001 }));
    expect(result.ok).toBe(false);
  });

  it("validates force_skip / force_fire expressions", () => {
    const result = validateUserTiming(
      sampleTiming({
        force_skip: { kind: "var", path: "" },
        force_fire: { kind: "const", value: Number.NaN },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.includes("force_skip"))
          && result.errors.some((e) => e.includes("force_fire")),
      ).toBe(true);
    }
  });
});

function sampleStatus(overrides: Partial<UserStatusSpec> = {}): UserStatusSpec {
  return {
    id: "user.Searing",
    display_name: "Searing",
    polarity: "negative",
    tick_kind: "dot_pct_max_hp",
    tick_base: 0.2,
    tick_per_stack: 0.05,
    tick_interval_sec: 3,
    max_stacks: 5,
    ...overrides,
  };
}

describe("validateUserStatus", () => {
  it("accepts a fully-specified spec", () => {
    expect(validateUserStatus(sampleStatus())).toEqual({ ok: true });
  });

  it("accepts the minimal id + display_name spec", () => {
    expect(
      validateUserStatus({ id: "user.Mark", display_name: "Mark" }),
    ).toEqual({ ok: true });
  });

  it("accepts max_stacks: null (unbounded)", () => {
    expect(validateUserStatus(sampleStatus({ max_stacks: null })).ok).toBe(true);
  });

  it("rejects a non-user id", () => {
    const result = validateUserStatus(sampleStatus({ id: "Searing" }));
    expect(result.ok).toBe(false);
  });

  it("rejects bad enum values", () => {
    const result = validateUserStatus(
      sampleStatus({
        // @ts-expect-error intentionally invalid enum
        polarity: "spicy",
        // @ts-expect-error intentionally invalid enum
        tick_kind: "explode",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("polarity"))).toBe(true);
      expect(result.errors.some((e) => e.includes("tick_kind"))).toBe(true);
    }
  });

  it("rejects negative multipliers and non-finite numbers", () => {
    const result = validateUserStatus(
      sampleStatus({ incoming_damage_mult: -1, decay_interval_sec: Number.NaN }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("incoming_damage_mult"))).toBe(true);
      expect(result.errors.some((e) => e.includes("decay_interval_sec"))).toBe(true);
    }
  });
});
