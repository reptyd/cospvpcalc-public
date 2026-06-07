//! Pillar 5.1 - edge-case sanity per ability × per timing mode.
//!
//! For every migrated ability, run a small matrix of extreme states
//! through every timing mode and assert each decision behaves
//! sanely. "Sane" is defined per ability via explicit assertions -
//! no fuzzy "looks right".
//!
//! Coverage matrix:
//!
//! - HP at 100 % (full HP edge): defensive abilities should not
//!   fire pre-emptively under their guards.
//! - HP at ~1 % (near-death): defensives should fire (subject to
//!   their own gates).
//! - No statuses: cleanse-style abilities should skip.
//! - Cooldown pending: every ability should refuse to fire.
//!
//! These tests evaluate the decision impls directly (calling
//! `TimedDecision::utility` / `is_available` / `really_fast_gate`,
//! or `ToggleDecision::on_off_delta` / `is_eligible`) - no full
//! simulation. That keeps the tests focused on the decision-layer
//! contract, leaving sim-level behaviour to the `monotonicity` and
//! `fixture_parity` suites.


use crate::contracts::SimpleStatusInstance;
use crate::policy::decisions::{
    adrenaline::ADRENALINE_DECISION_ID, cocoon::COCOON_DECISION_ID,
    fortify::FORTIFY_DECISION_ID, hunters_curse::HUNTERS_CURSE_DECISION_ID,
    life_leech::LEECH_VALUE_EXTRA_KEY,
    reflect::REFLECT_DECISION_ID, rewind::REWIND_DECISION_ID, AdrenalineDecision, CocoonDecision,
    FortifyDecision, HunkerDecision, HuntersCurseDecision, LifeLeechDecision, ReflectDecision,
    RewindDecision, UnbridledRageDecision, WardensRageDecision,
};
use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::testing::default_state as fresh_state;
use crate::policy::traits::{TimedDecision, ToggleDecision};

fn cooldown_pending(decision_id: &str) -> PolicyState {
    let mut state = fresh_state();
    state.self_side.hp = 5_000.0; // pre-wounded so HP gates don't bite
    state
        .self_side
        .cooldowns
        .insert(decision_id.to_string(), 100.0);
    state.time = 30.0;
    state
}

// ---- Adrenaline ---------------------------------------------------------

#[test]
fn adrenaline_full_hp_still_eligible() {
    let state = fresh_state();
    let d = AdrenalineDecision::new();
    assert!(d.is_available(&state));
    // Pure outgoing buff has no HP gate: ReallyFast fires at full HP.
    assert_eq!(d.really_fast_gate(&state), Some(true));
}

#[test]
fn adrenaline_cooldown_pending_skips_in_all_modes() {
    let state = cooldown_pending(ADRENALINE_DECISION_ID);
    let d = AdrenalineDecision::new();
    assert!(!d.is_available(&state));
    assert_eq!(d.really_fast_gate(&state), Some(false));
    // `utility` itself is a pure value formula and may return a
    // positive number even during cooldown - search policies still
    // gate on `is_available` before using the candidate. The
    // monotonicity test layer covers that integration; this layer
    // only asserts the availability and ReallyFast gate signals.
}

// ---- Reflect ------------------------------------------------------------

#[test]
fn reflect_zero_utility_when_opp_does_no_damage() {
    let mut state = fresh_state();
    state.opponent.stats.damage = 0.0;
    let d = ReflectDecision::new();
    assert_eq!(d.utility(&state), 0.0);
}

#[test]
fn reflect_cooldown_pending_skips() {
    let state = cooldown_pending(REFLECT_DECISION_ID);
    let d = ReflectDecision::new();
    assert!(!d.is_available(&state));
}

// ---- Life Leech ---------------------------------------------------------

#[test]
fn life_leech_full_hp_skips_really_fast() {
    let mut state = fresh_state();
    state
        .self_side
        .extras
        .insert(LEECH_VALUE_EXTRA_KEY.to_string(), PolicyValue::Number(0.3));
    // hp == max_hp → really_fast_gate still skips (hp_ratio > 0.85).
    // Note: is_available now returns true on full HP - search
    // policies route through utility, which discriminates by
    // in-window damage. ReallyFast gate stays purely hp-ratio
    // based and so still skips full-HP fires.
    let d = LifeLeechDecision::new();
    assert_eq!(d.really_fast_gate(&state), Some(false));
}

#[test]
fn life_leech_near_death_fires_really_fast() {
    let mut state = fresh_state();
    state.self_side.hp = 100.0; // 1 % HP
    state
        .self_side
        .extras
        .insert(LEECH_VALUE_EXTRA_KEY.to_string(), PolicyValue::Number(0.3));
    let d = LifeLeechDecision::new();
    assert_eq!(d.really_fast_gate(&state), Some(true));
}

#[test]
fn life_leech_zero_value_never_fires() {
    let mut state = fresh_state();
    state.self_side.hp = 5_000.0; // pre-wounded
    state
        .self_side
        .extras
        .insert(LEECH_VALUE_EXTRA_KEY.to_string(), PolicyValue::Number(0.0));
    let d = LifeLeechDecision::new();
    assert!(!d.is_available(&state));
    assert_eq!(d.utility(&state), 0.0);
}

// ---- Hunters Curse ------------------------------------------------------

/// HC engine cost has a 1 HP floor - the cast can't kill outright.
/// What rejects this candidate in precision mode is the active-window
/// survival check (1 HP at start of a 30 s window with any incoming
/// DPS at all dies). Fast / ReallyFast bypass via really_fast_gate
/// because fast policies stay simple.
#[test]
fn hunters_curse_low_hp_skips_via_window_survival_not_via_cost() {
    let mut state = fresh_state();
    state.self_side.hp = 4_000.0; // post-cost engine clamp = 1 HP
    let u = HuntersCurseDecision::new().utility(&state);
    assert!(u.is_infinite() && u < 0.0, "window survival skip → -∞: got {u}");
}

#[test]
fn hunters_curse_cooldown_pending_skips() {
    let state = cooldown_pending(HUNTERS_CURSE_DECISION_ID);
    let d = HuntersCurseDecision::new();
    assert!(!d.is_available(&state));
}

// ---- Unbridled Rage -----------------------------------------------------

#[test]
fn unbridled_rage_no_damage_yields_zero_utility() {
    let mut state = fresh_state();
    state.self_side.stats.damage = 0.0;
    let d = UnbridledRageDecision::new();
    assert_eq!(d.utility(&state), 0.0);
}

// ---- Cocoon -------------------------------------------------------------

#[test]
fn cocoon_full_hp_unavailable() {
    let state = fresh_state();
    let d = CocoonDecision::new();
    assert!(!d.is_available(&state));
}

#[test]
fn cocoon_cooldown_pending_skips() {
    let state = cooldown_pending(COCOON_DECISION_ID);
    let d = CocoonDecision::new();
    assert!(!d.is_available(&state));
}

// ---- Fortify ------------------------------------------------------------

#[test]
fn fortify_no_removable_statuses_unavailable() {
    let state = fresh_state();
    let d = FortifyDecision::new();
    assert!(!d.is_available(&state));
}

#[test]
fn fortify_cooldown_pending_skips() {
    let state = cooldown_pending(FORTIFY_DECISION_ID);
    // Even if there are removable stacks, cooldown blocks.
    let mut state = state;
    state.self_side.statuses.insert(
        "Bleed_Status".to_string(),
        SimpleStatusInstance {
            stacks: 30.0,
            next_tick_at: None,
            next_decay_at: None,
            remaining_sec: 100.0,
            stack_value_mode: None,
            lich_mark_owned_stacks: None,
            no_decay: false,
            resolved_scalars: None,
        },
    );
    let d = FortifyDecision::new();
    assert!(!d.is_available(&state));
}

// ---- Hunker (toggle) ---------------------------------------------------

#[test]
fn hunker_no_reduction_value_negative_delta() {
    let mut state = fresh_state();
    state.self_side.stats.hunker_reduction_pct = 0.0;
    let d = HunkerDecision::new();
    assert!(d.on_off_delta(&state) < 0.0);
}

#[test]
fn hunker_eligible_unconditionally() {
    let state = fresh_state();
    let d = HunkerDecision::new();
    assert!(d.is_eligible(&state));
    assert_eq!(d.really_fast_default(&state), Some(true));
}

// ---- Warden's Rage (toggle) --------------------------------------------

#[test]
fn warden_rage_full_hp_no_regen_zero_delta() {
    let mut state = fresh_state();
    state.self_side.stats.health_regen = 0.0; // no regen loss term
    let d = WardensRageDecision::new();
    let delta = d.on_off_delta(&state);
    assert!(delta.abs() < 1e-9, "got {delta}");
}

#[test]
fn warden_rage_currently_off_with_cooldown_ineligible() {
    use crate::policy::decisions::wardens_rage::{
        CURRENT_STATE_EXTRA_KEY, WARDEN_RAGE_DECISION_ID,
    };
    let mut state = fresh_state();
    state
        .self_side
        .extras
        .insert(CURRENT_STATE_EXTRA_KEY.to_string(), PolicyValue::Bool(false));
    state
        .self_side
        .cooldowns
        .insert(WARDEN_RAGE_DECISION_ID.to_string(), 30.0);
    state.time = 10.0;
    let d = WardensRageDecision::new();
    assert!(!d.is_eligible(&state));
}

// ---- Rewind -------------------------------------------------------------

#[test]
fn rewind_no_snapshot_extras_unavailable() {
    let mut state = fresh_state();
    state.self_side.hp = 3_000.0; // would normally pass HP gate
    let d = RewindDecision::new();
    // No snapshot extras populated → unavailable.
    assert!(!d.is_available(&state));
}

#[test]
fn rewind_cooldown_pending_skips() {
    use crate::policy::decisions::rewind::{
        RESTORED_HP_DELTA_KEY, RESTORED_STATUS_DELTA_KEY,
    };
    let mut state = cooldown_pending(REWIND_DECISION_ID);
    state
        .self_side
        .extras
        .insert(RESTORED_HP_DELTA_KEY.to_string(), PolicyValue::Number(2_000.0));
    state
        .self_side
        .extras
        .insert(RESTORED_STATUS_DELTA_KEY.to_string(), PolicyValue::Number(2.0));
    let d = RewindDecision::new();
    assert!(!d.is_available(&state));
}
