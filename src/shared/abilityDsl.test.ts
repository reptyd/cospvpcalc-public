import { describe, expect, it } from "vitest";
import { parseAbility, printAbility } from "./abilityDsl";
import type { UserAbilitySpec } from "./customAbilityTypes";

function parse(text: string): UserAbilitySpec {
  const r = parseAbility(text);
  if (!r.ok) throw new Error(`line ${r.line}: ${r.error}`);
  return r.spec;
}

describe("parseAbility", () => {
  it("parses minimal header + decision exprs", () => {
    const spec = parse(`
ability user.foo "Foo"
  utility: 1
  available: 1
`);
    expect(spec.id).toBe("user.foo");
    expect(spec.display_name).toBe("Foo");
    expect(spec.utility).toEqual({ kind: "const", value: 1 });
  });

  it("parses timing override (built-in)", () => {
    const spec = parse(`
ability user.x "X"
  timing really_fast
  utility: 1
  available: 1
`);
    expect(spec.timing_mode_override).toBe("really_fast");
  });

  it("parses timing override (custom user-timing)", () => {
    const spec = parse(`
ability user.x "X"
  timing user.my_timing
  utility: 1
  available: 1
`);
    expect(spec.timing_user_override).toBe("user.my_timing");
  });

  it("parses on_fire block with simple effects", () => {
    const spec = parse(`
ability user.execute "Execute"
  utility: opp.hp_ratio < 0.3 ? 1000000 : 0
  available: opp.hp_ratio < 0.3
  on_fire:
    set_hp opp 1
    cooldown self user.execute for 30
`);
    expect(spec.on_fire).toBeTruthy();
    expect(spec.on_fire!.effects).toHaveLength(2);
    expect(spec.on_fire!.effects[0]).toMatchObject({
      kind: "set_hp",
      target: "opponent",
      value: 1,
    });
    expect(spec.on_fire!.effects[1]).toMatchObject({
      kind: "set_cooldown_until",
      cooldown_id: "user.execute",
      duration_sec: 30,
    });
  });

  it("parses Expr-based deal", () => {
    const spec = parse(`
ability user.exec "E"
  utility: 1
  available: 1
  on_fire:
    deal opp.hp * 0.5 to opp
`);
    const e = spec.on_fire!.effects[0];
    expect(e.kind).toBe("deal_expr_damage");
  });

  it("parses on_take_damage trigger with conditional", () => {
    const spec = parse(`
ability user.reflect "Reflect"
  utility: 0
  available: 0
  on_take_damage:
    if event.damage_taken > 100:
      deal event.damage_taken * 0.5 to opp
    else:
      deal 50 to opp
`);
    expect(spec.triggers?.on_take_damage).toBeTruthy();
    const eff = spec.triggers!.on_take_damage!.effects[0];
    expect(eff.kind).toBe("conditional");
    if (eff.kind === "conditional") {
      expect(eff.then).toHaveLength(1);
      expect(eff.otherwise).toHaveLength(1);
    }
  });

  it("parses on_tick with interval", () => {
    const spec = parse(`
ability user.dot "DoT"
  utility: 0
  available: 0
  on_tick 1.5:
    deal 50 to opp
`);
    expect(spec.triggers?.on_tick).toBeTruthy();
    expect(spec.triggers!.on_tick!.interval_sec).toBe(1.5);
  });

  it("parses chance + repeat blocks", () => {
    const spec = parse(`
ability user.x "X"
  utility: 1
  available: 1
  on_fire:
    chance 0.3:
      deal 200 to opp
    repeat 3:
      deal 50 to opp
`);
    const effs = spec.on_fire!.effects;
    expect(effs[0].kind).toBe("chance");
    expect(effs[1].kind).toBe("repeat");
  });

  it("parses set_extra / inc_extra / detonate", () => {
    const spec = parse(`
ability user.r "Rage"
  utility: 1
  available: 1
  on_fire:
    set_extra self rage = 0
    inc_extra self rage += 1
    detonate opp Bleed_Status @ 50
`);
    const effs = spec.on_fire!.effects;
    expect(effs[0].kind).toBe("set_extra");
    expect(effs[1].kind).toBe("increment_extra");
    expect(effs[2].kind).toBe("consume_status_for_damage");
  });

  it("parses snapshot / restore / trigger / schedule", () => {
    const spec = parse(`
ability user.r "Rewind"
  utility: 1
  available: 1
  on_fire:
    snapshot self save1
    restore self save1
    trigger user.other
    schedule 3:
      deal 1000 to opp
`);
    const effs = spec.on_fire!.effects;
    expect(effs[0].kind).toBe("record_snapshot");
    expect(effs[1].kind).toBe("restore_snapshot");
    expect(effs[2].kind).toBe("trigger_ability");
    expect(effs[3].kind).toBe("schedule_effect");
  });

  it("rejects bad header", () => {
    const r = parseAbility(`bad header`);
    expect(r.ok).toBe(false);
  });

  it("rejects unknown effect", () => {
    const r = parseAbility(`
ability user.x "X"
  utility: 1
  available: 1
  on_fire:
    nonsense_effect blah
`);
    expect(r.ok).toBe(false);
  });
});

describe("printAbility round-trip", () => {
  const fixtures: string[] = [
    `ability user.execute "Execute"
  timing really_fast
  utility: opp.hp_ratio < 0.3 ? 1000000 : 0
  available: opp.hp_ratio < 0.3
  on_fire:
    set_hp opp 1`,
    `ability user.dot "DoT"
  utility: 0
  available: 0
  on_tick 1:
    deal 50 to opp`,
    `ability user.r "R"
  utility: 1
  available: 1
  on_fire:
    chance 0.3:
      deal 200 to opp
    repeat 3:
      deal 50 to opp`,
    // Levels + scaling round-trip.
    `ability user.scaled_strike "Scaled Strike"
  levels 3
  default_level 2
  scaling cost_hp: 10, 15, 20
  scaling damage_amount: 50, 100, 200
  utility: 1
  available: 1
  on_fire:
    deal scaling.damage_amount to opp`,
  ];

  for (const text of fixtures) {
    it(`survives parse → print → parse → equal`, () => {
      const a = parse(text);
      const printed = printAbility(a);
      const b = parse(printed);
      expect(b).toEqual(a);
    });
  }
});

describe("levels + scaling parse", () => {
  it("parses levels, default_level, and multiple scaling rows", () => {
    const spec = parse(`
ability user.s "S"
  levels 3
  default_level 2
  scaling damage_amount: 50, 100, 200
  scaling cost_hp: 10, 15, 20
  utility: 1
  available: 1
  on_fire:
    deal 1 to opp
`);
    expect(spec.levels).toBe(3);
    expect(spec.default_level).toBe(2);
    expect(spec.scaling).toEqual({
      damage_amount: [50, 100, 200],
      cost_hp: [10, 15, 20],
    });
  });

  it("rejects non-positive levels", () => {
    const r = parseAbility(`
ability user.s "S"
  levels 0
  utility: 1
  available: 1
  on_fire:
    deal 1 to opp
`);
    expect(r.ok).toBe(false);
  });

  it("rejects non-finite scaling values", () => {
    const r = parseAbility(`
ability user.s "S"
  levels 2
  scaling foo: 10, NaN
  utility: 1
  available: 1
  on_fire:
    deal 1 to opp
`);
    // "NaN" parses to NaN which is not finite - should fail.
    expect(r.ok).toBe(false);
  });

  it("omits levels block when single-level (default)", () => {
    const spec = parse(`
ability user.legacy "Legacy"
  utility: 1
  available: 1
  on_fire:
    deal 50 to opp
`);
    const printed = printAbility(spec);
    expect(printed).not.toContain("levels");
    expect(printed).not.toContain("scaling");
    expect(printed).not.toContain("default_level");
  });
});

describe("batch-level `when` gate - DSL round-trip", () => {
  it("parses a trigger with a when: line", () => {
    const spec = parse(`
ability user.gated "Gated"
  utility: 0
  available: 0
  on_take_damage:
    when: event.damage_taken > 100
    deal 50 to opp
`);
    expect(spec.triggers?.on_take_damage).toBeTruthy();
    expect(spec.triggers!.on_take_damage!.when).toEqual({
      kind: "bin",
      op: "gt",
      left: { kind: "var", path: "event.damage_taken" },
      right: { kind: "const", value: 100 },
    });
    expect(spec.triggers!.on_take_damage!.effects).toHaveLength(1);
  });

  it("emits `when:` only when set, omitted otherwise", () => {
    const withWhen = parse(`
ability user.gated "Gated"
  utility: 0
  available: 0
  on_take_damage:
    when: 0
    deal 50 to opp
`);
    const withoutWhen = parse(`
ability user.nogated "NoGated"
  utility: 0
  available: 0
  on_take_damage:
    deal 50 to opp
`);
    expect(printAbility(withWhen)).toContain("when:");
    expect(printAbility(withoutWhen)).not.toContain("when:");
  });

  it("survives a parse → print → parse round-trip", () => {
    const text = `ability user.gated "Gated"
  utility: 1
  available: 1
  on_fire:
    when: self.hp_ratio < 0.5
    deal 200 to opp
  on_take_damage:
    when: event.damage_taken > 50
    apply Vigor_Buff x1 to self`;
    const a = parse(text);
    const b = parse(printAbility(a));
    expect(b).toEqual(a);
  });
});

describe("apply_statuses_to_target + clear_statuses (array DSL forms)", () => {
  it("parses apply [<id> x<n>, ...] to <side>", () => {
    const spec = parse(`
ability user.poly "Poly"
  utility: 1
  available: 1
  on_fire:
    apply [Burn_Status x2, Poison_Status x3] to opp
`);
    expect(spec.on_fire!.effects[0]).toEqual({
      kind: "apply_statuses_to_target",
      target: "opponent",
      statuses: [
        { status_id: "Burn_Status", stacks: 2, source_ability: null },
        { status_id: "Poison_Status", stacks: 3, source_ability: null },
      ],
    });
  });

  it("rejects empty apply [] array", () => {
    const r = parseAbility(`
ability user.bad "Bad"
  utility: 1
  available: 1
  on_fire:
    apply [] to opp
`);
    expect(r.ok).toBe(false);
  });

  it("parses clear <side> [<id>, <id>] array form", () => {
    const spec = parse(`
ability user.cleanse_two "CleanseTwo"
  utility: 1
  available: 1
  on_fire:
    clear self [Burn_Status, Poison_Status]
`);
    expect(spec.on_fire!.effects[0]).toEqual({
      kind: "clear_statuses",
      target: "caster",
      status_ids: ["Burn_Status", "Poison_Status"],
    });
  });

  it("round-trips both array forms", () => {
    const text = `ability user.combo "Combo"
  utility: 1
  available: 1
  on_fire:
    apply [Burn_Status x1, Poison_Status x2] to opp
    clear self [Heartbroken_Status, Scared_Status]`;
    const a = parse(text);
    const b = parse(printAbility(a));
    expect(b).toEqual(a);
  });
});

describe("status-timer + named-schedule DSL forms", () => {
  it("parses tick_next + decay_next", () => {
    const spec = parse(`
ability user.dot "Dot"
  utility: 1
  available: 1
  on_fire:
    tick_next opp Burn_Status @5.0
    decay_next opp Poison_Status @10
`);
    expect(spec.on_fire!.effects).toEqual([
      {
        kind: "set_status_next_tick",
        target: "opponent",
        status_id: "Burn_Status",
        absolute_time: 5.0,
      },
      {
        kind: "set_status_next_decay",
        target: "opponent",
        status_id: "Poison_Status",
        absolute_time: 10,
      },
    ]);
  });

  it("parses cancel_schedule + reschedule", () => {
    const spec = parse(`
ability user.channel "Channel"
  utility: 1
  available: 1
  on_take_damage:
    cancel_schedule my_bomb
    reschedule my_other 8.5
`);
    expect(spec.triggers!.on_take_damage!.effects).toEqual([
      { kind: "cancel_schedule", name: "my_bomb" },
      { kind: "reschedule", name: "my_other", delay_sec: 8.5 },
    ]);
  });

  it("parses named schedule (`schedule N as <name>:`) + round-trips", () => {
    const text = `ability user.bomb "Bomb"
  utility: 1
  available: 1
  on_fire:
    schedule 3 as my_bomb:
      deal 500 to opp`;
    const a = parse(text);
    const sched = a.on_fire!.effects[0];
    expect(sched).toMatchObject({
      kind: "schedule_effect",
      delay_sec: 3,
      name: "my_bomb",
    });
    const b = parse(printAbility(a));
    expect(b).toEqual(a);
  });

  it("unnamed `schedule N:` stays anonymous after round-trip", () => {
    const text = `ability user.fire_forget "FireForget"
  utility: 1
  available: 1
  on_fire:
    schedule 3:
      deal 500 to opp`;
    const a = parse(text);
    const sched = a.on_fire!.effects[0];
    expect(sched).toMatchObject({ kind: "schedule_effect", delay_sec: 3 });
    expect((sched as { name?: string }).name).toBeUndefined();
    const b = parse(printAbility(a));
    expect(b).toEqual(a);
  });
});

describe("choose: block DSL form", () => {
  it("parses choose: with multiple weighted branches", () => {
    const spec = parse(`
ability user.flip "Flip"
  utility: 1
  available: 1
  on_fire:
    choose:
      weight 1:
        deal 10 to opp
      weight 2:
        heal self 50
`);
    expect(spec.on_fire!.effects).toHaveLength(1);
    const ch = spec.on_fire!.effects[0];
    expect(ch.kind).toBe("choose");
    if (ch.kind !== "choose") return;
    expect(ch.branches).toHaveLength(2);
    expect(ch.branches[0]).toEqual({
      weight: { kind: "const", value: 1 },
      effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 10 }],
    });
    expect(ch.branches[1]).toEqual({
      weight: { kind: "const", value: 2 },
      effects: [{ kind: "heal_hp", target: "caster", amount: 50 }],
    });
  });

  it("accepts Expr-weighted branches", () => {
    const spec = parse(`
ability user.scaled "Scaled"
  utility: 1
  available: 1
  on_fire:
    choose:
      weight self.hp_ratio:
        deal 100 to opp
      weight 1 - self.hp_ratio:
        heal self 100
`);
    const ch = spec.on_fire!.effects[0];
    if (ch.kind !== "choose") throw new Error("expected choose");
    expect(ch.branches[0].weight).toEqual({
      kind: "var",
      path: "self.hp_ratio",
    });
  });

  it("round-trips choose:", () => {
    const text = `ability user.flip "Flip"
  utility: 1
  available: 1
  on_fire:
    choose:
      weight 1:
        deal 10 to opp
      weight 2:
        heal self 50`;
    const a = parse(text);
    const b = parse(printAbility(a));
    expect(b).toEqual(a);
  });

  it("DIAGNOSTIC: user's Switch Up spec - verify all effects survive parsing", () => {
    const switchUp = `ability user.switch_up "Switch Up"
  available: self.is_idle.user.switch_up && opp.is_alive
  utility: ((self.hp_ratio < 0.3 ? 4 : opp.hp_ratio > 0.7 ? 0 : opp.hp_ratio > 0.5 ? 1 : opp.hp_ratio > 0.35 ? 2 : opp.hp_ratio > 0.2 ? 4 : 0) != self.extra.ailment_idx) ? 50 : 0
  reallyfast_gate: (self.hp_ratio < 0.3 ? 4 : opp.hp_ratio > 0.7 ? 0 : opp.hp_ratio > 0.5 ? 1 : opp.hp_ratio > 0.35 ? 2 : opp.hp_ratio > 0.2 ? 4 : 0) != self.extra.ailment_idx
  on_fire:
    set_extra self ailment_idx = (self.extra.ailment_idx + 1) % 8
    cooldown self user.switch_up for 2
  on_deal_damage:
    if event.is_bite:
      if self.extra.ailment_idx == 0:
        apply Bleed_Status x5 to opp
      if self.extra.ailment_idx == 1:
        apply Disease_Status x3 to opp
      if self.extra.ailment_idx == 2:
        apply Poison_Status x3 to opp
      if self.extra.ailment_idx == 3:
        apply Injury_Status x2 to opp
      if self.extra.ailment_idx == 4:
        apply Burn_Status x2 to opp
      if self.extra.ailment_idx == 5:
        apply Corrosion_Status x2 to opp
      if self.extra.ailment_idx == 6:
        apply Frostbite_Status x1 to opp
      if self.extra.ailment_idx == 7:
        apply Shredded_Wings x1 to opp`;
    const result = parseAbility(switchUp);
    if (!result.ok) {
      throw new Error(`parse failed at line ${result.line}: ${result.error}`);
    }
    const spec = result.spec;
    // Sanity: on_fire has BOTH set_extra AND cooldown
    expect(spec.on_fire?.effects.length).toBe(2);
    expect(spec.on_fire?.effects[0].kind).toBe("set_extra");
    expect(spec.on_fire?.effects[1].kind).toBe("set_cooldown_until");
    // on_deal_damage has the outer if event.is_bite wrapping 8 inner ifs
    const outerIf = spec.triggers?.on_deal_damage?.effects[0];
    expect(outerIf?.kind).toBe("conditional");
    if (outerIf?.kind === "conditional") {
      expect(outerIf.then.length).toBe(8);
      for (let i = 0; i < 8; i++) {
        expect(outerIf.then[i].kind).toBe("conditional");
      }
    }
  });

  it("empty choose: (no branches) parses to zero-branch effect", () => {
    const spec = parse(`
ability user.noop "Noop"
  utility: 1
  available: 1
  on_fire:
    choose:
`);
    const ch = spec.on_fire!.effects[0];
    expect(ch).toEqual({ kind: "choose", branches: [] });
  });
});
