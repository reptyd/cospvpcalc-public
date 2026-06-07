/**
 * TypeScript mirror of the Rust types in `wasm-engine/src/policy/`
 * and `wasm-engine/src/effects.rs`. The shapes match the
 * `serde(tag = "kind", rename_all = "snake_case")` JSON encoding the
 * engine accepts via `register_user_ability_js` / `register_user_timing_js`.
 *
 * Keep this file in lockstep with the Rust source. Schema mismatches
 * surface at registration time as a JSON validation error from the
 * bridge, so they are loud, but they are also annoying to debug from
 * the UI side - prefer fixing here when adding a new variant.
 */

// ── Effect primitives (mirror `wasm-engine/src/effects.rs`) ───────────────

export type EffectTarget = "caster" | "opponent";

export type EffectKind =
  | { kind: "deal_direct_damage"; target: EffectTarget; amount: number }
  | {
      kind: "deal_direct_damage_max_hp_fraction";
      target: EffectTarget;
      fraction: number;
    }
  | { kind: "heal_hp"; target: EffectTarget; amount: number }
  /** Apply N statuses in one effect through the
   * canonical resist/plushie pipeline. Each entry is processed
   * independently - one may be fully blocked while another lands.
   * Empty array is a no-op. Sibling of singular `apply_status_to_target`. */
  | {
      kind: "apply_statuses_to_target";
      target: EffectTarget;
      statuses: AppliedStatus[];
    }
  | {
      kind: "apply_status_to_target";
      target: EffectTarget;
      status: AppliedStatus;
    }
  | { kind: "cleanse_fortify_removable_statuses"; target: EffectTarget }
  | {
      kind: "set_cooldown_until";
      target: EffectTarget;
      cooldown_id: string;
      duration_sec: number;
    }
  | {
      kind: "set_active_until";
      target: EffectTarget;
      active_id: string;
      duration_sec: number;
    }
  // 2026-05-12: Expr-duration variants. DSL `cooldown self <id> for <expr>` /
  // `active self <id> for <expr>` auto-routes here when the duration text
  // isn't a plain number (e.g. `scaling.window`).
  | {
      kind: "set_cooldown_until_expr";
      target: EffectTarget;
      cooldown_id: string;
      duration_sec: Expr;
    }
  | {
      kind: "set_active_until_expr";
      target: EffectTarget;
      active_id: string;
      duration_sec: Expr;
    }
  | {
      kind: "pay_self_cost_max_hp_fraction";
      target: EffectTarget;
      fraction: number;
    }
  // Compositor variants - wrap other EffectKinds. The engine
  // routes these through a recursive dispatcher; conditionals
  // need a PolicyState snapshot at fire-time (the engine
  // adapter supplies one). Both nest arbitrarily.
  | {
      kind: "conditional";
      cond: Expr;
      then: EffectKind[];
      otherwise: EffectKind[];
    }
  | {
      kind: "repeat";
      /** Hard-clamped to MAX_REPEAT_COUNT (64) on the Rust side. */
      count: number;
      body: EffectKind[];
    }
  | {
      kind: "modify_stat";
      target: EffectTarget;
      /**
       * Snake-case field name from `SimpleCombatantStats`. Engine
       * adapter reads modifiers and applies them when
       * computing effective stats. Until then the apply path is
       * inert - spec authoring works, runtime effect doesn't.
       */
      field: string;
      mode: ModifierMode;
      value: number;
      /** `0` ⇒ permanent for the fight. */
      duration_sec: number;
    }
  | {
      kind: "trigger_ability";
      /**
       * Id of the ability whose `on_fire` to expand into the
       * current dispatch. No is_available gate, no cooldown
       * write - the trigger just borrows the effects. Engine
       * adapter resolves the id via the user-ability
       * registry; recursion capped at MAX_CHAIN_DEPTH.
       */
      ability_id: string;
    }
  | { kind: "set_hp"; target: EffectTarget; value: number }
  | {
      kind: "transfer_hp";
      from: EffectTarget;
      to: EffectTarget;
      amount: number;
    }
  | { kind: "swap_hp_ratio" }
  | {
      /**
       * FormSwap: glass-cannon ↔ tank form swap. Sugar over `modify_stat`:
       * each `stat_changes` entry lands as the same `modifier.<field>.*`
       * keys the effective-stat layer reads, then current HP reconciles to
       * the new effective max per `hp_policy`.
       */
      kind: "form_swap";
      target: EffectTarget;
      /**
       * Base-stat changes. Each mirrors a `(field, mode, value)` modify_stat;
       * `field` is a snake-case `SimpleCombatantStats` name (e.g. `health`
       * for max HP).
       */
      stat_changes: FormStatChange[];
      /** `> 0` temporary form (auto-reverts); `<= 0` permanent for the fight. */
      duration_sec: number;
      /** How current HP reconciles to the new max - on entry AND revert. */
      hp_policy: HpPolicy;
    }
  | { kind: "clear_status"; target: EffectTarget; status_id: string }
  /** Remove N statuses in one effect. Each id processed
   * independently; absent ids silently no-op. Empty array no-ops. */
  | { kind: "clear_statuses"; target: EffectTarget; status_ids: string[] }
  | {
      kind: "modify_status_stacks";
      target: EffectTarget;
      status_id: string;
      mode: ModifierMode;
      value: number;
    }
  | { kind: "dispel_all_statuses"; target: EffectTarget }
  | {
      kind: "cooldown_reset";
      target: EffectTarget;
      cooldown_id: string;
      which: TimerSlot;
    }
  | {
      kind: "interrupt_next_hit";
      target: EffectTarget;
      delay_sec: number;
    }
  | { kind: "consume_breath"; target: EffectTarget; amount: number }
  | { kind: "restore_breath"; target: EffectTarget; amount: number }
  // ── Expr-driven variants ─────────────────────────────────────
  // Compute the numeric field from an Expr against the pre-fire
  // PolicyState - opens "damage = opponent.hp * 0.5" / "heal =
  // missing_hp" / "stacks = own_status_count" patterns.
  | { kind: "deal_expr_damage"; target: EffectTarget; amount: Expr }
  | { kind: "heal_expr_amount"; target: EffectTarget; amount: Expr }
  | {
      kind: "apply_status_expr_stacks";
      target: EffectTarget;
      status_id: string;
      stacks: Expr;
      source_ability?: string | null;
    }
  | { kind: "set_hp_expr"; target: EffectTarget; value: Expr }
  | {
      kind: "modify_stat_expr";
      target: EffectTarget;
      field: string;
      mode: ModifierMode;
      value: Expr;
      duration_sec: Expr;
    }
  // ── Tier-1 building blocks ───────────────────────────────────
  | { kind: "set_extra"; target: EffectTarget; key: string; value: Expr }
  | {
      kind: "increment_extra";
      target: EffectTarget;
      key: string;
      amount: Expr;
    }
  // Numbered-key extras arrays.
  // Storage: `<key>.length` + `<key>.<i>`. Read via
  // `extras.<key>.length` / `extras.<key>.<i>` / `extras.<key>.sum` /
  // `extras.<key>.last`. `push_extra` appends; `clear_extra_array`
  // empties. Capped at 256 entries.
  | { kind: "push_extra"; target: EffectTarget; key: string; value: Expr }
  | { kind: "clear_extra_array"; target: EffectTarget; key: string }
  | {
      kind: "deal_typed_damage";
      target: EffectTarget;
      damage_type: TypedDamageKind;
      amount: number;
    }
  | {
      kind: "consume_status_for_damage";
      target: EffectTarget;
      status_id: string;
      damage_per_stack: Expr;
    }
  // ── Tier-2 / Tier-3 building blocks ──────────────────────────
  | {
      kind: "extend_status";
      target: EffectTarget;
      status_id: string;
      seconds: number;
    }
  | {
      kind: "set_status_next_decay";
      target: EffectTarget;
      status_id: string;
      absolute_time: number;
    }
  /** Set when the named status next fires its DOT tick.
   * No-op if the status isn't present on the target. The new timestamp
   * is floored at the current sim time, so passing a past value
   * collapses to "fire on the next status-tick phase". */
  | {
      kind: "set_status_next_tick";
      target: EffectTarget;
      status_id: string;
      absolute_time: number;
    }
  | { kind: "chance"; probability: Expr; then: EffectKind[] }
  /** Weighted one-of-N exclusive picker. Evaluates
   * every branch's `weight` expression (clamped >= 0), sums them,
   * rolls deterministic-pseudo-random in `[0, sum)`, fires exactly
   * one matching branch. Branches with weight 0 are skipped; if
   * every weight is 0 the effect is a no-op. */
  | {
      kind: "choose";
      branches: Array<{ weight: Expr; effects: EffectKind[] }>;
    }
  // ── Larger Tier A: snapshot/restore + delayed effects ────────
  | { kind: "record_snapshot"; target: EffectTarget; key: string }
  | { kind: "restore_snapshot"; target: EffectTarget; key: string }
  | {
      kind: "schedule_effect";
      delay_sec: number;
      effects: EffectKind[];
      /** Optional name for this scheduled entry. When
       * set, a later `cancel_schedule` or `reschedule` with the same
       * name can find this entry in the queue and act on it. Omitting
       * the name keeps the earlier fire-and-forget semantics. */
      name?: string;
    }
  /** Remove all queued scheduled entries on the
   * caster's side whose name matches. No-op if no entries match.
   * Channel-style "if I take damage, cancel my pending bomb" patterns. */
  | { kind: "cancel_schedule"; name: string }
  /** Find the first queued entry with the matching
   * name and move its due time to `time + delay_sec` (clamped to
   * [0, 600]). Multiple entries with the same name: only the first
   * moves; cancel + re-schedule if "reschedule all" is wanted. */
  | { kind: "reschedule"; name: string; delay_sec: number };

/**
 * Exhaustive registry of every `EffectKind` discriminant. The
 * `Record<EffectKind["kind"], true>` type forces the compiler to require
 * an entry for every kind - adding a new `EffectKind` variant without
 * listing it here fails `npm run build`. Pairs with the
 * constructor-coverage test (`abilityPaletteCoverage.test.ts`), which
 * asserts the Visual palette can spawn every kind so the constructor
 * stays at 100% of the DSL.
 */
const EFFECT_KIND_REGISTRY: Record<EffectKind["kind"], true> = {
  deal_direct_damage: true,
  deal_direct_damage_max_hp_fraction: true,
  deal_expr_damage: true,
  deal_typed_damage: true,
  pay_self_cost_max_hp_fraction: true,
  consume_status_for_damage: true,
  heal_hp: true,
  heal_expr_amount: true,
  set_hp: true,
  set_hp_expr: true,
  transfer_hp: true,
  swap_hp_ratio: true,
  form_swap: true,
  apply_status_to_target: true,
  apply_statuses_to_target: true,
  apply_status_expr_stacks: true,
  clear_status: true,
  clear_statuses: true,
  modify_status_stacks: true,
  dispel_all_statuses: true,
  cleanse_fortify_removable_statuses: true,
  extend_status: true,
  set_status_next_tick: true,
  set_status_next_decay: true,
  set_cooldown_until: true,
  set_cooldown_until_expr: true,
  set_active_until: true,
  set_active_until_expr: true,
  cooldown_reset: true,
  interrupt_next_hit: true,
  consume_breath: true,
  restore_breath: true,
  set_extra: true,
  increment_extra: true,
  push_extra: true,
  clear_extra_array: true,
  modify_stat: true,
  modify_stat_expr: true,
  conditional: true,
  repeat: true,
  chance: true,
  choose: true,
  schedule_effect: true,
  cancel_schedule: true,
  reschedule: true,
  record_snapshot: true,
  restore_snapshot: true,
  trigger_ability: true,
};

/** Every `EffectKind` discriminant, derived from the exhaustive registry. */
export const ALL_EFFECT_KINDS = Object.keys(
  EFFECT_KIND_REGISTRY,
) as Array<EffectKind["kind"]>;

/** Damage-routing kind for `deal_typed_damage`. */
export type TypedDamageKind = "bite" | "breath" | "true";

/** Which side-local timer slot a `cooldown_reset` clears. */
export type TimerSlot = "cooldown" | "active_until";

export type ModifierMode = "add" | "mul" | "set";

/** One base-stat change in a `form_swap` bundle (mirrors a modify_stat). */
export type FormStatChange = { field: string; mode: ModifierMode; value: number };

/**
 * Current-HP reconciliation policy for `form_swap`, applied symmetrically on
 * form entry and (for temporary forms) revert. `ratio` preserves the HP
 * fraction, `absolute` preserves the raw HP (clamped to the new max), `set`
 * sets HP to `value` (clamped).
 */
export type HpPolicy =
  | { kind: "ratio" }
  | { kind: "absolute" }
  | { kind: "set"; value: number };

/** Mirror of the Rust `MAX_CHAIN_DEPTH` constant. */
export const MAX_CHAIN_DEPTH = 4;

/**
 * Engine-side hard cap on `Repeat` count. Mirror constant for the
 * UI so we can warn the user before hand-off.
 */
export const MAX_REPEAT_COUNT = 64;

export type AppliedStatus = {
  status_id: string;
  stacks: number;
  source_ability?: string | null;
};

export type EffectBatch = {
  name: string;
  effects: EffectKind[];
  /** Optional batch-level gate. When present and the
   * expression evaluates falsy (≤ 0.5 numerically), the entire batch
   * is skipped - no effects, no combat-log event. Lets users gate a
   * trigger body without wrapping every line in `if X: ...`. Missing
   * / undefined evaluates as "no gate" (legacy behavior). */
  when?: Expr;
};

// ── Expression DSL (mirror `wasm-engine/src/policy/user_ability.rs::Expr`)

export type Expr =
  | { kind: "const"; value: number }
  | { kind: "var"; path: string }
  | { kind: "bin"; op: BinOp; left: Expr; right: Expr }
  | { kind: "una"; op: UnaryOp; operand: Expr }
  | { kind: "if"; cond: Expr; then: Expr; otherwise: Expr }
  | { kind: "clamp"; value: Expr; lo: Expr; hi: Expr }
  /** Deterministic-pseudo-random roll in `[0, 1)`.
   * Seeded from `(state.time, self.extras.len())` - same stream as
   * the `chance` effect. Multiple `rand` calls within the same
   * expression evaluation return the SAME number (eval is pure).
   * For two independent rolls use two `chance` effects or split
   * across triggers. */
  | { kind: "rand" };

export type BinOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "eq"
  | "ne"
  | "and"
  | "or"
  | "min"
  | "max"
  | "pow"
  | "mod";

export type UnaryOp =
  | "neg"
  | "not"
  | "abs"
  | "sign"
  | "floor"
  | "ceil"
  | "round"
  | "sqrt"
  | "ln"
  | "exp";

// ── Top-level specs ──────────────────────────────────────────────────────

export type UserAbilitySpec = {
  /**
   * Schema version. Default 1 for current shape; future schema
   * migrations bump this and import code routes through a
   * migration path. Optional on read for forward-compat with
   * pre-version specs (treat missing as 1).
   */
  version?: number;
  id: string; // must start with "user."
  display_name: string;
  utility: Expr;
  is_available: Expr;
  really_fast_gate?: Expr;
  /**
   * Effects when the policy picks "fire now". Optional - a purely
   * passive ability (only triggers, e.g. a custom Reflect) sets
   * this to undefined. At least one of `on_fire` / a populated
   * trigger hook must be present for the spec to validate.
   */
  on_fire?: EffectBatch;
  /**
   * Reactive trigger hooks. All optional. Hooks fire
   * unconditionally when their event happens; gating belongs
   * inside the hook (via `EffectKind` `conditional`).
   */
  triggers?: TriggerHooks;
  /**
   * Per-ability timing-mode override. When set, the policy engine
   * uses this mode to decide "fire now" instead of the session
   * default. Useful when one ability should always be ReallyFast
   * regardless of how the session is configured.
   */
  timing_mode_override?: TimingMode;
  /**
   * Per-ability override pointing at a registered custom UserTiming
   * (id starts with `user.`). Takes precedence over both
   * `timing_mode_override` and the session default. Lets the user
   * stack a custom decision policy on top of a custom decision spec.
   */
  timing_user_override?: string;
  /**
   * Total number of levels this ability has. `1`
   * (default) means no levels - the ability behaves identically to a
   * single-level spec. `> 1` opens up the `scaling` table.
   */
  levels?: number;
  /**
   * Default level the spec ships with (1-indexed,
   * clamped to `1..=levels`). Compare UI can override this per
   * matchup; otherwise this is the effective level at
   * dispatch time.
   */
  default_level?: number;
  /**
   * Named numeric scaling tables. Each entry is a
   * numeric vector of length `levels` - index `default_level - 1`
   * gives the value the engine surfaces under
   * `extras["scaling.<key>"]` at dispatch. Users read it via
   * `var("scaling.<key>")` (or the DSL form).
   *
   * Omit / leave empty for level-1-only abilities.
   */
  scaling?: Record<string, number[]>;
};

/** Mirror of Rust SimpleAbilityTimingMode. */
export type TimingMode = "really_fast" | "fast" | "semi_ideal" | "ideal" | "extreme";

/** Closed list of engine-emitted events a trigger can subscribe to. */
export type TriggerHookKey =
  | "on_round_start"
  | "on_take_damage"
  | "on_deal_damage"
  | "on_tick"
  | "on_status_apply"
  | "on_status_expire"
  | "on_kill"
  | "on_first_strike"
  | "on_heal"
  | "on_active_end"
  | "on_before_take_damage"
  | "on_before_deal_damage";

export type TriggerHooks = {
  /** Fired once at t=0 for the side that owns this ability. */
  on_round_start?: EffectBatch;
  /**
   * Fired when the actor took damage in the last engine
   * iteration. PolicyState extras carry `event.damage_taken`
   * (the delta) for the duration of the dispatch.
   */
  on_take_damage?: EffectBatch;
  /** Same shape as `on_take_damage` but for damage dealt. */
  on_deal_damage?: EffectBatch;
  /** Periodic firing every `interval_sec`. */
  on_tick?: TickTrigger;
  /**
   * Fired when one or more new statuses were applied in the last
   * iteration. event.applied_status_count carries the count.
   */
  on_status_apply?: EffectBatch;
  /**
   * Fired when one or more statuses were removed (decayed/cleansed).
   * event.expired_status_count carries the count.
   */
  on_status_expire?: EffectBatch;
  /**
   * Fired when this side's action killed the opponent in this
   * iteration. event.damage_dealt carries the final-blow magnitude.
   */
  on_kill?: EffectBatch;
  /**
   * Fired on first-strike state transition. event.first_strike_active
   * = 1 if newly active, 0 if newly inactive.
   */
  on_first_strike?: EffectBatch;
  /** Fired when actor received healing this iteration.
   * event.heal_amount = sum of healing applied. Covered sources:
   * passive HP regen + user heal_hp / heal_expr_amount / set_hp(_expr)
   * raising HP + transfer_hp recipient. NOT covered yet: built-in
   * life leech / Healing Pulse / Healing Ailment / Cocoon phase 2. */
  on_heal?: EffectBatch;
  /** Fired when one or more user `active_until` windows
   * expired naturally this iteration. event.ended.<ability_id> = 1.0
   * for each id whose window just elapsed. Limited to user.* keys -
   * built-in active windows ending (Fortify/Harden/etc.) do not fire
   * this trigger yet. */
  on_active_end?: EffectBatch;
  /** Fires on the victim immediately before HP
   * changes apply (after built-in mitigation, before Reflect). Extras
   * carry event.raw_damage / event.damage_taken / event.prevented_damage
   * / event.source_ability (currently only "bite" - breath/DOT/etc.
   * are pass-through for now). Handler can write
   * `set_extra self damage_override = N` (note: NO event. prefix on
   * the key) to replace the final amount. ≥ 0 clamps; the spec is
   * never mutated. Enables shields / parry / absorb. */
  on_before_take_damage?: EffectBatch;
  /** Symmetric - fires on the dealer just before its
   * damage lands. Handler can write `damage_override` to amplify or
   * zero outgoing damage. Fires BEFORE on_before_take_damage on the
   * other side so the victim sees the post-amplification number. */
  on_before_deal_damage?: EffectBatch;
};

export type TickTrigger = {
  /** Engine clamps to a 0.05s floor at dispatch. */
  interval_sec: number;
  effects: EffectBatch;
};

/** Engine-side floor on TickTrigger.interval_sec. */
export const MIN_TICK_INTERVAL_SEC = 0.05;

export type UserTimingSpec = {
  id: string; // must start with "user."
  display_name: string;
  candidates: number[];
  horizon_sec: number;
  threshold?: number;
  force_skip?: Expr;
  force_fire?: Expr;
};

// ── User-defined statuses ─────────────────────────────────

export type UserStatusPolarity = "positive" | "negative" | "neutral";
export type UserStatusStackRule = "stacking" | "non_stacking" | "unique";
export type UserStatusTickKind =
  | "none"
  | "dot_flat"
  | "dot_pct_max_hp"
  | "heal_flat"
  | "heal_pct_max_hp";

/**
 * User-defined status spec (Custom Abilities v2). Mirrors the
 * Rust `UserStatusSpec` (wasm-engine/src/user_status.rs) field-for-field in
 * snake_case, so `JSON.stringify(spec)` feeds the engine's serde directly -
 * no transform, same posture as `UserTimingSpec`. A custom status is a
 * curated PARAMETRIC definition (fixed knobs), not arbitrary code. Every
 * field except `id` / `display_name` is optional and defaults engine-side.
 */
export type UserStatusSpec = {
  id: string; // must start with "user."
  display_name: string;
  version?: number;
  polarity?: UserStatusPolarity;
  stack_rule?: UserStatusStackRule;
  /** Stack cap; `null` / omitted = unbounded. */
  max_stacks?: number | null;
  /** Seconds for one stack to decay off. Default 3. */
  decay_interval_sec?: number;
  tick_kind?: UserStatusTickKind;
  /** Per-tick base amount (flat HP, or %-max-hp points for the pct kinds). */
  tick_base?: number;
  /** Additional per-stack amount per tick. */
  tick_per_stack?: number;
  /** Seconds between ticks; `<= 0` / omitted = no periodic tick. */
  tick_interval_sec?: number;
  /** Flat additive HP-regen % modifier while present (−100 blocks regen). */
  regen_mod_pct?: number;
  regen_mod_per_stack_pct?: number;
  /** Multiplier on damage TAKEN by the bearer (1 = neutral). */
  incoming_damage_mult?: number;
  /** Multiplier on damage DEALT by the bearer (1 = neutral). */
  outgoing_damage_mult?: number;
  /** Multiplier on the bearer's bite cooldown (1 = neutral, 0.8 = faster). */
  bite_cooldown_mult?: number;
  // Cleanse-eligibility is NOT a field: Fortify-removability is derived from
  // `polarity` (negative → removable), unified with built-in statuses.

  // ── Programmable statuses: optional ability-like extensions.
  //    A spec with none of these is a pure parametric status (engine-side
  //    byte-identical). Behaviour rides with the status onto any bearer:
  //    hooks fire with the bearer as caster, and any stat modifier a hook
  //    installs is torn down when the status leaves the creature.

  /** Fired once when the status first appears on a creature (bearer = caster).
   *  Does NOT re-fire on restack - scale per-stack via Expr over status.stacks. */
  on_apply?: EffectBatch;
  /** Fired once when the status leaves the creature. After it runs, every
   *  stat modifier the status installed is stripped and HP reconciled per the
   *  installing `form_swap`'s own `hp_policy` (proportional by default) - the
   *  reconcile is block-controlled, not a separate per-status knob. */
  on_expire?: EffectBatch;
  /** Periodic hook fired on its own cadence while present (bearer = caster).
   *  Reuses the ability `TickTrigger` shape. */
  on_tick?: TickTrigger;

  // ── Bearer-reactive triggers (status↔ability parity). These fire when the
  //    BEARER experiences a combat event (bearer = caster, other side =
  //    opponent), sharing the same per-iteration deltas the ability triggers
  //    consume. Each carries `event.<key>` context for the batch's Exprs.
  //    NOTE on_apply/on_expire above are about THIS status; on_status_apply /
  //    on_status_expire below react to ANOTHER status arriving/leaving.
  /** Fired once at t=0 for a status present at fight start. */
  on_round_start?: EffectBatch;
  /** Fired when the bearer took damage this iteration (`event.damage_taken`). */
  on_take_damage?: EffectBatch;
  /** Fired when the bearer dealt damage this iteration (`event.damage_dealt`). */
  on_deal_damage?: EffectBatch;
  /** Fired when the bearer killed the opponent this iteration. */
  on_kill?: EffectBatch;
  /** Fired when the bearer's first-strike state changed (`event.first_strike_active`). */
  on_first_strike?: EffectBatch;
  /** Fired when the bearer received healing this iteration (`event.heal_amount`). */
  on_heal?: EffectBatch;
  /** Fired when ANOTHER status was applied to the bearer (`event.applied.<id>`). */
  on_status_apply?: EffectBatch;
  /** Fired when ANOTHER status left the bearer (`event.expired.<id>`). */
  on_status_expire?: EffectBatch;
  /** Pre-mitigation hook before the bearer TAKES damage (shield/absorb): may
   *  write `set_extra self damage_override = N`. `event.raw_damage` /
   *  `event.damage_taken` / `event.prevented_damage` / `event.is_bite|breath|dot`. */
  on_before_take_damage?: EffectBatch;
  /** Pre-mitigation hook before the bearer DEALS damage (amp): same surface. */
  on_before_deal_damage?: EffectBatch;
  /** Fired when this SURVIVING status loses stacks (decay / partial cleanse).
   *  `event.stacks_lost`. A drop to 0 is `on_expire`, not this. */
  on_decay?: EffectBatch;
  /** Fired when this already-present status gains stacks (re-applied).
   *  `event.stacks_gained`. The absent→present case is `on_apply`. */
  on_restack?: EffectBatch;

  // ── Expr overrides for the numeric knobs. When set, the engine resolves the
  //    expression (over status.stacks / status.max_hp / time / self.*) each
  //    iteration and uses it in place of the static knob above.
  /** Overrides the combined per-tick magnitude (otherwise tick_base +
   *  tick_per_stack·stacks; still scaled to max-hp for the pct kinds). */
  tick_amount_expr?: Expr;
  incoming_damage_mult_expr?: Expr;
  outgoing_damage_mult_expr?: Expr;
  bite_cooldown_mult_expr?: Expr;
  /** Overrides the combined regen modifier (otherwise regen_mod_total_pct). */
  regen_mod_expr?: Expr;
};

/**
 * Constructor-coverage lock for user statuses.
 *
 * Compile-time-exhaustive map of every `UserStatusSpec` field to whether
 * the visual constructor (`StatusEditor`) surfaces a control for it, or it
 * is engine/metadata-internal. `tsc` forces an entry for every key - adding
 * a field to `UserStatusSpec` without classifying it here fails the build.
 * Pairs with `statusConstructorCoverage.test.ts`, which asserts the editor
 * exposes a control for every `"editor"` field so the constructor stays at
 * 100% of the schema (mirrors `EFFECT_KIND_REGISTRY` for ability effects).
 */
const STATUS_SPEC_FIELD_REGISTRY: Record<
  keyof UserStatusSpec,
  // "editor"   - a flat parametric field-card in the visual editor (the status
  //              identity + stacking/decay shape).
  // "blocks"   - authored via the block constructor / DSL (lifecycle + reactive
  //              hooks); covered by the lossless round-trip + palette locks.
  // "legacy"   - parametric Periodic-tick + Combat-modifier knobs (and their
  //              Expr overrides) RETIRED from the authoring UI: behaviour now
  //              lives in hooks (on_tick for periodic, modify_stat for
  //              cooldown/regen, pre-damage hooks for damage scaling). The
  //              fields remain on the spec for backward-compat - saved statuses
  //              keep working and the engine seams still read them - so they're
  //              covered by the DSL round-trip lock, NOT offered in the editor.
  // "internal" - engine/metadata, not user-authored.
  "editor" | "blocks" | "legacy" | "internal"
> = {
  id: "editor",
  display_name: "editor",
  // Schema-version stamp, not a user knob (parity with UserAbilitySpec.version).
  version: "internal",
  polarity: "editor",
  stack_rule: "editor",
  max_stacks: "editor",
  decay_interval_sec: "editor",
  // Retired parametric knobs (kept for backward-compat; authored via hooks now).
  tick_kind: "legacy",
  tick_base: "legacy",
  tick_per_stack: "legacy",
  tick_interval_sec: "legacy",
  regen_mod_pct: "legacy",
  regen_mod_per_stack_pct: "legacy",
  incoming_damage_mult: "legacy",
  outgoing_damage_mult: "legacy",
  bite_cooldown_mult: "legacy",
  // Lifecycle + reactive hooks - the block constructor / DSL.
  on_apply: "blocks",
  on_expire: "blocks",
  on_tick: "blocks",
  on_round_start: "blocks",
  on_take_damage: "blocks",
  on_deal_damage: "blocks",
  on_kill: "blocks",
  on_first_strike: "blocks",
  on_heal: "blocks",
  on_status_apply: "blocks",
  on_status_expire: "blocks",
  on_before_take_damage: "blocks",
  on_before_deal_damage: "blocks",
  on_decay: "blocks",
  on_restack: "blocks",
  // Expr overrides of the retired parametric knobs - legacy alongside them.
  tick_amount_expr: "legacy",
  incoming_damage_mult_expr: "legacy",
  outgoing_damage_mult_expr: "legacy",
  bite_cooldown_mult_expr: "legacy",
  regen_mod_expr: "legacy",
};

/** Every `UserStatusSpec` field, derived from the exhaustive registry. */
export const ALL_STATUS_SPEC_FIELDS = Object.keys(
  STATUS_SPEC_FIELD_REGISTRY,
) as Array<keyof UserStatusSpec>;

/** Fields the visual status constructor must expose a flat control for. */
export const EDITABLE_STATUS_SPEC_FIELDS = ALL_STATUS_SPEC_FIELDS.filter(
  (field) => STATUS_SPEC_FIELD_REGISTRY[field] === "editor",
);

/**
 * Hook fields authored via the block constructor / DSL. Covered by the lossless
 * Code↔Visual round-trip + palette locks rather than a flat field-card - see
 * `statusConstructorCoverage.test.ts`.
 */
export const BLOCK_STATUS_SPEC_FIELDS = ALL_STATUS_SPEC_FIELDS.filter(
  (field) => STATUS_SPEC_FIELD_REGISTRY[field] === "blocks",
);

/**
 * Retired parametric knobs (Periodic tick + Combat modifiers + their Expr
 * overrides). Kept on the spec for backward-compat - the engine still reads
 * them and saved statuses round-trip - but NOT offered in the editor. Covered
 * by the DSL round-trip lock only.
 */
export const LEGACY_STATUS_SPEC_FIELDS = ALL_STATUS_SPEC_FIELDS.filter(
  (field) => STATUS_SPEC_FIELD_REGISTRY[field] === "legacy",
);

// ── Engine bridge response shapes ────────────────────────────────────────

/**
 * Shape returned by `register_user_ability_js` /
 * `register_user_timing_js` on success. The bridge throws on
 * validation failure; success path is always this object.
 */
export type RegistrationResult = {
  ok: true;
  id: string;
  display_name: string;
};

/**
 * Shape returned by `list_user_abilities_js` / `list_user_timings_js`.
 * Engine-internal listing - confirms the local cache and the WASM-side
 * registry agree after a `restore` or page reload.
 */
export type EngineRegistryEntry = {
  id: string;
  display_name: string;
};
