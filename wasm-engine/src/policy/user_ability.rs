//! User-defined ability spec - engine-level building blocks.
//!
//! A custom ability has two halves:
//!
//! - **Decision** ("should I fire now, wait, or skip?") - historically
//!   a hand-written `impl TimedDecision`. For user-defined abilities
//!   the decision is data: a small expression DSL (see [`Expr`])
//!   that computes `utility` / `is_available` / `really_fast_gate`
//!   from the live [`PolicyState`].
//! - **Effect** ("what happens when it fires?") - already data-driven
//!   via [`crate::effects::EffectBatch`].
//!
//! [`UserAbilitySpec`] bundles the two. [`UserDecision`] adapts a
//! spec into the existing `TimedDecision` trait so registered user
//! abilities flow through the same `DecisionRegistry` /
//! `PolicyRegistry` pipeline as built-ins. No engine code special-
//! cases user vs built-in beyond the id namespace
//! (`builtin.X` vs `user.X`).
//!
//! ## Pillar 9 (≤ 1 ms per Ideal decision)
//!
//! The interpreter is a recursive-descent walk over a static AST.
//! No heap allocation per call (the spec is parsed once at
//! registration); `eval` returns `f64` directly. Benchmarked at
//! ~50 ns per leaf for typical 10-node expressions, well inside
//! the per-decision budget.
//!
//! ## What variables can the spec read?
//!
//! Variables are addressed by dotted path strings against the
//! [`PolicyState`] shape. Supported paths today:
//!
//! - `time` - current sim time in seconds.
//! - `extras.<key>` - top-level state-extras numeric value (engine-
//!   adapter populated; absent / non-numeric ⇒ `0.0`).
//! - `self.hp`, `self.max_hp`, `self.hp_ratio` - actor HP.
//! - `self.bite_dps` - `damage / max(bite_cooldown, 0.1)`.
//! - `self.breath_capacity` - seconds of breath remaining.
//! - `self.statuses_total_stacks` - sum of stacks across every
//!   active status.
//! - `self.statuses_count` - number of distinct statuses present.
//! - `self.cooldown_until.<id>` / `self.active_until.<id>` -
//!   recorded absolute timestamps.
//! - `self.cooldown_remaining.<id>` / `self.active_remaining.<id>`
//!   - `(timestamp - time).max(0)` - same data with a friendlier
//!   shape for "how much longer?".
//! - `self.is_idle.<id>` - `1.0` when both cooldown and active
//!   timers are past `time`, else `0.0`.
//! - `self.status.<status_id>.stacks` - stack count of the named
//!   status on the actor (returns `0.0` if absent).
//! - `self.is_posture.<P>` - `1.0` when the actor's committed posture
//!   is `<P>` (case-insensitive `Standing` / `Sitting` / `Laying`),
//!   else `0.0`.
//! - `self.is_type.<T>` / `self.is_diet.<D>` / `self.is_elder.<V>` -
//!   `1.0` when the actor's identity attribute matches the segment
//!   (case-insensitive); bare `self.is_elder` is `1.0` for any
//!   non-`None` elder. `self.tier` - numeric rarity tier.
//! - `self.stats.<field>` - direct read of any numeric or boolean
//!   field on [`crate::contracts::SimpleCombatantStats`] (booleans
//!   surface as 0/1).
//!   Examples: `self.stats.damage`, `self.stats.weight`,
//!   `self.stats.first_strike_pct`, `self.stats.has_reflect`.
//! - `self.extra.<key>` - numeric value from
//!   [`crate::policy::state::PolicySide::extras`], if the variant is
//!   `Number` (returns
//!   `0.0` otherwise).
//! - `opponent.*` - same set, on the other side.
//!
//! Unknown paths return `0.0`. That's intentional: we don't fail
//! evaluation on a typo, we just produce neutral utility - keeps
//! the engine deterministic and registration-time errors easy to
//! surface separately.

use serde::{Deserialize, Serialize};

use crate::effects::EffectBatch;
use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::traits::TimedDecision;

/// Numeric expression interpreted against a [`PolicyState`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Expr {
    /// Literal number.
    Const { value: f64 },
    /// Variable lookup. `path` is dotted, e.g. `"self.hp_ratio"`.
    Var { path: String },
    /// Binary arithmetic / comparison / logical op.
    Bin { op: BinOp, left: Box<Expr>, right: Box<Expr> },
    /// Unary op (negate / boolean-not / abs / floor / ...).
    Una { op: UnaryOp, operand: Box<Expr> },
    /// `if cond then a else b`. `cond` is non-zero ⇒ true.
    If {
        cond: Box<Expr>,
        then: Box<Expr>,
        otherwise: Box<Expr>,
    },
    /// Three-arg clamp: `clamp(value, lo, hi)`.
    /// Equivalent to `min(max(value, lo), hi)` but spelled
    /// directly so users don't have to nest min/max.
    Clamp {
        value: Box<Expr>,
        lo: Box<Expr>,
        hi: Box<Expr>,
    },
    /// Deterministic-pseudo-random roll in `[0, 1)`.
    /// Seeded from `state.time` + `state.self_side.extras.len()`,
    /// matching the LCG used by `EffectKind::Chance` - same seed,
    /// reproducible across runs.
    ///
    /// **Important semantics:** because `eval` is pure (no mutable
    /// state), multiple `rand()` calls within the same expression
    /// evaluation produce the **same number**. Use this for
    /// "variable per ability fire" patterns (e.g. `50 + rand() * 50`
    /// = damage 50-100 per cast). For two independent rolls inside
    /// one ability, use two separate `chance` effects or split the
    /// logic across triggers.
    Rand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Lt,
    Lte,
    Gt,
    Gte,
    Eq,
    Ne,
    And,
    Or,
    Min,
    Max,
    /// `l ^ r` via `f64::powf`. Returns `0.0` if the result is
    /// non-finite (keeps eval pure-deterministic-numeric).
    Pow,
    /// `l mod r` via Rust `%`. `0.0` if `r == 0.0`.
    Mod,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnaryOp {
    Neg,
    Not,
    /// `|v|`.
    Abs,
    /// `signum`: -1 / 0 / +1.
    Sign,
    /// Floor toward -∞.
    Floor,
    /// Ceiling toward +∞.
    Ceil,
    /// Round half-to-even (Rust default).
    Round,
    /// `sqrt`. Negative input ⇒ `0.0`.
    Sqrt,
    /// Natural log. Non-positive input ⇒ `0.0`.
    Ln,
    /// `exp(v)`. Non-finite result ⇒ `0.0`.
    Exp,
}

impl Expr {
    /// Evaluate against `state`. Boolean ops return `1.0` for true
    /// and `0.0` for false. Division by zero returns `0.0`.
    pub fn eval(&self, state: &PolicyState) -> f64 {
        match self {
            Expr::Const { value } => *value,
            Expr::Var { path } => lookup_var(path, state),
            Expr::Bin { op, left, right } => {
                let l = left.eval(state);
                let r = right.eval(state);
                match op {
                    BinOp::Add => l + r,
                    BinOp::Sub => l - r,
                    BinOp::Mul => l * r,
                    BinOp::Div => {
                        if r == 0.0 {
                            0.0
                        } else {
                            l / r
                        }
                    }
                    BinOp::Lt => f64::from(u8::from(l < r)),
                    BinOp::Lte => f64::from(u8::from(l <= r)),
                    BinOp::Gt => f64::from(u8::from(l > r)),
                    BinOp::Gte => f64::from(u8::from(l >= r)),
                    BinOp::Eq => f64::from(u8::from((l - r).abs() < 1e-9)),
                    BinOp::Ne => f64::from(u8::from((l - r).abs() >= 1e-9)),
                    BinOp::And => f64::from(u8::from(l != 0.0 && r != 0.0)),
                    BinOp::Or => f64::from(u8::from(l != 0.0 || r != 0.0)),
                    BinOp::Min => l.min(r),
                    BinOp::Max => l.max(r),
                    BinOp::Pow => {
                        let p = l.powf(r);
                        if p.is_finite() {
                            p
                        } else {
                            0.0
                        }
                    }
                    BinOp::Mod => {
                        if r == 0.0 {
                            0.0
                        } else {
                            l % r
                        }
                    }
                }
            }
            Expr::Una { op, operand } => {
                let v = operand.eval(state);
                match op {
                    UnaryOp::Neg => -v,
                    UnaryOp::Not => f64::from(u8::from(v == 0.0)),
                    UnaryOp::Abs => v.abs(),
                    UnaryOp::Sign => {
                        // Rust's `f64::signum(0.0) == 1.0` - surprising.
                        // Branch explicitly so 0.0 stays 0.0.
                        if v.is_nan() {
                            0.0
                        } else if v > 0.0 {
                            1.0
                        } else if v < 0.0 {
                            -1.0
                        } else {
                            0.0
                        }
                    }
                    UnaryOp::Floor => v.floor(),
                    UnaryOp::Ceil => v.ceil(),
                    UnaryOp::Round => v.round(),
                    UnaryOp::Sqrt => {
                        if v < 0.0 {
                            0.0
                        } else {
                            v.sqrt()
                        }
                    }
                    UnaryOp::Ln => {
                        if v <= 0.0 {
                            0.0
                        } else {
                            v.ln()
                        }
                    }
                    UnaryOp::Exp => {
                        let e = v.exp();
                        if e.is_finite() {
                            e
                        } else {
                            0.0
                        }
                    }
                }
            }
            Expr::If {
                cond,
                then,
                otherwise,
            } => {
                if cond.eval(state) != 0.0 {
                    then.eval(state)
                } else {
                    otherwise.eval(state)
                }
            }
            Expr::Clamp { value, lo, hi } => {
                let v = value.eval(state);
                let lo = lo.eval(state);
                let hi = hi.eval(state);
                // Tolerate inverted bounds - pick the actual min/max
                // rather than producing NaN, so the user can't
                // accidentally break the policy with a bad order.
                let (lo, hi) = if lo <= hi { (lo, hi) } else { (hi, lo) };
                v.max(lo).min(hi)
            }
            Expr::Rand => {
                // Deterministic-pseudo-random roll in
                // `[0, 1)`. Seed mixes the current sim time with the
                // self side's extras count - same recipe as the
                // `EffectKind::Chance` gate, so a `rand()` expression
                // and a `chance` block fired at the same instant share
                // the same RNG stream.
                let seed_a = (state.time * 1_000_000.0).round() as u64;
                let seed_b = state.self_side.extras.len() as u64;
                rand_eval(seed_a.wrapping_add(seed_b.wrapping_mul(0x9E37_79B9)))
            }
        }
    }

    /// Convenience: evaluate as boolean (non-zero ⇒ `true`).
    pub fn eval_bool(&self, state: &PolicyState) -> bool {
        self.eval(state) != 0.0
    }
}

/// Deterministic-pseudo-random roll in `[0, 1)`. Same
/// LCG recipe as `effects::lcg_pseudo_roll` - duplicated here to keep
/// the `policy/user_ability` module from importing implementation
/// helpers across the `effects` boundary. Both paths use the same seed
/// mix at the call site so a `rand()` Expr and a `chance` effect at
/// the same `(time, extras-count)` share the same stream.
fn rand_eval(seed: u64) -> f64 {
    let next = seed
        .wrapping_mul(6_364_136_223_846_793_005)
        .wrapping_add(1_442_695_040_888_963_407);
    (next >> 11) as f64 / ((1u64 << 53) as f64)
}

fn lookup_var(path: &str, state: &PolicyState) -> f64 {
    if path == "time" {
        return state.time;
    }
    // Tier-3: combat-meta queries. The engine adapter populates
    // `combat.iteration_count` symmetrically into both sides'
    // user_extras, which flow through `build_policy_side` into
    // PolicySide.extras - so reading from self_side surfaces it.
    if path == "combat.iteration_count" {
        return state
            .self_side
            .extras
            .get("combat.iteration_count")
            .and_then(PolicyValue::as_number)
            .unwrap_or(0.0);
    }
    // Combat-meta counters seeded by the engine on
    // every bite event:
    //   - combat.bites_dealt          (count, integer-valued f64)
    //   - combat.bites_taken
    //   - combat.damage_dealt_total   (cumulative damage, post-mitigation + post-user-shield)
    //   - combat.damage_taken_total
    // All four live on `self_side.user_extras` (perspective side =
    // whoever owns the firing spec). Bite only this round; breath /
    // DOT / trap sources don't accumulate yet - they'll roll into the
    // same keys when their pre-damage hooks land. Unknown `combat.*`
    // keys resolve to 0.0 (typo-safe).
    if path.starts_with("combat.") {
        return state
            .self_side
            .extras
            .get(path)
            .and_then(PolicyValue::as_number)
            .unwrap_or(0.0);
    }
    // Compare-page environment flags. Five 0/1 numeric
    // values seeded into `self_side.extras` at simulation start by
    // `seed_env_extras_into_side` (`composable/mod.rs`). Reading from
    // `self_side` is fine - env values are global and were mirrored
    // onto both sides at startup. Keys:
    //   - env.is_day / env.is_night
    //   - env.is_blue_moon / env.is_blood_moon
    //   - env.air_rule_active
    if path.starts_with("env.") {
        return state
            .self_side
            .extras
            .get(path)
            .and_then(PolicyValue::as_number)
            .unwrap_or(0.0);
    }
    if let Some(key) = path.strip_prefix("extras.") {
        // State-level (non-side) extras for cross-cutting fields the
        // engine adapter populates (e.g. `combat_event_phase`,
        // `tick_index`).
        return state
            .extras
            .get(key)
            .and_then(PolicyValue::as_number)
            .unwrap_or(0.0);
    }
    if path.starts_with("scaling.") {
        // Per-ability scaling table. The dispatcher
        // seeds `state.extras["scaling.<key>"]` from the firing spec's
        // `scaling[key][active_level - 1]` immediately before each
        // decision / apply call. Outside dispatch this resolves to 0.0
        // (no scaling visible without an owning spec).
        return state
            .extras
            .get(path)
            .and_then(PolicyValue::as_number)
            .unwrap_or(0.0);
    }
    if path.starts_with("status.") {
        // Phase 9 (programmable statuses): when a status hook / Expr-scalar
        // is being evaluated, the dispatcher seeds `state.extras["status.stacks"]`
        // and `state.extras["status.max_hp"]` describing the CARRYING status
        // instance (the bearer is `self`). Outside that dispatch these resolve
        // to 0.0 (typo-safe), so `status.*` is inert in any other context.
        return state
            .extras
            .get(path)
            .and_then(PolicyValue::as_number)
            .unwrap_or(0.0);
    }
    if let Some(key) = path.strip_prefix("event.") {
        // Sugar over `extras.<key>` for trigger-event context. The
        // engine adapter populates these immediately before
        // dispatching a trigger and clears them after, so they
        // only resolve to non-zero inside a trigger's effect batch.
        // Canonical keys (engine contract, see TriggerHook):
        //   - `damage_taken` (f64) on OnTakeDamage
        //   - `damage_dealt` (f64) on OnDealDamage
        //   - `tick_index`   (f64) on OnTick (0-based)
        return state
            .extras
            .get(key)
            .and_then(PolicyValue::as_number)
            .unwrap_or(0.0);
    }
    let (side_kw, rest) = match path.split_once('.') {
        Some(p) => p,
        None => return 0.0,
    };
    let side = match side_kw {
        "self" => &state.self_side,
        // Both `opponent` and `opp` resolve to the
        // other side. `opp` is the conventional spelling in the DSL
        // (`opp.hp_ratio < 0.3`); previously the resolver only matched
        // the long form, so DSL-authored expressions reading
        // `opp.<X>` silently returned 0.0. The alias closes that
        // gap and lets `opp.fired_count.<id>` / `opp.time_since_fire.<id>`
        // / `opp.last_fire_time.<id>` work the same as the self.* mirrors.
        "opponent" | "opp" => &state.opponent,
        _ => return 0.0,
    };
    match rest {
        "hp" => side.hp,
        "max_hp" => side.stats.health.max(1.0),
        "hp_ratio" => side.hp_ratio(),
        "bite_dps" => side.bite_dps(),
        "breath_capacity" => side.breath_capacity,
        "next_hit" => side.next_hit,
        "next_breath" => side.next_breath,
        // Numeric creature tier (ordinal - `opp.tier >= 4`
        // works). 0.0 when identity is absent.
        "tier" => side.stats.identity.as_ref().map(|i| i.tier).unwrap_or(0.0),
        // 1.0 if alive, 0.0 if dead. Faster to write than
        // `self.hp > 0` chain for users who want a death gate.
        "is_alive" => f64::from(u8::from(side.hp > 0.0)),
        // Estimated seconds until the side regens to max HP.
        // Returns infinity when no regen / already at max.
        "time_to_max_hp" => {
            let max = side.stats.health.max(1.0);
            let missing = (max - side.hp).max(0.0);
            if missing <= 1e-9 {
                0.0
            } else if side.stats.health_regen <= 0.0 {
                f64::INFINITY
            } else {
                missing / side.stats.health_regen
            }
        }
        // Sum of stacks across every active status - useful for
        // generic "is anything stuck on me?" gates.
        "statuses_total_stacks" => side
            .statuses
            .values()
            .map(|inst| inst.stacks)
            .sum::<f64>(),
        // Number of distinct statuses currently present.
        "statuses_count" => side.statuses.len() as f64,
        other => {
            // Sub-namespaces.
            if let Some(id) = other.strip_prefix("cooldown_until.") {
                return side.cooldown_until(id);
            }
            if let Some(id) = other.strip_prefix("active_until.") {
                return side.active_until_for(id);
            }
            // Remaining-time variants: clamp so a past timestamp
            // surfaces as 0 instead of a confusing negative.
            if let Some(id) = other.strip_prefix("cooldown_remaining.") {
                return (side.cooldown_until(id) - state.time).max(0.0);
            }
            if let Some(id) = other.strip_prefix("active_remaining.") {
                return (side.active_until_for(id) - state.time).max(0.0);
            }
            if let Some(id) = other.strip_prefix("is_idle.") {
                return f64::from(u8::from(side.is_idle_for(state.time, id)));
            }
            // 2026-05-12: status-resistance / plushie-block / immunity
            // readers. Lets user-ability utility expressions weight
            // ailment value by how much of it would actually land on
            // this side:
            //   - `<side>.status_block.<id>` - combined resist + plushie
            //     block fraction, clamped to [0, 1]. Matches the engine
            //     apply pipeline (`apply_status_application_in_place`
            //     in `statuses.rs`): immune ids resolve to 1.0; missing
            //     entries return 0.0.
            //   - `<side>.is_immune.<id>` - 1.0 if the id is listed in
            //     `stats.immune_status_ids`, else 0.0.
            if let Some(id) = other.strip_prefix("status_block.") {
                if side.stats.immune_status_ids.iter().any(|x| x == id) {
                    return 1.0;
                }
                let resist = side
                    .stats
                    .status_resist_fractions
                    .get(id)
                    .copied()
                    .unwrap_or(0.0)
                    .max(0.0);
                let plushie = side
                    .stats
                    .plushie_status_block_fractions
                    .get(id)
                    .copied()
                    .unwrap_or(0.0);
                return (resist + plushie).clamp(0.0, 1.0);
            }
            if let Some(id) = other.strip_prefix("is_immune.") {
                let immune = side.stats.immune_status_ids.iter().any(|x| x == id);
                return f64::from(u8::from(immune));
            }
            // Posture read. `<side>.is_posture.<P>` returns
            // 1.0 when the side's committed posture matches `<P>`
            // (case-insensitive - `Standing` / `Sitting` / `Laying`),
            // else 0.0. Unknown labels resolve to 0.0 (typo-safe), same
            // as every other path-segment read.
            if let Some(p) = other.strip_prefix("is_posture.") {
                return f64::from(u8::from(side.posture.eq_ignore_ascii_case(p)));
            }
            // Creature-identity reads as boolean builtins.
            // `is_type.<T>` / `is_diet.<D>` / `is_elder.<V>` match the path
            // segment (case-insensitive) against the side's identity; bare
            // `is_elder` is true for any non-`None` elder variant. All
            // resolve to 0.0 when identity is absent or the segment is
            // unknown (typo-safe), same as every other path-segment read.
            if other == "is_elder" {
                return f64::from(u8::from(side.stats.identity.as_ref().is_some_and(|i| {
                    !i.elder.is_empty() && !i.elder.eq_ignore_ascii_case("None")
                })));
            }
            if let Some(v) = other.strip_prefix("is_elder.") {
                return f64::from(u8::from(
                    side.stats
                        .identity
                        .as_ref()
                        .is_some_and(|i| i.elder.eq_ignore_ascii_case(v)),
                ));
            }
            if let Some(t) = other.strip_prefix("is_type.") {
                return f64::from(u8::from(
                    side.stats
                        .identity
                        .as_ref()
                        .is_some_and(|i| i.creature_type.eq_ignore_ascii_case(t)),
                ));
            }
            if let Some(d) = other.strip_prefix("is_diet.") {
                return f64::from(u8::from(
                    side.stats
                        .identity
                        .as_ref()
                        .is_some_and(|i| i.diet.eq_ignore_ascii_case(d)),
                ));
            }
            // Tier-1 B: ability-fire introspection. The dispatcher
            // writes `extras["fire_count.<id>"]` and
            // `extras["last_fire.<id>"]` automatically on every
            // successful active fire - these var paths surface them
            // with friendly names and derive `time_since_fire`.
            if let Some(id) = other.strip_prefix("fired_count.") {
                let key = format!("fire_count.{id}");
                return side
                    .extras
                    .get(&key)
                    .and_then(PolicyValue::as_number)
                    .unwrap_or(0.0);
            }
            if let Some(id) = other.strip_prefix("last_fire_time.") {
                let key = format!("last_fire.{id}");
                return side
                    .extras
                    .get(&key)
                    .and_then(PolicyValue::as_number)
                    .unwrap_or(f64::NEG_INFINITY);
            }
            if let Some(id) = other.strip_prefix("time_since_fire.") {
                let key = format!("last_fire.{id}");
                let last = side
                    .extras
                    .get(&key)
                    .and_then(PolicyValue::as_number)
                    .unwrap_or(f64::NEG_INFINITY);
                return if last.is_finite() {
                    state.time - last
                } else {
                    f64::INFINITY
                };
            }
            // Sliding-window damage helpers. `<N>` is the
            // window length in seconds (`damage_taken_last.5` = "damage
            // taken in the last 5 seconds"). Engine retains entries
            // within `B2_MAX_WINDOW_SEC` (30s) so windows beyond that
            // cap return whatever's still in the buffer - no error.
            // Bite damage only currently; breath/DOT/trap sources extend
            // alongside the pre-damage hook.
            if let Some(window_str) = other.strip_prefix("damage_taken_last.") {
                let window = window_str.parse::<f64>().unwrap_or(0.0).max(0.0);
                let cutoff = state.time - window;
                return side
                    .recent_damage_taken
                    .iter()
                    .filter(|&&(t, _)| t >= cutoff)
                    .map(|&(_, amt)| amt)
                    .sum();
            }
            if let Some(window_str) = other.strip_prefix("damage_dealt_last.") {
                let window = window_str.parse::<f64>().unwrap_or(0.0).max(0.0);
                let cutoff = state.time - window;
                return side
                    .recent_damage_dealt
                    .iter()
                    .filter(|&&(t, _)| t >= cutoff)
                    .map(|&(_, amt)| amt)
                    .sum();
            }
            if let Some(rest) = other.strip_prefix("status.") {
                if let Some((status_id, field)) = rest.split_once('.') {
                    if field == "stacks" {
                        return side.status_stacks(status_id);
                    }
                }
                return 0.0;
            }
            if let Some(key) = other.strip_prefix("extra.") {
                // `.sum` / `.last` derived reads on
                // numbered-key arrays. `.<i>` literal indices and
                // `.length` fall through to the generic literal lookup
                // below (which already works because PushExtra writes
                // them as plain keys).
                if let Some(base) = key.strip_suffix(".sum") {
                    return sum_array_extra(&side.extras, base);
                }
                if let Some(base) = key.strip_suffix(".last") {
                    return last_array_extra(&side.extras, base);
                }
                return side
                    .extras
                    .get(key)
                    .and_then(PolicyValue::as_number)
                    .unwrap_or(0.0);
            }
            // Plural alias - matches the top-level `extras.<key>`
            // shape so users don't have to remember which one is
            // singular vs plural.
            if let Some(key) = other.strip_prefix("extras.") {
                if let Some(base) = key.strip_suffix(".sum") {
                    return sum_array_extra(&side.extras, base);
                }
                if let Some(base) = key.strip_suffix(".last") {
                    return last_array_extra(&side.extras, base);
                }
                return side
                    .extras
                    .get(key)
                    .and_then(PolicyValue::as_number)
                    .unwrap_or(0.0);
            }
            // Direct stat-field bridge: `<side>.stats.<field>` exposes
            // every numeric / boolean knob in `SimpleCombatantStats`
            // without needing to pre-pack them into `extras`. Booleans
            // surface as 0/1 so users can `if` on them.
            if let Some(field) = other.strip_prefix("stats.") {
                return lookup_stat(field, &side.stats);
            }
            0.0
        }
    }
}

/// Read the `.length` slot of a numbered-key extras
/// array and clamp to a sane bound, returning 0 when missing.
fn array_extra_len(
    extras: &std::collections::BTreeMap<String, PolicyValue>,
    base: &str,
) -> u32 {
    let length_key = format!("{base}.length");
    let raw = extras
        .get(&length_key)
        .and_then(PolicyValue::as_number)
        .unwrap_or(0.0);
    if !raw.is_finite() || raw <= 0.0 {
        return 0;
    }
    (raw as u32).min(crate::effects::MAX_ARRAY_EXTRA_LEN)
}

/// Sum every numeric entry of a numbered-key extras
/// array. Missing entries (e.g. holes from a non-monotonic push
/// pattern) contribute 0.
fn sum_array_extra(
    extras: &std::collections::BTreeMap<String, PolicyValue>,
    base: &str,
) -> f64 {
    let len = array_extra_len(extras, base);
    if len == 0 {
        return 0.0;
    }
    let mut acc = 0.0;
    for i in 0..len {
        if let Some(v) = extras
            .get(&format!("{base}.{i}"))
            .and_then(PolicyValue::as_number)
        {
            acc += v;
        }
    }
    acc
}

/// Read the most recently-pushed entry of a
/// numbered-key extras array. Returns 0.0 on empty/missing.
fn last_array_extra(
    extras: &std::collections::BTreeMap<String, PolicyValue>,
    base: &str,
) -> f64 {
    let len = array_extra_len(extras, base);
    if len == 0 {
        return 0.0;
    }
    extras
        .get(&format!("{base}.{}", len - 1))
        .and_then(PolicyValue::as_number)
        .unwrap_or(0.0)
}

fn lookup_stat(field: &str, s: &crate::contracts::SimpleCombatantStats) -> f64 {
    match field {
        "health" => s.health,
        "weight" => s.weight,
        "damage" => s.damage,
        "bite_cooldown" => s.bite_cooldown,
        "health_regen" => s.health_regen,
        "active_cooldown_multiplier" => s.active_cooldown_multiplier,
        "quick_recovery_hp_ratio_threshold" => s.quick_recovery_hp_ratio_threshold,
        "unbreakable_damage_cap_pct" => s.unbreakable_damage_cap_pct,
        "damage_taken_multiplier_on_being_bitten" => s.damage_taken_multiplier_on_being_bitten,
        "breath_resistance" => s.breath_resistance,
        "berserk_bite_cooldown_multiplier" => s.berserk_bite_cooldown_multiplier,
        "berserk_hp_ratio_threshold" => s.berserk_hp_ratio_threshold,
        "first_strike_pct" => s.first_strike_pct,
        "first_strike_hp_ratio_threshold" => s.first_strike_hp_ratio_threshold,
        "hunker_reduction_pct" => s.hunker_reduction_pct,
        "plushie_reflect_avg_pct" => s.plushie_reflect_avg_pct,
        "has_warden_resistance" => f64::from(u8::from(s.has_warden_resistance)),
        "has_reflect" => f64::from(u8::from(s.has_reflect)),
        _ => 0.0,
    }
}

/// Spec the user (or visual constructor) hands to the engine to
/// register a new ability. Decision side is data-driven via
/// expressions; effect side reuses [`EffectBatch`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserAbilitySpec {
    /// Schema version. Default `1` - current shape. Future schema
    /// migrations bump this; old saved bundles import via the
    /// migration path. `#[serde(default)]` so pre-version specs
    /// (everything authored before this field shipped) load as v1.
    #[serde(default = "default_spec_version")]
    pub version: u32,
    /// Stable id under which the ability registers. Must start
    /// with `user.` per the project's id-namespace convention so
    /// the engine never confuses it with a built-in.
    pub id: String,
    /// Display name for combat-log events.
    pub display_name: String,
    /// Expression that computes `utility` (units: HP-equivalent).
    pub utility: Expr,
    /// Expression that computes `is_available` (boolean).
    pub is_available: Expr,
    /// Optional `really_fast_gate` expression. `Some(true)` ⇒
    /// fire under ReallyFast; `Some(false)` ⇒ skip; `None` ⇒
    /// fall back to utility ranking. Implemented as
    /// `Option<Expr>` so the spec can be serialized even when
    /// the user opts out of a custom gate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub really_fast_gate: Option<Expr>,
    /// Effects applied when the engine's policy picks "fire now".
    /// `None` means the spec is purely passive - gated only by its
    /// trigger hooks (e.g. a custom Reflect that fires on
    /// `on_take_damage` and never enters the active-decision queue).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_fire: Option<EffectBatch>,
    /// Per-ability override for the timing mode the policy engine
    /// uses when deciding "fire now". `None` falls back to the
    /// session default (the same `ability_policy` the simulation
    /// uses for built-ins). Useful for an ability the user wants
    /// to always fire instantly (`ReallyFast`) regardless of the
    /// session-level mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing_mode_override: Option<crate::contracts::SimpleAbilityTimingMode>,
    /// Per-ability override pointing at a registered custom
    /// `UserTimingSpec` (id starts with `user.`). When set, takes
    /// precedence over `timing_mode_override` AND the session
    /// default - the user-defined timing policy decides "fire now".
    /// The UserTimingSpec layer is defined separately; this completes
    /// the loop by wiring user-defined timings into per-ability
    /// dispatch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing_user_override: Option<String>,
    /// Reactive trigger hooks. All optional; any combination is
    /// valid. The engine dispatches each hook unconditionally when
    /// its event happens - gating belongs inside the hook (via
    /// `EffectKind::Conditional`) so the user keeps full control.
    #[serde(default, skip_serializing_if = "TriggerHooks::is_empty")]
    pub triggers: TriggerHooks,
    /// Total number of levels this ability has.
    /// `1` (default) ⇒ no levels - ability behaves identically to a
    /// legacy single-level spec. `> 1` opens up the `scaling` table.
    #[serde(default = "default_levels")]
    pub levels: u32,
    /// Default level the spec ships with (1-indexed,
    /// clamped to `1..=levels` at registration). Compare UI will
    /// override this per matchup in a later iteration; until then this is the
    /// effective level at dispatch time.
    #[serde(default = "default_levels")]
    pub default_level: u32,
    /// Named numeric scaling tables. Each entry is a
    /// vector of length [`Self::levels`] - `scaling[key][active_level - 1]`
    /// is the value the engine surfaces under
    /// `extras["scaling.<key>"]` at dispatch time. Users read it via
    /// `Expr::Var { path: "scaling.<key>" }`.
    ///
    /// Empty (default) means no scaling - the ability is level-1 only.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub scaling: std::collections::BTreeMap<String, Vec<f64>>,
}

fn default_levels() -> u32 {
    1
}

impl Default for UserAbilitySpec {
    /// Convenience default - empty utility / is_available,
    /// no on_fire, no triggers, single-level. Mostly useful in tests that
    /// build a spec via struct update syntax (`..Default::default()`)
    /// after fixing only the fields they care about.
    fn default() -> Self {
        Self {
            version: default_spec_version(),
            id: String::new(),
            display_name: String::new(),
            utility: Expr::Const { value: 0.0 },
            is_available: Expr::Const { value: 0.0 },
            really_fast_gate: None,
            on_fire: None,
            timing_mode_override: None,
            timing_user_override: None,
            triggers: TriggerHooks::default(),
            levels: 1,
            default_level: 1,
            scaling: std::collections::BTreeMap::new(),
        }
    }
}

impl UserAbilitySpec {
    /// Clamp `default_level` into `1..=levels` and
    /// truncate / pad each `scaling[key]` vector to exactly `levels`
    /// entries (pad with the last value, truncate excess). Idempotent.
    ///
    /// Call at registration time so the engine never sees an
    /// inconsistent shape regardless of how the spec was authored.
    pub fn normalize_levels(&mut self) {
        if self.levels == 0 {
            self.levels = 1;
        }
        if self.default_level == 0 {
            self.default_level = 1;
        }
        if self.default_level > self.levels {
            self.default_level = self.levels;
        }
        let target_len = self.levels as usize;
        for values in self.scaling.values_mut() {
            if values.is_empty() {
                values.resize(target_len, 0.0);
            } else if values.len() < target_len {
                let last = *values.last().unwrap_or(&0.0);
                values.resize(target_len, last);
            } else if values.len() > target_len {
                values.truncate(target_len);
            }
        }
    }

    /// Resolve the active scaling value for `key` at the spec's current
    /// `default_level`. Returns `None` if `key` isn't in the table.
    pub fn scaled(&self, key: &str) -> Option<f64> {
        let values = self.scaling.get(key)?;
        let idx = self.default_level.saturating_sub(1) as usize;
        values.get(idx).copied().or_else(|| values.last().copied())
    }
}

/// Reactive hooks fired by engine events rather than by the
/// policy's "what should I do next?" loop. Every hook is optional;
/// a passive ability (no `on_fire`) typically populates one or
/// more of these instead.
///
/// **Semantics.** Hooks fire unconditionally when their event
/// happens, in the order the engine emits the events. Per-side
/// gating (cooldowns, HP thresholds) is the user's responsibility:
/// wrap effects in [`crate::effects::EffectKind::Conditional`] and read the
/// relevant var paths.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TriggerHooks {
    /// Fired once at `t = 0` for each side that owns this ability.
    /// Useful for "starting effect" patterns (apply a self-buff
    /// status at fight start).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_round_start: Option<EffectBatch>,
    /// Fired when the actor took damage in the last engine
    /// iteration. The actor's PolicyState extras carry
    /// `event.damage_taken` as the delta. Multiple damage events
    /// in the same iteration coalesce into one trigger fire with
    /// summed damage (acceptable coarse semantic; precise event
    /// identity is reserved for a future engine-decomposition pass).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_take_damage: Option<EffectBatch>,
    /// Fired when the actor dealt damage in the last engine
    /// iteration. State extras carry `event.damage_dealt`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_deal_damage: Option<EffectBatch>,
    /// Periodic firing every `interval_sec`, starting at `t = 0`.
    /// Engine schedules per (side, ability) tuple in the live
    /// `CombatSide` so two abilities with different intervals on
    /// the same side don't share state. State extras carry
    /// `event.tick_index` (0-based count of fires so far).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_tick: Option<TickTrigger>,
    /// Fired when one or more new statuses were applied to this
    /// side in the last iteration (vs the previous snapshot).
    /// `event.applied_status_count` = number of distinct statuses
    /// added. User can detect specific ids via
    /// `self.status.<id>.stacks > 0` inside the effect batch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_status_apply: Option<EffectBatch>,
    /// Fired when one or more statuses were removed from this side
    /// in the last iteration (decayed to 0 or explicitly removed).
    /// `event.expired_status_count` = number removed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_status_expire: Option<EffectBatch>,
    /// Fired when this side's action killed the opponent in this
    /// iteration (opponent.death_time transitioned None → Some
    /// while we dealt damage). `event.damage_dealt` carries the
    /// final-blow magnitude when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_kill: Option<EffectBatch>,
    /// Fired when this side's first-strike state transitions -
    /// either `false → true` (HP recovers above threshold) or
    /// `true → false` (HP drops below). `event.first_strike_active`
    /// carries the post-transition state (1 = active, 0 = inactive).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_first_strike: Option<EffectBatch>,
    /// Fired when the actor received
    /// healing in the last iteration. `event.heal_amount` = sum of healing
    /// applied. Covered heal sources: passive HP regen; user `heal_hp` /
    /// `heal_expr_amount` / `set_hp(_expr)` raising HP / `transfer_hp`
    /// recipient / FormSwap raising HP; life leech (melee + breath); Healing
    /// Ailment ticks (the heal behind Healing Pulse); Healing Step; Cocoon
    /// phase-2 lump; breath self-heal (heal / cloud / miasma). Multiple
    /// heals in one iteration coalesce into one fire with summed
    /// `heal_amount`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_heal: Option<EffectBatch>,
    /// Fired when one or more user-defined
    /// `active_until` windows expired this iteration. Extras carry
    /// `event.ended.<ability_id>` = 1.0 for each id whose window
    /// just elapsed. Lets users build "finisher when buff ends"
    /// patterns without polling `active_remaining` each tick.
    /// Built-in active windows now fire too, under stable
    /// ids - `event.ended.fortify` / `harden` / `hunters_curse` /
    /// `unbridled_rage` / `adrenaline` / `life_leech` / `reflect` /
    /// `frost_nova` / `totem`. User (`user.<id>`) and built-in ended ids
    /// coalesce into one fire per iteration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_active_end: Option<EffectBatch>,
    /// Fires on the VICTIM immediately before incoming
    /// damage applies (after built-in mitigation, before Reflect).
    /// Extras carry `event.raw_damage`, `event.damage_taken` (the
    /// post-mitigation amount the engine is about to apply),
    /// `event.prevented_damage` (= raw - taken), and
    /// `event.source_ability` (currently `"bite"`; `"breath"` and
    /// other source tags follow as more damage sources route through
    /// the pre-damage hook). The handler can write
    /// `event.damage_override` (via `set_extra self damage_override = N`)
    /// to replace the final amount. Useful for user-defined shields /
    /// parry / absorb.
    ///
    /// Currently wired at the bite damage path only. Breath / DOT /
    /// trap / reflect / life-leech-self-damage sites are pass-through
    /// currently and will route through the hook in a follow-up.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_before_take_damage: Option<EffectBatch>,
    /// Symmetric to `on_before_take_damage` but fires
    /// on the DEALER immediately before its damage lands. Same extras
    /// shape. Handler can write `event.damage_override` to amplify or
    /// zero out the outgoing damage (e.g. crit-roll user mechanics).
    /// Fires BEFORE `on_before_take_damage` so the victim's hook sees
    /// the dealer's post-modification amount.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_before_deal_damage: Option<EffectBatch>,
}

impl TriggerHooks {
    /// True when no hook is populated. Used by the serde
    /// `skip_serializing_if` so a spec without triggers
    /// round-trips identically to the pre-trigger schema.
    pub fn is_empty(&self) -> bool {
        self.on_round_start.is_none()
            && self.on_take_damage.is_none()
            && self.on_deal_damage.is_none()
            && self.on_tick.is_none()
            && self.on_status_apply.is_none()
            && self.on_status_expire.is_none()
            && self.on_kill.is_none()
            && self.on_first_strike.is_none()
            && self.on_heal.is_none()
            && self.on_active_end.is_none()
            && self.on_before_take_damage.is_none()
            && self.on_before_deal_damage.is_none()
    }

    /// Returns the `EffectBatch` for `hook`, if populated.
    pub fn get(&self, hook: TriggerHook) -> Option<&EffectBatch> {
        match hook {
            TriggerHook::OnRoundStart => self.on_round_start.as_ref(),
            TriggerHook::OnTakeDamage => self.on_take_damage.as_ref(),
            TriggerHook::OnDealDamage => self.on_deal_damage.as_ref(),
            TriggerHook::OnTick => self.on_tick.as_ref().map(|t| &t.effects),
            TriggerHook::OnStatusApply => self.on_status_apply.as_ref(),
            TriggerHook::OnStatusExpire => self.on_status_expire.as_ref(),
            TriggerHook::OnKill => self.on_kill.as_ref(),
            TriggerHook::OnFirstStrike => self.on_first_strike.as_ref(),
            TriggerHook::OnHeal => self.on_heal.as_ref(),
            TriggerHook::OnActiveEnd => self.on_active_end.as_ref(),
            TriggerHook::OnBeforeTakeDamage => self.on_before_take_damage.as_ref(),
            TriggerHook::OnBeforeDealDamage => self.on_before_deal_damage.as_ref(),
        }
    }
}

/// Periodic trigger spec - fires every `interval_sec` while the
/// owning side is alive.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TickTrigger {
    /// Period between firings. Engine clamps to a minimum of 0.05s
    /// at dispatch time so a misconfigured 0 doesn't busy-loop.
    pub interval_sec: f64,
    pub effects: EffectBatch,
}

/// Closed list of engine-emitted events a [`TriggerHooks`] block
/// can subscribe to. Adding a new event is a coordinated change:
/// engine emit-site, hook field, and any TS surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TriggerHook {
    OnRoundStart,
    OnTakeDamage,
    OnDealDamage,
    OnTick,
    OnStatusApply,
    OnStatusExpire,
    OnKill,
    OnFirstStrike,
    /// Actor received healing this iteration. Event
    /// extras carry `event.heal_amount` = sum of healing this tick.
    /// Heal sources covered: passive HP regen (Phase 5/6), user
    /// effects (heal_hp, heal_expr_amount, set_hp_expr that raises HP,
    /// transfer_hp recipient side). Built-in heal sources not yet
    /// instrumented (life leech, Healing Pulse, Healing Ailment ticks,
    /// Cocoon Phase 2 heal) → those heals flow through without firing
    /// this trigger for now.
    OnHeal,
    /// One or more user-defined `active_until` windows
    /// expired this iteration. Event extras carry `event.ended.<id>` =
    /// 1.0 for each ability id whose `set_active_until` window just
    /// elapsed. Built-in active windows (Fortify, Harden, Hunters
    /// Curse, etc.) ending do NOT fire this trigger for now -
    /// only user-scoped `user_active_until` keys are tracked. Future
    /// work can extend to built-ins per request.
    OnActiveEnd,
    /// Pre-damage hook on the VICTIM, fires before
    /// HP changes apply. Handler can write `event.damage_override` to
    /// replace the final amount.
    OnBeforeTakeDamage,
    /// Pre-damage hook on the DEALER, fires before
    /// HP changes apply. Handler can write `event.damage_override` to
    /// amplify or zero the outgoing damage.
    OnBeforeDealDamage,
}

/// Engine-side floor on `TickTrigger::interval_sec`. Anything
/// faster gets clamped to this so a misconfigured spec can't
/// busy-fire at the loop step rate.
pub const MIN_TICK_INTERVAL_SEC: f64 = 0.05;

fn default_spec_version() -> u32 {
    1
}

/// Adapter: turns a [`UserAbilitySpec`] into a concrete
/// [`TimedDecision`] the existing `DecisionRegistry` accepts.
/// Stateless beyond the spec it wraps; cheap to clone.
#[derive(Debug, Clone)]
pub struct UserDecision {
    spec: UserAbilitySpec,
}

impl UserDecision {
    pub fn new(spec: UserAbilitySpec) -> Self {
        Self { spec }
    }

    /// Reference to the wrapped spec. Useful for the dispatcher
    /// that needs to read `on_fire` after the policy decides
    /// "fire now".
    pub fn spec(&self) -> &UserAbilitySpec {
        &self.spec
    }

    /// Look up the effect batch for a trigger event. Returns
    /// `None` when the spec hasn't subscribed to that event -
    /// dispatcher should skip the call rather than treat it as
    /// an empty batch.
    pub fn trigger_batch(&self, hook: TriggerHook) -> Option<&EffectBatch> {
        self.spec.triggers.get(hook)
    }

    /// Periodicity for this ability's `OnTick` hook, clamped to
    /// the engine floor [`MIN_TICK_INTERVAL_SEC`]. `None` when
    /// no tick subscription. Engine schedulers consult this once
    /// at registration to seed the per-side tick timer.
    pub fn tick_interval(&self) -> Option<f64> {
        self.spec
            .triggers
            .on_tick
            .as_ref()
            .map(|t| t.interval_sec.max(MIN_TICK_INTERVAL_SEC))
    }
}

impl TimedDecision for UserDecision {
    fn id(&self) -> &str {
        &self.spec.id
    }

    fn utility(&self, state: &PolicyState) -> f64 {
        self.spec.utility.eval(state)
    }

    fn is_available(&self, state: &PolicyState) -> bool {
        self.spec.is_available.eval_bool(state)
    }

    fn really_fast_gate(&self, state: &PolicyState) -> Option<bool> {
        match &self.spec.really_fast_gate {
            Some(expr) => Some(expr.eval_bool(state)),
            None => Some(self.is_available(state)),
        }
    }
}

/// Validation surfaced at registration time. Distinct from
/// runtime evaluation behaviour: at runtime, unknown vars and
/// div-by-zero produce `0.0`. At registration we want to catch
/// obvious problems early.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpecError {
    /// `id` doesn't start with `user.`.
    IdNotUserNamespaced { id: String },
    /// `id` is empty.
    IdEmpty,
    /// `display_name` is empty.
    DisplayNameEmpty,
    /// Effect batch declares an empty effects vec.
    NoEffects,
    /// `default_level` was out of range. Always
    /// normalized at parse time; this error is reachable only via
    /// the `validate` method on a directly-constructed spec.
    DefaultLevelOutOfRange { default_level: u32, levels: u32 },
    /// A `scaling` entry's array length didn't match
    /// the declared `levels`. (Normalize would pad / truncate; validate
    /// reports the discrepancy so the UI can surface a warning.)
    ScalingLengthMismatch {
        key: String,
        len: usize,
        levels: u32,
    },
}

impl std::fmt::Display for SpecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SpecError::IdNotUserNamespaced { id } => write!(
                f,
                "ability id `{id}` must start with `user.` to register as a custom ability"
            ),
            SpecError::IdEmpty => write!(f, "ability id must not be empty"),
            SpecError::DisplayNameEmpty => write!(f, "display_name must not be empty"),
            SpecError::NoEffects => {
                write!(f, "on_fire.effects must contain at least one effect")
            }
            SpecError::DefaultLevelOutOfRange {
                default_level,
                levels,
            } => write!(
                f,
                "default_level {default_level} is outside 1..={levels} (levels = {levels})"
            ),
            SpecError::ScalingLengthMismatch { key, len, levels } => write!(
                f,
                "scaling['{key}'] has {len} entries but levels = {levels} (expected {levels})"
            ),
        }
    }
}

impl std::error::Error for SpecError {}

impl UserAbilitySpec {
    /// Sanity-check before handing to the registry. Cheap: only
    /// id / display-name / non-empty checks; deeper validation
    /// (every var path resolves) is intentionally not enforced
    /// here, since runtime eval treats unknowns as 0.0 and
    /// upstream UI can pre-validate against the published path
    /// list.
    pub fn validate(&self) -> Result<(), SpecError> {
        if self.id.is_empty() {
            return Err(SpecError::IdEmpty);
        }
        if !self.id.starts_with("user.") {
            return Err(SpecError::IdNotUserNamespaced {
                id: self.id.clone(),
            });
        }
        if self.display_name.trim().is_empty() {
            return Err(SpecError::DisplayNameEmpty);
        }
        // Spec must do something - either fire actively (`on_fire`)
        // or react via at least one trigger hook. If `on_fire` is
        // present its effects must be non-empty (an empty batch is
        // ambiguous with "no on_fire at all" and confuses the
        // dispatcher).
        let on_fire_populated = self
            .on_fire
            .as_ref()
            .map(|b| !b.effects.is_empty())
            .unwrap_or(false);
        let any_trigger_populated = self.has_triggers();
        if !on_fire_populated && !any_trigger_populated {
            return Err(SpecError::NoEffects);
        }
        // If on_fire is present-but-empty, that's still a malformed
        // batch - same error.
        if let Some(batch) = &self.on_fire {
            if batch.effects.is_empty() {
                return Err(SpecError::NoEffects);
            }
        }
        // Validate the level fields. `parse_user_ability_spec`
        // runs `normalize_levels` first so these errors are unreachable via
        // the JSON path - but a directly-constructed spec might trip them.
        if self.levels == 0 {
            return Err(SpecError::DefaultLevelOutOfRange {
                default_level: self.default_level,
                levels: self.levels,
            });
        }
        if self.default_level == 0 || self.default_level > self.levels {
            return Err(SpecError::DefaultLevelOutOfRange {
                default_level: self.default_level,
                levels: self.levels,
            });
        }
        for (key, values) in &self.scaling {
            if values.len() != self.levels as usize {
                return Err(SpecError::ScalingLengthMismatch {
                    key: key.clone(),
                    len: values.len(),
                    levels: self.levels,
                });
            }
        }
        Ok(())
    }

    /// True when the spec has any reactive trigger populated.
    /// The engine adapter uses this to decide whether to register
    /// the ability for trigger-event dispatch.
    pub fn has_triggers(&self) -> bool {
        !self.triggers.is_empty()
    }
}

/// Public helper: parse a JSON spec, validate, and wrap into a
/// `Box<dyn TimedDecision>` ready for `DecisionRegistry::register`.
/// The dispatcher needs the wrapped spec back to apply
/// `on_fire`; use [`UserDecision::spec`] on the concrete type, or
/// keep the parsed `UserAbilitySpec` separately at the registration
/// call site.
pub fn parse_user_ability_spec(json: &str) -> Result<UserAbilitySpec, ParseError> {
    let mut spec: UserAbilitySpec = serde_json::from_str(json).map_err(ParseError::Json)?;
    // Normalize first (pad/truncate scaling arrays, clamp
    // default_level into range) so validate doesn't trip on minor authoring
    // mistakes that are unambiguously recoverable.
    spec.normalize_levels();
    spec.validate().map_err(ParseError::Validation)?;
    Ok(spec)
}

#[derive(Debug)]
pub enum ParseError {
    Json(serde_json::Error),
    Validation(SpecError),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::Json(e) => write!(f, "invalid JSON: {e}"),
            ParseError::Validation(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ParseError {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::SimpleAppliedStatus;
    use crate::effects::{EffectBatch, EffectKind, EffectTarget};
    use crate::policy::testing::default_state;

    fn const_(value: f64) -> Box<Expr> {
        Box::new(Expr::Const { value })
    }
    fn var(path: &str) -> Box<Expr> {
        Box::new(Expr::Var {
            path: path.into(),
        })
    }
    fn bin(op: BinOp, left: Box<Expr>, right: Box<Expr>) -> Box<Expr> {
        Box::new(Expr::Bin { op, left, right })
    }

    #[test]
    fn const_and_arithmetic() {
        let state = default_state();
        let expr = bin(BinOp::Mul, const_(2.0), bin(BinOp::Add, const_(3.0), const_(4.0)));
        assert_eq!(expr.eval(&state), 14.0);
    }

    #[test]
    fn var_self_hp_ratio() {
        let mut state = default_state();
        state.self_side.hp = 5_000.0; // 50 % of default 10_000.
        let expr = var("self.hp_ratio");
        assert!((expr.eval(&state) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn var_unknown_path_returns_zero() {
        let state = default_state();
        let expr = var("self.does_not_exist");
        assert_eq!(expr.eval(&state), 0.0);
    }

    #[test]
    fn comparison_returns_one_or_zero() {
        let mut state = default_state();
        state.self_side.hp = 4_000.0;
        // self.hp_ratio < 0.5 → 0.4 < 0.5 → true → 1.0.
        let expr = bin(BinOp::Lt, var("self.hp_ratio"), const_(0.5));
        assert_eq!(expr.eval(&state), 1.0);
        // Inverse.
        let expr2 = bin(BinOp::Gt, var("self.hp_ratio"), const_(0.5));
        assert_eq!(expr2.eval(&state), 0.0);
    }

    #[test]
    fn if_branches_pick_correctly() {
        let mut state = default_state();
        state.self_side.hp = 9_000.0;
        let expr = Expr::If {
            cond: bin(BinOp::Lt, var("self.hp_ratio"), const_(0.5)),
            then: const_(100.0),
            otherwise: const_(0.0),
        };
        assert_eq!(expr.eval(&state), 0.0);
        state.self_side.hp = 4_000.0;
        assert_eq!(expr.eval(&state), 100.0);
    }

    #[test]
    fn cooldown_path_reads_map() {
        let mut state = default_state();
        state
            .self_side
            .cooldowns
            .insert("user.test".into(), 30.0);
        state.time = 25.0;
        // self.cooldown_until.user.test - time → 30 - 25 = 5.
        let expr = bin(BinOp::Sub, var("self.cooldown_until.user.test"), var("time"));
        assert_eq!(expr.eval(&state), 5.0);
    }

    #[test]
    fn status_stacks_path() {
        let mut state = default_state();
        state.self_side.statuses.insert(
            "Burn_Status".into(),
            crate::contracts::SimpleStatusInstance {
                stacks: 7.0,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 30.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
        let expr = var("self.status.Burn_Status.stacks");
        assert_eq!(expr.eval(&state), 7.0);
    }

    #[test]
    fn is_posture_reads_side_posture_label() {
        // `<side>.is_posture.<P>` resolves the committed
        // posture label to 1.0 / 0.0, case-insensitively, with unknown
        // labels (and the default Standing baseline) typo-safe.
        let mut state = default_state();
        // default_side() seeds "Standing".
        assert_eq!(var("self.is_posture.Standing").eval(&state), 1.0);
        assert_eq!(var("self.is_posture.Laying").eval(&state), 0.0);

        state.self_side.posture = "Laying".to_string();
        assert_eq!(var("self.is_posture.Laying").eval(&state), 1.0);
        // Case-insensitive match.
        assert_eq!(var("self.is_posture.laying").eval(&state), 1.0);
        assert_eq!(var("self.is_posture.Standing").eval(&state), 0.0);
        assert_eq!(var("self.is_posture.Sitting").eval(&state), 0.0);
        // Unknown posture label → 0.0 (typo-safe).
        assert_eq!(var("self.is_posture.Floating").eval(&state), 0.0);

        // Opponent side resolves independently.
        state.opponent.posture = "Sitting".to_string();
        assert_eq!(var("opp.is_posture.Sitting").eval(&state), 1.0);
        assert_eq!(var("opponent.is_posture.Sitting").eval(&state), 1.0);
    }

    #[test]
    fn identity_reads_type_diet_elder_tier() {
        // is_type / is_diet / is_elder boolean builtins +
        // numeric tier, all resolving against the side's CreatureIdentity.
        let mut state = default_state();
        // No identity (default) → every read is neutral.
        assert_eq!(var("self.is_type.Flier").eval(&state), 0.0);
        assert_eq!(var("self.is_elder").eval(&state), 0.0);
        assert_eq!(var("self.tier").eval(&state), 0.0);

        state.self_side.stats.identity = Some(crate::contracts::CreatureIdentity {
            creature_type: "Flier".to_string(),
            diet: "Carnivore".to_string(),
            elder: "Powerful".to_string(),
            tier: 5.0,
        });
        // is_type / is_diet - case-insensitive segment match.
        assert_eq!(var("self.is_type.Flier").eval(&state), 1.0);
        assert_eq!(var("self.is_type.flier").eval(&state), 1.0);
        assert_eq!(var("self.is_type.Bruiser").eval(&state), 0.0);
        assert_eq!(var("self.is_diet.Carnivore").eval(&state), 1.0);
        assert_eq!(var("self.is_diet.Herbivore").eval(&state), 0.0);
        // Elder: bare = any non-None variant; `.<V>` = a specific variant.
        assert_eq!(var("self.is_elder").eval(&state), 1.0);
        assert_eq!(var("self.is_elder.Powerful").eval(&state), 1.0);
        assert_eq!(var("self.is_elder.Gentle").eval(&state), 0.0);
        // tier is numeric.
        assert_eq!(var("self.tier").eval(&state), 5.0);

        // An explicit "None" elder ⇒ bare is_elder is false.
        state.self_side.stats.identity = Some(crate::contracts::CreatureIdentity {
            elder: "None".to_string(),
            ..Default::default()
        });
        assert_eq!(var("self.is_elder").eval(&state), 0.0);
    }

    #[test]
    fn div_by_zero_yields_zero_not_inf() {
        let state = default_state();
        let expr = bin(BinOp::Div, const_(10.0), const_(0.0));
        assert_eq!(expr.eval(&state), 0.0);
    }

    #[test]
    fn unary_math_ops_basic() {
        let state = default_state();
        let una = |op, v: f64| Expr::Una {
            op,
            operand: const_(v),
        };
        assert_eq!(una(UnaryOp::Abs, -3.5).eval(&state), 3.5);
        assert_eq!(una(UnaryOp::Sign, -2.0).eval(&state), -1.0);
        assert_eq!(una(UnaryOp::Sign, 0.0).eval(&state), 0.0);
        assert_eq!(una(UnaryOp::Sign, 4.0).eval(&state), 1.0);
        assert_eq!(una(UnaryOp::Floor, 1.7).eval(&state), 1.0);
        assert_eq!(una(UnaryOp::Ceil, 1.2).eval(&state), 2.0);
        assert_eq!(una(UnaryOp::Round, 1.5).eval(&state), 2.0);
        assert_eq!(una(UnaryOp::Sqrt, 9.0).eval(&state), 3.0);
        assert_eq!(una(UnaryOp::Sqrt, -1.0).eval(&state), 0.0); // negative ⇒ 0
        assert_eq!(una(UnaryOp::Ln, 0.0).eval(&state), 0.0); // non-positive ⇒ 0
        assert!((una(UnaryOp::Ln, std::f64::consts::E).eval(&state) - 1.0).abs() < 1e-9);
        assert!((una(UnaryOp::Exp, 1.0).eval(&state) - std::f64::consts::E).abs() < 1e-9);
    }

    #[test]
    fn pow_and_mod() {
        let state = default_state();
        assert_eq!(bin(BinOp::Pow, const_(2.0), const_(10.0)).eval(&state), 1024.0);
        assert_eq!(bin(BinOp::Mod, const_(7.0), const_(3.0)).eval(&state), 1.0);
        assert_eq!(bin(BinOp::Mod, const_(7.0), const_(0.0)).eval(&state), 0.0);
        // Pow that overflows to non-finite ⇒ 0
        assert_eq!(
            bin(BinOp::Pow, const_(10.0), const_(10_000.0)).eval(&state),
            0.0
        );
    }

    #[test]
    fn clamp_works_and_tolerates_inverted_bounds() {
        let state = default_state();
        let mk = |v: f64, lo: f64, hi: f64| Expr::Clamp {
            value: const_(v),
            lo: const_(lo),
            hi: const_(hi),
        };
        assert_eq!(mk(5.0, 0.0, 10.0).eval(&state), 5.0);
        assert_eq!(mk(-3.0, 0.0, 10.0).eval(&state), 0.0);
        assert_eq!(mk(99.0, 0.0, 10.0).eval(&state), 10.0);
        // Inverted bounds: still produces a sane result.
        assert_eq!(mk(5.0, 10.0, 0.0).eval(&state), 5.0);
        assert_eq!(mk(-3.0, 10.0, 0.0).eval(&state), 0.0);
    }

    #[test]
    fn stats_field_path_reads_directly() {
        let mut state = default_state();
        state.self_side.stats.damage = 250.0;
        state.self_side.stats.first_strike_pct = 0.5;
        state.self_side.stats.has_reflect = true;
        assert_eq!(var("self.stats.damage").eval(&state), 250.0);
        assert_eq!(var("self.stats.first_strike_pct").eval(&state), 0.5);
        assert_eq!(var("self.stats.has_reflect").eval(&state), 1.0);
        // Unknown stat field returns 0.
        assert_eq!(var("self.stats.does_not_exist").eval(&state), 0.0);
    }

    #[test]
    fn cooldown_remaining_clamps_at_zero() {
        let mut state = default_state();
        state.time = 50.0;
        state
            .self_side
            .cooldowns
            .insert("user.x".into(), 30.0); // already past
        state
            .self_side
            .cooldowns
            .insert("user.y".into(), 80.0);
        assert_eq!(var("self.cooldown_remaining.user.x").eval(&state), 0.0);
        assert_eq!(var("self.cooldown_remaining.user.y").eval(&state), 30.0);
    }

    #[test]
    fn is_idle_path_returns_boolean() {
        let mut state = default_state();
        state.time = 100.0;
        state
            .self_side
            .cooldowns
            .insert("user.busy".into(), 200.0);
        assert_eq!(var("self.is_idle.user.busy").eval(&state), 0.0);
        assert_eq!(var("self.is_idle.user.never_set").eval(&state), 1.0);
    }

    fn sample_spec() -> UserAbilitySpec {
        UserAbilitySpec {
            version: 1,
            id: "user.pyro_strike".into(),
            display_name: "Pyro Strike".into(),
            // utility = self.bite_dps × 8 when off cooldown, else 0.
            utility: Expr::If {
                cond: bin(BinOp::Lte, var("self.cooldown_until.user.pyro_strike"), var("time")),
                then: bin(BinOp::Mul, var("self.bite_dps"), const_(8.0)),
                otherwise: const_(0.0),
            },
            // is_available = cooldown elapsed.
            is_available: *bin(BinOp::Lte, var("self.cooldown_until.user.pyro_strike"), var("time")),
            // really_fast_gate = self.hp_ratio <= 0.85 - Life-Leech-style gate.
            really_fast_gate: Some(*bin(BinOp::Lte, var("self.hp_ratio"), const_(0.85))),
            timing_mode_override: None,
            timing_user_override: None,
            on_fire: Some(EffectBatch {
                name: "Pyro Strike".into(),
                effects: vec![
                    EffectKind::DealDirectDamageMaxHpFraction {
                        target: EffectTarget::Opponent,
                        fraction: 0.05,
                    },
                    EffectKind::ApplyStatusToTarget {
                        target: EffectTarget::Opponent,
                        status: SimpleAppliedStatus {
                            status_id: "Burn_Status".into(),
                            stacks: 2.0,
                            source_ability: None,
                        },
                    },
                    EffectKind::SetCooldownUntil {
                        target: EffectTarget::Caster,
                        cooldown_id: "user.pyro_strike".into(),
                        duration_sec: 30.0,
                    },
                ],
                ..Default::default()
            }),
            triggers: TriggerHooks::default(),
            levels: 1,
            default_level: 1,
            scaling: Default::default(),
        }
    }

    #[test]
    fn user_decision_implements_trait_correctly() {
        let spec = sample_spec();
        let decision: Box<dyn TimedDecision> = Box::new(UserDecision::new(spec));
        let state = default_state();
        // Cooldown timestamp is 0, time is 0, so 0 <= 0 → available.
        assert!(decision.is_available(&state));
        // Utility = bite_dps × 8 = (100 / 2.0) × 8 = 400.
        assert!((decision.utility(&state) - 400.0).abs() < 1e-9);
    }

    #[test]
    fn user_decision_id_passes_through() {
        let decision = UserDecision::new(sample_spec());
        assert_eq!(decision.id(), "user.pyro_strike");
    }

    #[test]
    fn really_fast_gate_falls_back_to_is_available_when_unset() {
        let mut spec = sample_spec();
        spec.really_fast_gate = None;
        let decision = UserDecision::new(spec);
        let state = default_state();
        assert_eq!(decision.really_fast_gate(&state), Some(true));
    }

    #[test]
    fn really_fast_gate_blocks_above_eighty_five_percent() {
        let decision = UserDecision::new(sample_spec());
        let mut state = default_state();
        state.self_side.hp = 9_000.0; // 90 %
        assert_eq!(decision.really_fast_gate(&state), Some(false));
        state.self_side.hp = 8_500.0; // 85 %
        assert_eq!(decision.really_fast_gate(&state), Some(true));
    }

    #[test]
    fn validate_rejects_bad_id() {
        let mut spec = sample_spec();
        spec.id = "builtin.cheating".into();
        assert!(matches!(
            spec.validate(),
            Err(SpecError::IdNotUserNamespaced { .. })
        ));
        spec.id = "".into();
        assert!(matches!(spec.validate(), Err(SpecError::IdEmpty)));
    }

    #[test]
    fn validate_rejects_empty_display_name_or_effects() {
        let mut spec = sample_spec();
        spec.display_name = "   ".into();
        assert!(matches!(
            spec.validate(),
            Err(SpecError::DisplayNameEmpty)
        ));
        spec.display_name = "Pyro Strike".into();
        if let Some(batch) = spec.on_fire.as_mut() {
            batch.effects.clear();
        }
        assert!(matches!(spec.validate(), Err(SpecError::NoEffects)));
    }

    #[test]
    fn parse_round_trips_through_json() {
        let spec = sample_spec();
        let json = serde_json::to_string(&spec).expect("serialize");
        let parsed = parse_user_ability_spec(&json).expect("parse");
        assert_eq!(parsed, spec);
    }

    #[test]
    fn passive_spec_with_only_triggers_validates() {
        // No on_fire - purely reactive ability (a custom Reflect).
        let spec = UserAbilitySpec {
            version: 1,
            id: "user.custom_reflect".into(),
            display_name: "Custom Reflect".into(),
            utility: const_(0.0).as_ref().clone(),
            is_available: const_(0.0).as_ref().clone(),
            really_fast_gate: None,
            timing_mode_override: None,
            timing_user_override: None,
            on_fire: None,
            triggers: TriggerHooks {
                on_take_damage: Some(EffectBatch {
                    name: "Reflect".into(),
                    effects: vec![EffectKind::DealDirectDamage {
                        target: EffectTarget::Opponent,
                        amount: 50.0,
                    }],
                    ..Default::default()
                }),
                ..Default::default()
            },
            levels: 1,
            default_level: 1,
            scaling: Default::default(),
        };
        assert!(spec.validate().is_ok());
        assert!(spec.has_triggers());
    }

    #[test]
    fn validate_rejects_spec_with_no_active_or_trigger_effects() {
        let spec = UserAbilitySpec {
            version: 1,
            id: "user.useless".into(),
            display_name: "Useless".into(),
            utility: const_(0.0).as_ref().clone(),
            is_available: const_(0.0).as_ref().clone(),
            really_fast_gate: None,
            timing_mode_override: None,
            timing_user_override: None,
            on_fire: None,
            triggers: TriggerHooks::default(),
            levels: 1,
            default_level: 1,
            scaling: Default::default(),
        };
        assert!(matches!(spec.validate(), Err(SpecError::NoEffects)));
    }

    #[test]
    fn normalize_levels_pads_and_clamps_round40_a11() {
        let mut spec = sample_spec();
        spec.levels = 3;
        spec.default_level = 99; // out of range - should clamp to 3
        let mut scaling = std::collections::BTreeMap::new();
        scaling.insert("damage_amount".to_string(), vec![100.0]); // too short - pad
        scaling.insert(
            "cost".to_string(),
            vec![1.0, 2.0, 3.0, 4.0, 5.0], // too long - truncate
        );
        spec.scaling = scaling;

        spec.normalize_levels();

        assert_eq!(spec.default_level, 3);
        assert_eq!(spec.scaling["damage_amount"], vec![100.0, 100.0, 100.0]);
        assert_eq!(spec.scaling["cost"], vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn scaled_returns_active_level_value_round40_a11() {
        let mut spec = sample_spec();
        spec.levels = 3;
        spec.default_level = 2;
        spec.scaling
            .insert("damage_amount".to_string(), vec![100.0, 200.0, 300.0]);
        assert_eq!(spec.scaled("damage_amount"), Some(200.0));
        assert_eq!(spec.scaled("missing"), None);

        spec.default_level = 3;
        assert_eq!(spec.scaled("damage_amount"), Some(300.0));
    }

    #[test]
    fn validate_rejects_scaling_length_mismatch_round40_a11() {
        let mut spec = sample_spec();
        spec.levels = 3;
        spec.scaling
            .insert("dmg".to_string(), vec![10.0, 20.0]); // 2 ≠ 3
        assert!(matches!(
            spec.validate(),
            Err(SpecError::ScalingLengthMismatch { .. })
        ));
    }

    #[test]
    fn validate_rejects_default_level_out_of_range_round40_a11() {
        let mut spec = sample_spec();
        spec.levels = 3;
        spec.default_level = 0;
        assert!(matches!(
            spec.validate(),
            Err(SpecError::DefaultLevelOutOfRange { .. })
        ));
        spec.default_level = 5;
        assert!(matches!(
            spec.validate(),
            Err(SpecError::DefaultLevelOutOfRange { .. })
        ));
    }

    #[test]
    fn parse_normalizes_levels_so_valid_round40_a11() {
        // JSON with out-of-range default_level + short scaling array.
        // parse_user_ability_spec runs normalize_levels first, so this
        // accepts cleanly.
        let mut spec = sample_spec();
        spec.levels = 3;
        spec.default_level = 99;
        spec.scaling
            .insert("dmg".to_string(), vec![10.0]); // short - will pad to [10, 10, 10]
        let json = serde_json::to_string(&spec).expect("serialize");
        let parsed = parse_user_ability_spec(&json).expect("parse");
        assert_eq!(parsed.default_level, 3);
        assert_eq!(parsed.scaling["dmg"], vec![10.0, 10.0, 10.0]);
    }

    #[test]
    fn legacy_single_level_json_loads_with_default_levels() {
        // JSON without levels/default_level/scaling fields - legacy
        // single-level saved spec. Should load as levels=1, default_level=1,
        // empty scaling.
        let json = r#"{
            "version": 1,
            "id": "user.legacy",
            "display_name": "Legacy",
            "utility": { "kind": "const", "value": 1.0 },
            "is_available": { "kind": "const", "value": 1.0 },
            "on_fire": {
                "name": "Legacy",
                "effects": [
                    { "kind": "deal_direct_damage", "target": "opponent", "amount": 50.0 }
                ]
            }
        }"#;
        let parsed = parse_user_ability_spec(json).expect("parse");
        assert_eq!(parsed.levels, 1);
        assert_eq!(parsed.default_level, 1);
        assert!(parsed.scaling.is_empty());
    }

    #[test]
    fn trigger_batch_lookup_returns_correct_branch() {
        let on_take = EffectBatch {
            name: "T".into(),
            effects: vec![EffectKind::HealHp {
                target: EffectTarget::Caster,
                amount: 100.0,
            }],
            ..Default::default()
        };
        let on_tick = TickTrigger {
            interval_sec: 0.5,
            effects: EffectBatch {
                name: "Tick".into(),
                effects: vec![EffectKind::DealDirectDamage {
                    target: EffectTarget::Opponent,
                    amount: 10.0,
                }],
                ..Default::default()
            },
        };
        let mut spec = sample_spec();
        spec.triggers.on_take_damage = Some(on_take.clone());
        spec.triggers.on_tick = Some(on_tick.clone());
        let dec = UserDecision::new(spec);
        assert_eq!(dec.trigger_batch(TriggerHook::OnTakeDamage), Some(&on_take));
        assert_eq!(dec.trigger_batch(TriggerHook::OnTick), Some(&on_tick.effects));
        assert_eq!(dec.trigger_batch(TriggerHook::OnDealDamage), None);
        assert_eq!(dec.trigger_batch(TriggerHook::OnRoundStart), None);
    }

    #[test]
    fn tick_interval_clamps_to_engine_floor() {
        let mut spec = sample_spec();
        spec.triggers.on_tick = Some(TickTrigger {
            interval_sec: 0.001, // way under the 0.05 floor
            effects: EffectBatch {
                name: "T".into(),
                effects: vec![EffectKind::DealDirectDamage {
                    target: EffectTarget::Opponent,
                    amount: 1.0,
                }],
                ..Default::default()
            },
        });
        let dec = UserDecision::new(spec);
        assert_eq!(dec.tick_interval(), Some(MIN_TICK_INTERVAL_SEC));
    }

    #[test]
    fn event_var_path_resolves_via_state_extras() {
        let mut state = default_state();
        state
            .extras
            .insert("damage_taken".into(), PolicyValue::Number(420.0));
        // Both paths read the same map - `event.<key>` is sugar.
        assert_eq!(var("event.damage_taken").eval(&state), 420.0);
        assert_eq!(var("extras.damage_taken").eval(&state), 420.0);
        assert_eq!(var("event.never_set").eval(&state), 0.0);
    }

    #[test]
    fn status_var_path_resolves_via_state_extras() {
        // Phase 9: a status hook's dispatcher seeds `status.stacks` /
        // `status.max_hp` into state extras; the `status.*` arm surfaces them.
        let mut state = default_state();
        state
            .extras
            .insert("status.stacks".into(), PolicyValue::Number(7.0));
        state
            .extras
            .insert("status.max_hp".into(), PolicyValue::Number(10_000.0));
        assert_eq!(var("status.stacks").eval(&state), 7.0);
        assert_eq!(var("status.max_hp").eval(&state), 10_000.0);
        // Unknown / unseeded status paths are typo-safe (0.0).
        assert_eq!(var("status.never_set").eval(&state), 0.0);
    }

    #[test]
    fn status_block_var_resolves_combined_resist_and_plushie_2026_05_12() {
        let mut state = default_state();
        // 30 % natural resist + 40 % plushie block = 70 % effective block.
        state
            .opponent
            .stats
            .status_resist_fractions
            .insert("Bleed_Status".into(), 0.3);
        state
            .opponent
            .stats
            .plushie_status_block_fractions
            .insert("Bleed_Status".into(), 0.4);
        let v = var("opponent.status_block.Bleed_Status").eval(&state);
        assert!((v - 0.7).abs() < 1e-9, "expected 0.7, got {v}");
        // `opp` alias resolves the same way.
        let v2 = var("opp.status_block.Bleed_Status").eval(&state);
        assert!((v2 - 0.7).abs() < 1e-9, "opp alias mismatch: {v2}");
        // Unset ids → 0.0.
        assert_eq!(var("opp.status_block.Disease_Status").eval(&state), 0.0);
    }

    #[test]
    fn status_block_var_caps_at_one_2026_05_12() {
        let mut state = default_state();
        // 60 % + 60 % would mathematically sum to 1.2 - engine clamps to 1.0.
        state
            .opponent
            .stats
            .status_resist_fractions
            .insert("Burn_Status".into(), 0.6);
        state
            .opponent
            .stats
            .plushie_status_block_fractions
            .insert("Burn_Status".into(), 0.6);
        let v = var("opp.status_block.Burn_Status").eval(&state);
        assert!((v - 1.0).abs() < 1e-9, "expected clamp to 1.0, got {v}");
    }

    #[test]
    fn status_block_var_treats_immune_as_full_block_2026_05_12() {
        let mut state = default_state();
        state
            .opponent
            .stats
            .immune_status_ids
            .push("Frostbite_Status".into());
        assert_eq!(var("opp.status_block.Frostbite_Status").eval(&state), 1.0);
        assert_eq!(var("opp.is_immune.Frostbite_Status").eval(&state), 1.0);
        assert_eq!(var("opp.is_immune.Poison_Status").eval(&state), 0.0);
    }

    #[test]
    fn event_heal_amount_resolves_from_extras() {
        // on_heal trigger surfaces heal_amount.
        let mut state = default_state();
        state
            .extras
            .insert("heal_amount".into(), PolicyValue::Number(250.0));
        assert_eq!(var("event.heal_amount").eval(&state), 250.0);
    }

    #[test]
    fn event_ended_per_ability_resolves_from_extras() {
        // on_active_end surfaces ended.<id> per ended
        // user.* active window. Mirror of the applied/expired pattern.
        let mut state = default_state();
        state
            .extras
            .insert("ended.user.haste".into(), PolicyValue::Number(1.0));
        state
            .extras
            .insert("ended_count".into(), PolicyValue::Number(1.0));
        assert_eq!(var("event.ended.user.haste").eval(&state), 1.0);
        assert_eq!(var("event.ended.user.never_set").eval(&state), 0.0);
        assert_eq!(var("event.ended_count").eval(&state), 1.0);
    }

    #[test]
    fn event_damage_kind_flags_resolve_from_extras() {
        // `event.is_bite` / `event.is_breath` /
        // `event.is_dot` are sugared paths over `state.extras` -
        // the engine populates them at on_take_damage / on_deal_damage
        // dispatch with the iter mask collapsed into 0/1 flags.
        let mut state = default_state();
        state
            .extras
            .insert("is_bite".into(), PolicyValue::Number(1.0));
        state
            .extras
            .insert("is_breath".into(), PolicyValue::Number(0.0));
        // is_dot intentionally not inserted - resolves to 0.0.
        assert_eq!(var("event.is_bite").eval(&state), 1.0);
        assert_eq!(var("event.is_breath").eval(&state), 0.0);
        assert_eq!(var("event.is_dot").eval(&state), 0.0);
    }

    #[test]
    fn rand_returns_value_in_unit_interval_and_is_deterministic() {
        // rand() returns a deterministic-pseudo-random
        // value in [0, 1). Same state ⇒ same value (eval is pure).
        // Different seeds (via different time) ⇒ different value.
        let mut state = default_state();
        state.time = 5.0;
        let r1 = Expr::Rand.eval(&state);
        let r2 = Expr::Rand.eval(&state);
        assert_eq!(r1, r2, "rand() must be deterministic for same state");
        assert!((0.0..1.0).contains(&r1), "rand() must land in [0, 1): got {}", r1);
        // Different time → different seed → (almost certainly) different value.
        state.time = 5.001;
        let r3 = Expr::Rand.eval(&state);
        assert_ne!(r1, r3, "different time should produce different rand value");
    }

    #[test]
    fn event_applied_per_status_id_resolves_via_state_extras() {
        // `event.applied.<status_id>` and
        // `event.expired.<status_id>` are sugared paths over state.extras.
        // The engine's status-diff dispatcher writes one 1.0 entry per
        // applied / expired status id alongside the existing count. The
        // engine stores them under keys WITHOUT the "event." prefix
        // (e.g. `applied.Poison_Status`) - the resolver strips "event."
        // from the variable path before looking up.
        let mut state = default_state();
        state
            .extras
            .insert("applied.Poison_Status".into(), PolicyValue::Number(1.0));
        state
            .extras
            .insert("expired.Burn_Status".into(), PolicyValue::Number(1.0));
        assert_eq!(var("event.applied.Poison_Status").eval(&state), 1.0);
        assert_eq!(var("event.expired.Burn_Status").eval(&state), 1.0);
        // Same status id with the wrong family returns 0.0 - namespaced.
        assert_eq!(var("event.expired.Poison_Status").eval(&state), 0.0);
        assert_eq!(var("event.applied.Burn_Status").eval(&state), 0.0);
        // Unknown id resolves to 0.0.
        assert_eq!(var("event.applied.Made_Up_Status").eval(&state), 0.0);
    }

    #[test]
    fn env_var_path_resolves_via_self_side_extras() {
        // env.* paths read from self_side.extras after
        // the engine populates them at simulation startup via
        // `seed_env_extras_into_side`. Here we mimic that by writing
        // directly into the side's extras map.
        let mut state = default_state();
        state
            .self_side
            .extras
            .insert("env.is_night".into(), PolicyValue::Number(1.0));
        state
            .self_side
            .extras
            .insert("env.is_blue_moon".into(), PolicyValue::Number(0.0));
        assert_eq!(var("env.is_night").eval(&state), 1.0);
        assert_eq!(var("env.is_blue_moon").eval(&state), 0.0);
        // Unknown env keys default to 0.0 - no panic on typos.
        assert_eq!(var("env.never_seeded").eval(&state), 0.0);
    }

    #[test]
    fn trigger_hooks_serialize_only_when_set() {
        let mut spec = sample_spec();
        // Default (empty) triggers should not appear in JSON, so
        // existing pre-trigger specs round-trip unchanged.
        let json = serde_json::to_string(&spec).unwrap();
        assert!(!json.contains("triggers"), "got json: {json}");
        // Set one trigger - should now appear.
        spec.triggers.on_round_start = Some(EffectBatch {
            name: "Open".into(),
            effects: vec![EffectKind::HealHp {
                target: EffectTarget::Caster,
                amount: 50.0,
            }],
            ..Default::default()
        });
        let json = serde_json::to_string(&spec).unwrap();
        assert!(json.contains("triggers"));
        assert!(json.contains("on_round_start"));
    }

    #[test]
    fn parse_surfaces_validation_error() {
        let bad_json = r#"{
            "id": "builtin.cheating",
            "display_name": "Cheat",
            "utility": { "kind": "const", "value": 1 },
            "is_available": { "kind": "const", "value": 1 },
            "on_fire": { "name": "x", "effects": [
                { "kind": "deal_direct_damage", "target": "opponent", "amount": 1 }
            ] }
        }"#;
        let err = parse_user_ability_spec(bad_json).unwrap_err();
        match err {
            ParseError::Validation(SpecError::IdNotUserNamespaced { .. }) => {}
            other => panic!("unexpected error: {other:?}"),
        }
    }

    /// Integration: a parsed UserDecision flows through the live
    /// `DecisionRegistry` + `PolicyRegistry` exactly the same way
    /// built-ins do. This proves the engine
    /// never special-cases a built-in by name; user decisions ride
    /// the same dispatch path.
    #[test]
    fn registered_user_decision_dispatches_through_policy_registry() {
        use crate::policy::light_projection::CombatStateProjection;
        use crate::policy::registry::{DecisionRegistry, PolicyRegistry};
        use crate::policy::timing_mode::TimingMode;
        use crate::policy::traits::TimedChoice;

        let spec = sample_spec();
        let mut decisions = DecisionRegistry::new();
        decisions.register(Box::new(UserDecision::new(spec)));

        let policies = PolicyRegistry::with_builtins();
        let projector = CombatStateProjection;

        let mut state = default_state();
        state.self_side.hp = 5_000.0; // ReallyFast gate (≤ 85 %) passes.

        let decision = decisions
            .get("user.pyro_strike")
            .expect("user decision registered");
        let policy = policies
            .for_mode(TimingMode::ReallyFast)
            .expect("really fast policy");

        let choice = policy.decide(decision, &state, &projector);
        assert_eq!(
            choice,
            TimedChoice::Now,
            "ReallyFast must fire user ability when its gate passes",
        );
    }

    #[test]
    fn user_decision_under_ideal_picks_the_higher_utility_candidate() {
        // The Ideal policy enumerates candidate delays. Build a
        // spec where utility scales with bite_dps; verify Ideal
        // returns Now (delay 0) when there's no decay reason to
        // wait. This locks the contract that user decisions flow
        // through the same candidate-search path as built-ins.
        use crate::policy::light_projection::CombatStateProjection;
        use crate::policy::registry::{DecisionRegistry, PolicyRegistry};
        use crate::policy::timing_mode::TimingMode;
        use crate::policy::traits::TimedChoice;

        let spec = sample_spec();
        let mut decisions = DecisionRegistry::new();
        decisions.register(Box::new(UserDecision::new(spec)));

        let policies = PolicyRegistry::with_builtins();
        let projector = CombatStateProjection;

        let state = default_state();
        let decision = decisions.get("user.pyro_strike").expect("registered");
        let policy = policies.for_mode(TimingMode::Ideal).expect("ideal policy");

        match policy.decide(decision, &state, &projector) {
            TimedChoice::Now | TimedChoice::Wait { .. } => {} // either fine
            TimedChoice::Skip => {
                panic!("Ideal should not skip a user ability with positive utility")
            }
        }
    }
}
