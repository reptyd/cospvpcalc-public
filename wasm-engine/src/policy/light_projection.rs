//! Built-in deterministic forward-projection of [`PolicyState`].
//!
//! Pillar 3a: the engine's projector advances the strongly-typed
//! built-in fields of a [`PolicyState`] (statuses, HP, cooldowns,
//! breath capacity, time). User-added `extras` are passed through
//! by clone - if a user decision needs custom extras to evolve over
//! time, the user provides their own `StateProjection` impl.
//!
//! The projection is intentionally cheap. It does NOT run the full
//! composable simulation. The accuracy budget is "good enough for a
//! decision over a 0-120 s horizon"; the engine compensates by
//! re-projecting from a fresh snapshot every tick.
//!
//! What gets advanced:
//!
//! - **Time** - `state.time += delta_sec`.
//! - **Statuses** - each persistent ailment (Bleed, Burn, Poison,
//!   Corrosion, Necropoison, Frostbite, Blessings_Boon) has its
//!   stack count decayed by `floor(delta_sec / 3)` (1 stack per
//!   3 s, mirroring `statuses.rs::status_decay_sec`). DoT damage
//!   over the window is subtracted from `hp`.
//! - **Self-buff windows** - `active_until` keys with values <
//!   projected time are dropped.
//! - **Cooldowns** - passive (cooldowns are absolute timestamps in
//!   simulation time, not deltas; no advance needed beyond `time`).
//! - **Natural regen** - adds floor(delta_sec / 15) regen ticks for
//!   the projected interval, gated by current statuses (Bleed
//!   disables, Burn reduces, …).
//! - **Breath capacity** - drained 1:1 with `delta_sec` while the
//!   side has a breath profile, floored at 0. This is conservative
//!   (assumes continuous firing) but bounded; decisions that gate
//!   on breath presence (e.g. Fortify immunity from breath-applied
//!   statuses) read the projected capacity to scale their estimate.
//!
//! What is **not** modeled (and is OK to omit per the engine's
//! cost discipline):
//!
//! - Opponent ability activations during the window.
//! - Status applications by either side during the window.
//! - Breath capacity refill from regen.

use crate::combat::hp_regen_multiplier_from_statuses;
use crate::policy::state::{PolicySide, PolicyState};
use crate::policy::traits::StateProjection;
use crate::statuses::compute_simple_dot_damage;

const STATUS_TICK_SEC: f64 = 3.0;
const REGEN_TICK_SEC: f64 = 15.0;

/// Stable ids of statuses whose stack count decays at 1 / 3 s and
/// whose DoT we account for in the projection.
const DOT_STATUS_IDS: &[&str] = &[
    "Bleed_Status",
    "Burn_Status",
    "Poison_Status",
    "Corrosion_Status",
    "Necropoison_Status",
    "Frostbite_Status",
    "Hypothermia_Status",
    "Heat_Wave_Status",
];

/// Default combat-side projector. Wraps the helpers below.
pub struct CombatStateProjection;

impl StateProjection for CombatStateProjection {
    fn project(&self, state: &PolicyState, delta_sec: f64) -> PolicyState {
        if delta_sec <= 0.0 || !delta_sec.is_finite() {
            return state.clone();
        }
        let mut next = state.clone();
        next.time = state.time + delta_sec;
        // Estimate the per-second melee damage each side deals to
        // the other under steady-state DPS, capturing the incoming-
        // damage component the projection wouldn't otherwise see.
        let outgoing_dps_self = state.self_side.bite_dps();
        let outgoing_dps_opp = state.opponent.bite_dps();
        project_side(&mut next.self_side, delta_sec, outgoing_dps_opp);
        project_side(&mut next.opponent, delta_sec, outgoing_dps_self);
        // Drop expired buff windows on both sides.
        prune_active_until(&mut next.self_side, next.time);
        prune_active_until(&mut next.opponent, next.time);
        next
    }
}

fn project_side(side: &mut PolicySide, delta_sec: f64, opponent_dps: f64) {
    let max_hp = side.stats.health.max(1.0);
    let mut hp = side.hp;

    // 0. Linear-rate incoming melee damage from the opponent.
    //    The light projection deliberately models this as a smooth
    //    DPS rather than discrete bite events - accuracy budget is
    //    "good enough for utility ranking", not "matches the live
    //    sim tick for tick".
    if opponent_dps > 0.0 && delta_sec > 0.0 {
        hp -= opponent_dps * delta_sec;
    }

    // 1. Cumulative DoT damage over the window, evaluated AT START
    //    OF EACH TICK using the stack count at that tick.
    let dot_ticks = (delta_sec / STATUS_TICK_SEC).floor() as i64;
    for _tick in 0..dot_ticks {
        for status_id in DOT_STATUS_IDS {
            let stacks = side.status_stacks(status_id);
            if stacks <= 0.0 {
                continue;
            }
            let dmg = compute_simple_dot_damage(max_hp, status_id, stacks, STATUS_TICK_SEC);
            hp -= dmg;
        }
        // Decay each status by 1 stack after its tick.
        for status_id in DOT_STATUS_IDS {
            if let Some(inst) = side.statuses.get_mut(*status_id) {
                inst.stacks = (inst.stacks - 1.0).max(0.0);
                if inst.stacks <= 0.0 {
                    inst.remaining_sec = 0.0;
                }
            }
        }
    }
    // Drop any status that fully decayed.
    side.statuses
        .retain(|_, inst| inst.stacks > 0.0);

    // 2. Natural regen ticks (15 s cadence). Read the multiplier
    //    from the projected status map (after decay above).
    let regen_ticks = (delta_sec / REGEN_TICK_SEC).floor() as i64;
    if regen_ticks > 0 && side.stats.health_regen > 0.0 {
        let mult = hp_regen_multiplier_from_statuses(&side.statuses);
        if mult > 0.0 {
            let heal_per_tick = max_hp * (side.stats.health_regen / 100.0) * mult;
            hp += heal_per_tick * regen_ticks as f64;
        }
    }

    side.hp = hp.clamp(0.0, max_hp);

    // 3. Breath capacity drain - assume continuous firing whenever
    //    the side has a breath profile. Conservative for short-fire
    //    breaths but bounds Fortify-style "immunity vs breath" math.
    if side.breath.is_some() {
        side.breath_capacity = (side.breath_capacity - delta_sec).max(0.0);
    }
}

fn prune_active_until(side: &mut PolicySide, now: f64) {
    side.active_until.retain(|_, until| *until > now);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::testing;

    /// Build a baseline state with the opponent's damage zeroed so the
    /// projection's incoming-DPS term drops out and individual-mechanic
    /// tests below assert their own contribution in isolation.
    fn state_no_opp_dps() -> PolicyState {
        let mut state = testing::default_state();
        state.opponent.stats.damage = 0.0;
        state
    }

    #[test]
    fn projection_advances_time_and_decays_statuses() {
        let mut state = state_no_opp_dps();
        state
            .self_side
            .statuses
            .insert("Burn_Status".to_string(), testing::status_instance(5.0));
        let proj = CombatStateProjection;
        let next = proj.project(&state, 9.0); // 3 status ticks.

        assert!((next.time - 9.0).abs() < 1e-9);
        // Burn 5 → 4 → 3 → 2 after three ticks.
        let burn = next.self_side.status_stacks("Burn_Status");
        assert!(
            (burn - 2.0).abs() < 1e-9,
            "Burn must decay 5 → 2 after 3 ticks: got {burn}"
        );
    }

    #[test]
    fn projection_subtracts_dot_damage_from_hp() {
        let mut state = state_no_opp_dps();
        state
            .self_side
            .statuses
            .insert("Burn_Status".to_string(), testing::status_instance(5.0));
        let proj = CombatStateProjection;
        let next = proj.project(&state, 3.0);
        // 1 Burn tick at stacks=5: 0.025 + 0.5 = 0.525% maxHP = 52.5.
        let expected_hp = 10_000.0 - 52.5;
        assert!(
            (next.self_side.hp - expected_hp).abs() < 1e-6,
            "HP after one Burn tick on 10000 max = {expected_hp}: got {}",
            next.self_side.hp
        );
    }

    #[test]
    fn projection_drops_fully_decayed_statuses_from_map() {
        let mut state = state_no_opp_dps();
        state
            .self_side
            .statuses
            .insert("Bleed_Status".to_string(), testing::status_instance(2.0));
        let proj = CombatStateProjection;
        let next = proj.project(&state, 9.0); // 3 ticks → 2 → 1 → 0.
        assert!(
            !next.self_side.statuses.contains_key("Bleed_Status"),
            "fully decayed Bleed must be dropped from the map"
        );
    }

    #[test]
    fn projection_applies_natural_regen() {
        let mut state = state_no_opp_dps();
        state.self_side.hp = 5_000.0;
        state.self_side.stats.health_regen = 5.0; // 5% maxHP per tick.
        let proj = CombatStateProjection;
        let next = proj.project(&state, 30.0); // 2 regen ticks.
        // 2 × 5% × 10000 = 1000 healing → 5000 + 1000 = 6000.
        assert!(
            (next.self_side.hp - 6_000.0).abs() < 1e-6,
            "HP after 2 regen ticks must be 6000: got {}",
            next.self_side.hp
        );
    }

    #[test]
    fn projection_drops_expired_active_until_keys() {
        let mut state = state_no_opp_dps();
        state
            .self_side
            .active_until
            .insert("builtin.fortify".to_string(), 5.0);
        state
            .self_side
            .active_until
            .insert("user.haste".to_string(), 30.0);
        let proj = CombatStateProjection;
        let next = proj.project(&state, 10.0); // time → 10 → fortify expired.
        assert!(
            !next.self_side.active_until.contains_key("builtin.fortify"),
            "expired buff must be dropped"
        );
        assert!(
            next.self_side.active_until.contains_key("user.haste"),
            "future buff must survive"
        );
    }

    #[test]
    fn zero_or_negative_delta_is_a_clone() {
        let mut state = state_no_opp_dps();
        state
            .self_side
            .statuses
            .insert("Burn_Status".to_string(), testing::status_instance(5.0));
        let proj = CombatStateProjection;
        let same = proj.project(&state, 0.0);
        assert!((same.time - state.time).abs() < 1e-12);
        assert_eq!(
            same.self_side.status_stacks("Burn_Status"),
            5.0,
            "delta=0 must not decay statuses"
        );
        let neg = proj.project(&state, -5.0);
        assert!((neg.time - state.time).abs() < 1e-12);
    }
}
