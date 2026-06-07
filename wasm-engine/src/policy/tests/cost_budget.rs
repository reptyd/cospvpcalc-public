//! `decide_timed` cost budget.
//!
//! Under Ideal mode, `decide_timed` per ability must complete in
//! ≤1 ms on the reference matchup. This test uses
//! `std::time::Instant` (no Criterion - keeps the bench in-tree and
//! sandbox-friendly).
//!
//! Notes:
//!
//! - The budget is per-decision per-call. Engine call sites
//!   evaluate decisions every tick; total per-tick cost is
//!   bounded by sum across all migrated abilities.
//! - We call `policy_bridge::should_activate_now` /
//!   `toggle_state_now` from the live engine path - that is the
//!   "real" decision call site, not a synthetic micro-benchmark.
//! - Test runs each decision N times and asserts the per-call mean
//!   stays under the budget. Single-call timing is too noisy.

use std::time::Instant;

use crate::composable::policy_bridge;
use crate::contracts::SimpleStatusInstance;
use crate::policy::decisions::{
    cocoon::COCOON_DECISION_ID, fortify::FORTIFY_DECISION_ID,
    hunters_curse::HUNTERS_CURSE_DECISION_ID, life_leech::LIFE_LEECH_DECISION_ID,
    rewind::REWIND_DECISION_ID,
};
use crate::policy::state::{PolicySide, PolicyValue};
use crate::policy::testing::default_side;
use crate::policy::timing_mode::TimingMode;

const BUDGET_MS_PER_CALL: f64 = 1.0;
const ITERATIONS: usize = 200;

/// Cost-budget benchmark side: pre-wounded (60 % HP) so HP-gated
/// decisions like Cocoon / Life Leech actually evaluate, with regen
/// and hunker_reduction_pct flipped on so the heuristics walk their
/// non-trivial branches.
fn fresh_side(hp: f64) -> PolicySide {
    let mut s = default_side();
    s.stats.health = hp;
    s.stats.damage = 60.0;
    s.stats.health_regen = 2.0;
    s.stats.hunker_reduction_pct = 40.0;
    s.hp = hp * 0.6;
    s
}

fn measure_per_call_ms<F: FnMut() -> bool>(mut f: F) -> f64 {
    // Warm-up
    for _ in 0..20 {
        std::hint::black_box(f());
    }
    let start = Instant::now();
    for _ in 0..ITERATIONS {
        std::hint::black_box(f());
    }
    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    elapsed / ITERATIONS as f64
}

#[test]
fn life_leech_decide_under_one_ms() {
    let mean = measure_per_call_ms(|| {
        let mut self_side = fresh_side(2000.0);
        self_side
            .extras
            .insert("builtin.life_leech.value".to_string(), PolicyValue::Number(0.30));
        let opp_side = fresh_side(2200.0);
        policy_bridge::should_activate_now(
            LIFE_LEECH_DECISION_ID,
            self_side, opp_side,
            5.0,
            TimingMode::Ideal,
        )
    });
    assert!(
        mean < BUDGET_MS_PER_CALL,
        "Life Leech decide_timed under Ideal must be <{BUDGET_MS_PER_CALL} ms/call: got {mean:.4} ms"
    );
}

#[test]
fn fortify_decide_under_one_ms() {
    let mean = measure_per_call_ms(|| {
        let mut self_side = fresh_side(2000.0);
        // Add removable statuses so Fortify is_available passes and
        // utility actually computes.
        self_side.statuses.insert(
            "Burn_Status".to_string(),
            SimpleStatusInstance {
                stacks: 8.0,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 24.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
        self_side.statuses.insert(
            "Bleed_Status".to_string(),
            SimpleStatusInstance {
                stacks: 5.0,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 15.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
        let opp_side = fresh_side(2200.0);
        policy_bridge::should_activate_now(
            FORTIFY_DECISION_ID,
            self_side, opp_side,
            5.0,
            TimingMode::Ideal,
        )
    });
    assert!(
        mean < BUDGET_MS_PER_CALL,
        "Fortify decide_timed under Ideal must be <{BUDGET_MS_PER_CALL} ms/call: got {mean:.4} ms"
    );
}

#[test]
fn hunters_curse_decide_under_one_ms() {
    let mean = measure_per_call_ms(|| {
        let self_side = fresh_side(3000.0);
        let opp_side = fresh_side(3200.0);
        policy_bridge::should_activate_now(
            HUNTERS_CURSE_DECISION_ID,
            self_side, opp_side,
            5.0,
            TimingMode::Ideal,
        )
    });
    assert!(
        mean < BUDGET_MS_PER_CALL,
        "Hunters Curse decide_timed under Ideal must be <{BUDGET_MS_PER_CALL} ms/call: got {mean:.4} ms"
    );
}

#[test]
fn cocoon_decide_under_one_ms() {
    let mean = measure_per_call_ms(|| {
        let self_side = fresh_side(2000.0); // 60 % HP - passes Cocoon HP gate
        let opp_side = fresh_side(2200.0);
        policy_bridge::should_activate_now(
            COCOON_DECISION_ID,
            self_side, opp_side,
            5.0,
            TimingMode::Ideal,
        )
    });
    assert!(
        mean < BUDGET_MS_PER_CALL,
        "Cocoon decide_timed under Ideal must be <{BUDGET_MS_PER_CALL} ms/call: got {mean:.4} ms"
    );
}

#[test]
fn rewind_decide_under_one_ms() {
    let mean = measure_per_call_ms(|| {
        let mut self_side = fresh_side(2000.0);
        self_side.extras.insert(
            "builtin.rewind.restored_hp_delta".to_string(),
            PolicyValue::Number(800.0),
        );
        self_side.extras.insert(
            "builtin.rewind.restored_status_delta".to_string(),
            PolicyValue::Number(2.0),
        );
        let opp_side = fresh_side(2200.0);
        policy_bridge::should_activate_now(
            REWIND_DECISION_ID,
            self_side, opp_side,
            10.0,
            TimingMode::Ideal,
        )
    });
    assert!(
        mean < BUDGET_MS_PER_CALL,
        "Rewind decide_timed under Ideal must be <{BUDGET_MS_PER_CALL} ms/call: got {mean:.4} ms"
    );
}

#[test]
fn hunker_toggle_decide_under_one_ms() {
    let mean = measure_per_call_ms(|| {
        let self_side = fresh_side(2000.0);
        let opp_side = fresh_side(2200.0);
        policy_bridge::toggle_state_now(
            "builtin.hunker",
            self_side, opp_side,
            5.0,
            TimingMode::Ideal,
        )
    });
    assert!(
        mean < BUDGET_MS_PER_CALL,
        "Hunker toggle_state_now under Ideal must be <{BUDGET_MS_PER_CALL} ms/call: got {mean:.4} ms"
    );
}
