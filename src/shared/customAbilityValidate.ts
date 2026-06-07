/**
 * TS-side validation mirroring the Rust `validate()` rules in
 * `wasm-engine/src/policy/user_ability.rs` and `user_timing.rs`.
 *
 * The Constructor + Code editors call this for instant feedback so
 * the user doesn't wait for a wasm round-trip just to learn the id
 * is malformed. The bridge re-validates server-side at registration
 * time - when the two diverge, the engine's view wins.
 */

import {
  MAX_REPEAT_COUNT,
  MIN_TICK_INTERVAL_SEC,
  type EffectBatch,
  type EffectKind,
  type Expr,
  type TickTrigger,
  type TriggerHooks,
  type UserAbilitySpec,
  type UserStatusSpec,
  type UserStatusTickKind,
  type UserTimingSpec,
} from "./customAbilityTypes";

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

function validateId(id: string, label: string, errors: string[]): void {
  if (!id) {
    errors.push(`${label} id must not be empty`);
    return;
  }
  if (!id.startsWith("user.")) {
    errors.push(`${label} id "${id}" must start with "user." namespace`);
  }
}

function validateDisplayName(name: string, errors: string[]): void {
  if (!name || !name.trim()) {
    errors.push("display_name must not be empty");
  }
}

function validateExpr(expr: Expr, path: string, errors: string[]): void {
  switch (expr.kind) {
    case "const":
      if (!Number.isFinite(expr.value)) {
        errors.push(`${path}: const value must be a finite number`);
      }
      return;
    case "var":
      if (typeof expr.path !== "string" || !expr.path) {
        errors.push(`${path}: var path must be a non-empty string`);
      }
      return;
    case "bin":
      validateExpr(expr.left, `${path}.left`, errors);
      validateExpr(expr.right, `${path}.right`, errors);
      return;
    case "una":
      validateExpr(expr.operand, `${path}.operand`, errors);
      return;
    case "if":
      validateExpr(expr.cond, `${path}.cond`, errors);
      validateExpr(expr.then, `${path}.then`, errors);
      validateExpr(expr.otherwise, `${path}.otherwise`, errors);
      return;
    case "clamp":
      validateExpr(expr.value, `${path}.value`, errors);
      validateExpr(expr.lo, `${path}.lo`, errors);
      validateExpr(expr.hi, `${path}.hi`, errors);
      return;
    case "rand":
      // No-operand. Nothing to validate.
      return;
    default: {
      // exhaustiveness check
      const exhaustive: never = expr;
      errors.push(`${path}: unknown expr kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function validateEffect(effect: EffectKind, path: string, errors: string[]): void {
  switch (effect.kind) {
    case "deal_direct_damage":
    case "heal_hp":
      if (!Number.isFinite(effect.amount) || effect.amount < 0) {
        errors.push(`${path}: amount must be non-negative finite`);
      }
      return;
    case "deal_direct_damage_max_hp_fraction":
    case "pay_self_cost_max_hp_fraction":
      if (!Number.isFinite(effect.fraction) || effect.fraction < 0) {
        errors.push(`${path}: fraction must be non-negative finite`);
      }
      return;
    case "apply_status_to_target":
      if (!effect.status?.status_id) {
        errors.push(`${path}: status.status_id must not be empty`);
      }
      if (!Number.isFinite(effect.status?.stacks)) {
        errors.push(`${path}: status.stacks must be a finite number`);
      }
      return;
    case "apply_statuses_to_target":
      // Array variant. Empty array allowed (no-op);
      // each entry validated for non-empty id + finite stacks.
      if (!Array.isArray(effect.statuses)) {
        errors.push(`${path}: statuses must be an array`);
        return;
      }
      effect.statuses.forEach((s, i) => {
        if (!s?.status_id) {
          errors.push(`${path}.statuses[${i}].status_id must not be empty`);
        }
        if (!Number.isFinite(s?.stacks)) {
          errors.push(`${path}.statuses[${i}].stacks must be a finite number`);
        }
      });
      return;
    case "cleanse_fortify_removable_statuses":
      // No additional fields to validate.
      return;
    case "set_cooldown_until":
      if (!effect.cooldown_id) {
        errors.push(`${path}: cooldown_id must not be empty`);
      }
      if (!Number.isFinite(effect.duration_sec) || effect.duration_sec < 0) {
        errors.push(`${path}: duration_sec must be non-negative finite`);
      }
      return;
    case "set_active_until":
      if (!effect.active_id) {
        errors.push(`${path}: active_id must not be empty`);
      }
      if (!Number.isFinite(effect.duration_sec) || effect.duration_sec < 0) {
        errors.push(`${path}: duration_sec must be non-negative finite`);
      }
      return;
    case "set_cooldown_until_expr":
      if (!effect.cooldown_id) {
        errors.push(`${path}: cooldown_id must not be empty`);
      }
      validateExpr(effect.duration_sec, `${path}.duration_sec`, errors);
      return;
    case "set_active_until_expr":
      if (!effect.active_id) {
        errors.push(`${path}: active_id must not be empty`);
      }
      validateExpr(effect.duration_sec, `${path}.duration_sec`, errors);
      return;
    case "conditional":
      validateExpr(effect.cond, `${path}.cond`, errors);
      if (!Array.isArray(effect.then) || effect.then.length === 0) {
        errors.push(`${path}.then must contain at least one effect`);
      } else {
        effect.then.forEach((e, i) => validateEffect(e, `${path}.then[${i}]`, errors));
      }
      if (!Array.isArray(effect.otherwise)) {
        errors.push(`${path}.otherwise must be an array (use [] for no-op)`);
      } else {
        effect.otherwise.forEach((e, i) =>
          validateEffect(e, `${path}.otherwise[${i}]`, errors),
        );
      }
      return;
    case "repeat":
      if (!Number.isInteger(effect.count) || effect.count < 1) {
        errors.push(`${path}: count must be a positive integer`);
      }
      if (effect.count > MAX_REPEAT_COUNT) {
        errors.push(
          `${path}: count ${effect.count} exceeds engine cap ${MAX_REPEAT_COUNT}; the engine will clamp it`,
        );
      }
      if (!Array.isArray(effect.body) || effect.body.length === 0) {
        errors.push(`${path}.body must contain at least one effect`);
      } else {
        effect.body.forEach((e, i) => validateEffect(e, `${path}.body[${i}]`, errors));
      }
      return;
    case "modify_stat":
      if (!effect.field || !/^[a-z_][a-z0-9_]*$/.test(effect.field)) {
        errors.push(`${path}: field must be a snake_case identifier`);
      }
      if (!Number.isFinite(effect.value)) {
        errors.push(`${path}: value must be finite`);
      }
      if (
        !Number.isFinite(effect.duration_sec) ||
        effect.duration_sec < 0
      ) {
        errors.push(`${path}: duration_sec must be non-negative finite (0 = permanent)`);
      }
      return;
    case "trigger_ability":
      if (!effect.ability_id) {
        errors.push(`${path}: ability_id must not be empty`);
      } else if (!effect.ability_id.startsWith("user.")) {
        errors.push(
          `${path}: ability_id "${effect.ability_id}" must start with "user." (built-in chaining is not yet supported)`,
        );
      }
      return;
    case "set_hp":
      if (!Number.isFinite(effect.value) || effect.value < 0) {
        errors.push(`${path}: value must be non-negative finite`);
      }
      return;
    case "transfer_hp":
      if (effect.from === effect.to) {
        errors.push(`${path}: from and to must be different sides`);
      }
      if (!Number.isFinite(effect.amount) || effect.amount <= 0) {
        errors.push(`${path}: amount must be positive finite`);
      }
      return;
    case "swap_hp_ratio":
      // No fields to validate.
      return;
    case "form_swap":
      if (!Array.isArray(effect.stat_changes) || effect.stat_changes.length === 0) {
        errors.push(`${path}: stat_changes must be a non-empty array`);
      } else {
        effect.stat_changes.forEach((change, i) => {
          if (!change.field || !/^[a-z_][a-z0-9_]*$/.test(change.field)) {
            errors.push(`${path}.stat_changes[${i}]: field must be a snake_case identifier`);
          }
          if (!Number.isFinite(change.value)) {
            errors.push(`${path}.stat_changes[${i}]: value must be finite`);
          }
        });
      }
      if (!Number.isFinite(effect.duration_sec)) {
        errors.push(`${path}: duration_sec must be finite (<= 0 = permanent for the fight)`);
      }
      if (effect.hp_policy.kind === "set" && !Number.isFinite(effect.hp_policy.value)) {
        errors.push(`${path}: hp_policy set value must be finite`);
      }
      return;
    case "clear_status":
      if (!effect.status_id) {
        errors.push(`${path}: status_id must not be empty`);
      }
      return;
    case "clear_statuses":
      // Array variant. Empty array allowed (no-op);
      // each id must be non-empty.
      if (!Array.isArray(effect.status_ids)) {
        errors.push(`${path}: status_ids must be an array`);
        return;
      }
      effect.status_ids.forEach((id, i) => {
        if (!id) {
          errors.push(`${path}.status_ids[${i}] must not be empty`);
        }
      });
      return;
    case "modify_status_stacks":
      if (!effect.status_id) {
        errors.push(`${path}: status_id must not be empty`);
      }
      if (!Number.isFinite(effect.value)) {
        errors.push(`${path}: value must be finite`);
      }
      if (effect.mode === "mul") {
        errors.push(
          `${path}: mode "mul" not supported on status stacks (zero × X = 0 footgun); use add or set`,
        );
      }
      return;
    case "dispel_all_statuses":
      // target only.
      return;
    case "cooldown_reset":
      if (!effect.cooldown_id) {
        errors.push(`${path}: cooldown_id must not be empty`);
      }
      return;
    case "interrupt_next_hit":
      if (!Number.isFinite(effect.delay_sec) || effect.delay_sec < 0) {
        errors.push(`${path}: delay_sec must be non-negative finite`);
      }
      return;
    case "consume_breath":
    case "restore_breath":
      if (!Number.isFinite(effect.amount) || effect.amount <= 0) {
        errors.push(`${path}: amount must be positive finite`);
      }
      return;
    case "deal_expr_damage":
    case "heal_expr_amount":
      validateExpr(effect.amount, `${path}.amount`, errors);
      return;
    case "apply_status_expr_stacks":
      if (!effect.status_id) {
        errors.push(`${path}: status_id must not be empty`);
      }
      validateExpr(effect.stacks, `${path}.stacks`, errors);
      return;
    case "set_hp_expr":
      validateExpr(effect.value, `${path}.value`, errors);
      return;
    case "modify_stat_expr":
      if (!effect.field || !/^[a-z_][a-z0-9_]*$/.test(effect.field)) {
        errors.push(`${path}: field must be a snake_case identifier`);
      }
      validateExpr(effect.value, `${path}.value`, errors);
      validateExpr(effect.duration_sec, `${path}.duration_sec`, errors);
      return;
    case "set_extra":
    case "increment_extra":
      if (!effect.key) {
        errors.push(`${path}: key must not be empty`);
      }
      validateExpr(
        "value" in effect ? effect.value : effect.amount,
        `${path}.${"value" in effect ? "value" : "amount"}`,
        errors,
      );
      return;
    case "push_extra":
      if (!effect.key) {
        errors.push(`${path}: key must not be empty`);
      }
      if (/^[a-z_][a-z0-9_]*\.(length|sum|last)$/.test(effect.key)) {
        errors.push(
          `${path}: key "${effect.key}" collides with array-derived slot - push_extra writes to <key>.length / <key>.<i>; pick a different base name`,
        );
      }
      validateExpr(effect.value, `${path}.value`, errors);
      return;
    case "clear_extra_array":
      if (!effect.key) {
        errors.push(`${path}: key must not be empty`);
      }
      return;
    case "deal_typed_damage":
      if (!Number.isFinite(effect.amount) || effect.amount < 0) {
        errors.push(`${path}: amount must be non-negative finite`);
      }
      return;
    case "consume_status_for_damage":
      if (!effect.status_id) {
        errors.push(`${path}: status_id must not be empty`);
      }
      validateExpr(
        effect.damage_per_stack,
        `${path}.damage_per_stack`,
        errors,
      );
      return;
    case "extend_status":
      if (!effect.status_id) {
        errors.push(`${path}: status_id must not be empty`);
      }
      if (!Number.isFinite(effect.seconds)) {
        errors.push(`${path}: seconds must be finite`);
      }
      return;
    case "set_status_next_decay":
    case "set_status_next_tick":
      if (!effect.status_id) {
        errors.push(`${path}: status_id must not be empty`);
      }
      if (!Number.isFinite(effect.absolute_time) || effect.absolute_time < 0) {
        errors.push(`${path}: absolute_time must be non-negative finite`);
      }
      return;
    case "chance":
      validateExpr(effect.probability, `${path}.probability`, errors);
      if (!Array.isArray(effect.then) || effect.then.length === 0) {
        errors.push(`${path}.then must contain at least one effect`);
      } else {
        effect.then.forEach((e, i) => validateEffect(e, `${path}.then[${i}]`, errors));
      }
      return;
    case "choose":
      // One-of-N weighted picker. Need at least one
      // branch; each branch needs a weight expr + non-empty effects.
      if (!Array.isArray(effect.branches) || effect.branches.length === 0) {
        errors.push(`${path}.branches must contain at least one branch`);
      } else {
        effect.branches.forEach((branch, i) => {
          const bpath = `${path}.branches[${i}]`;
          if (!branch || typeof branch !== "object") {
            errors.push(`${bpath}: branch must be an object with weight + effects`);
            return;
          }
          validateExpr(branch.weight, `${bpath}.weight`, errors);
          if (!Array.isArray(branch.effects) || branch.effects.length === 0) {
            errors.push(`${bpath}.effects must contain at least one effect`);
          } else {
            branch.effects.forEach((e, j) => validateEffect(e, `${bpath}.effects[${j}]`, errors));
          }
        });
      }
      return;
    case "record_snapshot":
    case "restore_snapshot":
      if (!effect.key) {
        errors.push(`${path}: key must not be empty`);
      }
      return;
    case "schedule_effect":
      if (!Number.isFinite(effect.delay_sec) || effect.delay_sec < 0) {
        errors.push(`${path}: delay_sec must be non-negative finite`);
      }
      if (effect.delay_sec > 600) {
        errors.push(`${path}: delay_sec ${effect.delay_sec} exceeds engine cap 600s; will clamp`);
      }
      if (!Array.isArray(effect.effects) || effect.effects.length === 0) {
        errors.push(`${path}.effects must contain at least one effect`);
      } else {
        effect.effects.forEach((e, i) =>
          validateEffect(e, `${path}.effects[${i}]`, errors),
        );
      }
      if (effect.name !== undefined && (typeof effect.name !== "string" || !effect.name)) {
        errors.push(`${path}.name must be a non-empty string when provided`);
      }
      return;
    case "cancel_schedule":
      if (typeof effect.name !== "string" || !effect.name) {
        errors.push(`${path}.name must be a non-empty string`);
      }
      return;
    case "reschedule":
      if (typeof effect.name !== "string" || !effect.name) {
        errors.push(`${path}.name must be a non-empty string`);
      }
      if (!Number.isFinite(effect.delay_sec) || effect.delay_sec < 0) {
        errors.push(`${path}: delay_sec must be non-negative finite`);
      }
      if (effect.delay_sec > 600) {
        errors.push(`${path}: delay_sec ${effect.delay_sec} exceeds engine cap 600s; will clamp`);
      }
      return;
    default: {
      const exhaustive: never = effect;
      errors.push(`${path}: unknown effect kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function validateBatch(batch: EffectBatch, path: string, errors: string[]): void {
  if (!batch || !Array.isArray(batch.effects) || batch.effects.length === 0) {
    errors.push(`${path}.effects must contain at least one effect`);
    return;
  }
  if (!batch.name?.trim()) {
    errors.push(`${path}.name must not be empty`);
  }
  batch.effects.forEach((effect, idx) => {
    validateEffect(effect, `${path}.effects[${idx}]`, errors);
  });
  // Validate the optional gate expr.
  if (batch.when) {
    validateExpr(batch.when, `${path}.when`, errors);
  }
}

/**
 * Pillar-9 cost ceiling. Each Expr node and each effect counts as
 * 1 cost unit. The cap is generous (~10k) so legitimate complex
 * specs pass; pathological deeply-nested ones (Repeat 64 of
 * Repeat 64 of trigger_ability(self)) get refused at registration
 * time before they can blow the per-decision budget at runtime.
 */
export const MAX_SPEC_COMPLEXITY = 10_000;

function countExprNodes(expr: Expr): number {
  let n = 1;
  switch (expr.kind) {
    case "bin":
      n += countExprNodes(expr.left) + countExprNodes(expr.right);
      break;
    case "una":
      n += countExprNodes(expr.operand);
      break;
    case "if":
      n +=
        countExprNodes(expr.cond) +
        countExprNodes(expr.then) +
        countExprNodes(expr.otherwise);
      break;
    case "clamp":
      n += countExprNodes(expr.value) + countExprNodes(expr.lo) + countExprNodes(expr.hi);
      break;
    default:
      break;
  }
  return n;
}

function countEffectNodes(effects: EffectKind[]): number {
  let n = effects.length;
  for (const e of effects) {
    switch (e.kind) {
      case "conditional":
        n += countExprNodes(e.cond);
        n += countEffectNodes(e.then) + countEffectNodes(e.otherwise);
        break;
      case "repeat":
        // Worst case: repeat applies body N times.
        n += e.count * countEffectNodes(e.body);
        break;
      case "chance":
        n += countExprNodes(e.probability) + countEffectNodes(e.then);
        break;
      case "choose":
        for (const branch of e.branches) {
          n += countExprNodes(branch.weight) + countEffectNodes(branch.effects);
        }
        break;
      case "schedule_effect":
        n += countEffectNodes(e.effects);
        break;
      case "deal_expr_damage":
      case "heal_expr_amount":
        n += countExprNodes(e.amount);
        break;
      case "set_hp_expr":
        n += countExprNodes(e.value);
        break;
      case "modify_stat_expr":
        n += countExprNodes(e.value) + countExprNodes(e.duration_sec);
        break;
      case "set_cooldown_until_expr":
      case "set_active_until_expr":
        n += countExprNodes(e.duration_sec);
        break;
      case "apply_status_expr_stacks":
        n += countExprNodes(e.stacks);
        break;
      case "consume_status_for_damage":
        n += countExprNodes(e.damage_per_stack);
        break;
      case "set_extra":
        n += countExprNodes(e.value);
        break;
      case "increment_extra":
        n += countExprNodes(e.amount);
        break;
      case "push_extra":
        n += countExprNodes(e.value);
        break;
      case "clear_extra_array":
        // No Expr cost - just bumps the existing counter.
        break;
      default:
        break;
    }
  }
  return n;
}

function countSpecComplexity(spec: UserAbilitySpec): number {
  let n = 0;
  if (spec.utility) n += countExprNodes(spec.utility);
  if (spec.is_available) n += countExprNodes(spec.is_available);
  if (spec.really_fast_gate) n += countExprNodes(spec.really_fast_gate);
  if (spec.on_fire) n += countEffectNodes(spec.on_fire.effects);
  if (spec.triggers) {
    if (spec.triggers.on_round_start) n += countEffectNodes(spec.triggers.on_round_start.effects);
    if (spec.triggers.on_take_damage) n += countEffectNodes(spec.triggers.on_take_damage.effects);
    if (spec.triggers.on_deal_damage) n += countEffectNodes(spec.triggers.on_deal_damage.effects);
    if (spec.triggers.on_status_apply) n += countEffectNodes(spec.triggers.on_status_apply.effects);
    if (spec.triggers.on_status_expire) n += countEffectNodes(spec.triggers.on_status_expire.effects);
    if (spec.triggers.on_kill) n += countEffectNodes(spec.triggers.on_kill.effects);
    if (spec.triggers.on_first_strike) n += countEffectNodes(spec.triggers.on_first_strike.effects);
    if (spec.triggers.on_tick) n += countEffectNodes(spec.triggers.on_tick.effects.effects);
    // 2026-05-12: triggers that were missing from the complexity
    // tally: on_heal / on_active_end and on_before_take_damage /
    // on_before_deal_damage. Pre-fix
    // they were "free" - large bodies didn't count against the
    // Pillar-9 ceiling. Now they're charged.
    if (spec.triggers.on_heal) n += countEffectNodes(spec.triggers.on_heal.effects);
    if (spec.triggers.on_active_end) n += countEffectNodes(spec.triggers.on_active_end.effects);
    if (spec.triggers.on_before_take_damage) n += countEffectNodes(spec.triggers.on_before_take_damage.effects);
    if (spec.triggers.on_before_deal_damage) n += countEffectNodes(spec.triggers.on_before_deal_damage.effects);
  }
  return n;
}

export function validateUserAbility(spec: UserAbilitySpec): ValidationResult {
  const errors: string[] = [];
  validateId(spec.id, "ability", errors);
  validateDisplayName(spec.display_name, errors);
  if (!spec.utility) errors.push("utility expression is required");
  else validateExpr(spec.utility, "utility", errors);
  if (!spec.is_available) errors.push("is_available expression is required");
  else validateExpr(spec.is_available, "is_available", errors);
  if (spec.really_fast_gate) {
    validateExpr(spec.really_fast_gate, "really_fast_gate", errors);
  }
  // on_fire is optional now - but if present, it must be non-empty;
  // and at least one of on_fire / a populated trigger hook must
  // exist for the spec to do anything.
  const onFirePopulated = !!spec.on_fire && spec.on_fire.effects.length > 0;
  const triggerCount = countPopulatedTriggers(spec.triggers);
  if (!onFirePopulated && triggerCount === 0) {
    errors.push(
      "spec must have either on_fire effects or at least one trigger hook",
    );
  }
  if (spec.on_fire) {
    validateBatch(spec.on_fire, "on_fire", errors);
  }
  if (spec.triggers) {
    validateTriggers(spec.triggers, errors);
  }
  // Validate level fields. The Rust path normalizes
  // (pad / truncate) scaling arrays at parse time, but we surface the
  // discrepancies up front so the UI can warn before the user hits
  // save.
  const levels = spec.levels ?? 1;
  const defaultLevel = spec.default_level ?? 1;
  if (!Number.isInteger(levels) || levels < 1) {
    errors.push(`levels must be a positive integer (got ${levels})`);
  }
  if (!Number.isInteger(defaultLevel) || defaultLevel < 1) {
    errors.push(`default_level must be a positive integer (got ${defaultLevel})`);
  } else if (Number.isInteger(levels) && defaultLevel > levels) {
    errors.push(
      `default_level ${defaultLevel} is outside 1..=${levels} (levels = ${levels})`,
    );
  }
  if (spec.scaling) {
    for (const [key, values] of Object.entries(spec.scaling)) {
      if (!Array.isArray(values)) {
        errors.push(`scaling['${key}'] must be a numeric array`);
        continue;
      }
      if (values.length !== levels) {
        errors.push(
          `scaling['${key}'] has ${values.length} entries but levels = ${levels}`,
        );
      }
      for (const [i, v] of values.entries()) {
        if (typeof v !== "number" || !Number.isFinite(v)) {
          errors.push(`scaling['${key}'][${i}] must be a finite number`);
        }
      }
    }
  }
  // Pillar-9 enforcement: refuse pathologically large specs.
  const complexity = countSpecComplexity(spec);
  if (complexity > MAX_SPEC_COMPLEXITY) {
    errors.push(
      `spec complexity ${complexity} exceeds Pillar-9 ceiling ${MAX_SPEC_COMPLEXITY}; reduce Expr depth or Repeat counts`,
    );
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function countPopulatedTriggers(t?: TriggerHooks): number {
  if (!t) return 0;
  let n = 0;
  if (t.on_round_start) n += 1;
  if (t.on_take_damage) n += 1;
  if (t.on_deal_damage) n += 1;
  if (t.on_tick) n += 1;
  if (t.on_status_apply) n += 1;
  if (t.on_status_expire) n += 1;
  if (t.on_kill) n += 1;
  if (t.on_first_strike) n += 1;
  if (t.on_heal) n += 1;
  if (t.on_active_end) n += 1;
  if (t.on_before_take_damage) n += 1;
  if (t.on_before_deal_damage) n += 1;
  return n;
}

function validateTriggers(t: TriggerHooks, errors: string[]): void {
  if (t.on_round_start) {
    validateBatch(t.on_round_start, "triggers.on_round_start", errors);
  }
  if (t.on_take_damage) {
    validateBatch(t.on_take_damage, "triggers.on_take_damage", errors);
  }
  if (t.on_deal_damage) {
    validateBatch(t.on_deal_damage, "triggers.on_deal_damage", errors);
  }
  if (t.on_tick) {
    validateTickTrigger(t.on_tick, "triggers.on_tick", errors);
  }
  if (t.on_status_apply) {
    validateBatch(t.on_status_apply, "triggers.on_status_apply", errors);
  }
  if (t.on_status_expire) {
    validateBatch(t.on_status_expire, "triggers.on_status_expire", errors);
  }
  if (t.on_kill) {
    validateBatch(t.on_kill, "triggers.on_kill", errors);
  }
  if (t.on_first_strike) {
    validateBatch(t.on_first_strike, "triggers.on_first_strike", errors);
  }
  if (t.on_heal) {
    validateBatch(t.on_heal, "triggers.on_heal", errors);
  }
  if (t.on_active_end) {
    validateBatch(t.on_active_end, "triggers.on_active_end", errors);
  }
  if (t.on_before_take_damage) {
    validateBatch(t.on_before_take_damage, "triggers.on_before_take_damage", errors);
  }
  if (t.on_before_deal_damage) {
    validateBatch(t.on_before_deal_damage, "triggers.on_before_deal_damage", errors);
  }
}

function validateTickTrigger(
  tick: TickTrigger,
  path: string,
  errors: string[],
): void {
  if (!Number.isFinite(tick.interval_sec) || tick.interval_sec <= 0) {
    errors.push(`${path}.interval_sec must be a positive number`);
  } else if (tick.interval_sec < MIN_TICK_INTERVAL_SEC) {
    errors.push(
      `${path}.interval_sec ${tick.interval_sec} below engine floor ${MIN_TICK_INTERVAL_SEC}; engine will clamp it`,
    );
  }
  validateBatch(tick.effects, `${path}.effects`, errors);
}

export function validateUserTiming(spec: UserTimingSpec): ValidationResult {
  const errors: string[] = [];
  validateId(spec.id, "timing", errors);
  validateDisplayName(spec.display_name, errors);
  if (!Array.isArray(spec.candidates) || spec.candidates.length === 0) {
    errors.push("candidates must contain at least one delay value");
  } else {
    spec.candidates.forEach((c, idx) => {
      if (!Number.isFinite(c) || c < 0) {
        errors.push(`candidates[${idx}] must be non-negative finite (got ${c})`);
      }
    });
  }
  if (!Number.isFinite(spec.horizon_sec) || spec.horizon_sec < 0) {
    errors.push("horizon_sec must be non-negative finite");
  }
  if (
    spec.threshold !== undefined &&
    (!Number.isFinite(spec.threshold) || spec.threshold < 0)
  ) {
    errors.push("threshold must be non-negative finite when set");
  }
  if (spec.force_skip) validateExpr(spec.force_skip, "force_skip", errors);
  if (spec.force_fire) validateExpr(spec.force_fire, "force_fire", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

const USER_STATUS_TICK_KINDS: ReadonlyArray<UserStatusTickKind> = [
  "none",
  "dot_flat",
  "dot_pct_max_hp",
  "heal_flat",
  "heal_pct_max_hp",
];

export function validateUserStatus(spec: UserStatusSpec): ValidationResult {
  const errors: string[] = [];
  validateId(spec.id, "status", errors);
  validateDisplayName(spec.display_name, errors);

  const finiteField = (value: number | undefined, name: string, min?: number) => {
    if (value === undefined) return;
    if (!Number.isFinite(value)) {
      errors.push(`${name} must be a finite number`);
    } else if (min !== undefined && value < min) {
      errors.push(`${name} must be >= ${min} (got ${value})`);
    }
  };

  if (spec.polarity !== undefined && !["positive", "negative", "neutral"].includes(spec.polarity)) {
    errors.push(`polarity must be positive | negative | neutral (got ${spec.polarity})`);
  }
  if (
    spec.stack_rule !== undefined &&
    !["stacking", "non_stacking", "unique"].includes(spec.stack_rule)
  ) {
    errors.push(`stack_rule must be stacking | non_stacking | unique (got ${spec.stack_rule})`);
  }
  if (spec.tick_kind !== undefined && !USER_STATUS_TICK_KINDS.includes(spec.tick_kind)) {
    errors.push(`tick_kind must be one of ${USER_STATUS_TICK_KINDS.join(" | ")} (got ${spec.tick_kind})`);
  }
  // max_stacks may be null (unbounded); only a present number is checked.
  if (spec.max_stacks !== undefined && spec.max_stacks !== null) {
    finiteField(spec.max_stacks, "max_stacks", 0);
  }
  finiteField(spec.decay_interval_sec, "decay_interval_sec", 0);
  finiteField(spec.tick_interval_sec, "tick_interval_sec", 0);
  finiteField(spec.tick_base, "tick_base");
  finiteField(spec.tick_per_stack, "tick_per_stack");
  finiteField(spec.regen_mod_pct, "regen_mod_pct");
  finiteField(spec.regen_mod_per_stack_pct, "regen_mod_per_stack_pct");
  finiteField(spec.incoming_damage_mult, "incoming_damage_mult", 0);
  finiteField(spec.outgoing_damage_mult, "outgoing_damage_mult", 0);
  finiteField(spec.bite_cooldown_mult, "bite_cooldown_mult", 0);

  // Hook batches - validated the same way abilities validate their trigger
  // batches. DSL-parsed specs are already vetted, but Visual-editor and
  // programmatic specs reach here unparsed, so don't assume pre-validation.
  if (spec.on_apply) validateBatch(spec.on_apply, "on_apply", errors);
  if (spec.on_expire) validateBatch(spec.on_expire, "on_expire", errors);
  if (spec.on_tick) validateTickTrigger(spec.on_tick, "on_tick", errors);
  if (spec.on_round_start) validateBatch(spec.on_round_start, "on_round_start", errors);
  if (spec.on_take_damage) validateBatch(spec.on_take_damage, "on_take_damage", errors);
  if (spec.on_deal_damage) validateBatch(spec.on_deal_damage, "on_deal_damage", errors);
  if (spec.on_kill) validateBatch(spec.on_kill, "on_kill", errors);
  if (spec.on_first_strike) validateBatch(spec.on_first_strike, "on_first_strike", errors);
  if (spec.on_heal) validateBatch(spec.on_heal, "on_heal", errors);
  if (spec.on_status_apply) validateBatch(spec.on_status_apply, "on_status_apply", errors);
  if (spec.on_status_expire) validateBatch(spec.on_status_expire, "on_status_expire", errors);
  if (spec.on_before_take_damage)
    validateBatch(spec.on_before_take_damage, "on_before_take_damage", errors);
  if (spec.on_before_deal_damage)
    validateBatch(spec.on_before_deal_damage, "on_before_deal_damage", errors);
  if (spec.on_decay) validateBatch(spec.on_decay, "on_decay", errors);
  if (spec.on_restack) validateBatch(spec.on_restack, "on_restack", errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
