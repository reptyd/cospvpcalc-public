//! Reference: status_bad_omen
//!
//! Covers each testable bullet in the "Bad Omen" entry. Each test
//! body starts with the [REF:status_bad_omen] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine paths:
//! - Regen reduction: `combat.rs:404-406` - Bad_Omen presence
//!   multiplies passive regen by 0.75 (= -25% flat).
//! - Follow-up application: `statuses.rs`
//!   `apply_bad_omen_outcome_if_removed` consumes the next entry from
//!   `config.bad_omen_outcomes` (cycling per side via the expiry
//!   counter) and applies it the moment Bad_Omen transitions from
//!   stacks > 0 to stacks == 0. Bad Omen is random in-game, so the
//!   caller fills the list with a freshly-rolled batch (Compare /
//!   Sandbox) or a single deterministic outcome (Best Builds: Burn 8).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_combatant};
use crate::combat::hp_regen_multiplier_from_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBadOmenOutcome, SimpleCombatantStats, SimpleStatusInstance};
use crate::spec_constants::BAD_OMEN_REGEN_REDUCTION_PCT;
use crate::statuses::next_bad_omen_outcome;
use std::collections::BTreeMap;

fn instance(stacks: f64, remaining_sec: f64) -> SimpleStatusInstance {
    SimpleStatusInstance {
        stacks,
        next_tick_at: None,
        next_decay_at: None,
        remaining_sec,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    }
}

#[test]
fn reduces_passive_regen_by_twenty_five_percent() {
    // [REF:status_bad_omen]
    // Bullet 1: "Bad Omen reduces passive health regeneration by 25%
    // while it is active."
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Bad_Omen".to_string(), instance(1.0, 100.0));
    let mult = hp_regen_multiplier_from_statuses(&statuses);
    let expected = 1.0 - BAD_OMEN_REGEN_REDUCTION_PCT / 100.0;
    assert!(
        (mult - expected).abs() < 1e-12,
        "Bad Omen must yield {expected}x regen multiplier (-{BAD_OMEN_REGEN_REDUCTION_PCT}%): got {mult}"
    );
}

#[test]
fn no_regen_modifier_without_bad_omen_present() {
    // [REF:status_bad_omen]
    // Inverse sanity: empty statuses map -> 1.0x regen.
    let statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    let mult = hp_regen_multiplier_from_statuses(&statuses);
    assert!(
        (mult - 1.0).abs() < 1e-12,
        "no Bad Omen present → 1.0x regen: got {mult}"
    );
}

#[test]
fn follow_up_fires_end_to_end_in_a_full_sim() {
    // [REF:status_bad_omen]
    // The whole point of the fix: in a real matchup, a side's Bad_Omen expiry
    // applies the configured follow-up via `config.bad_omen_outcomes`. B starts
    // with 1 stack of Bad_Omen (decays ~3 s); the configured Burn 8 must land,
    // surfaced in the summary's applied-outcome.
    fn passive(max_hp: f64) -> SimpleCombatantStats {
        let mut c = default_combatant();
        c.health = max_hp;
        c.damage = 0.0;
        c.bite_cooldown = 1000.0;
        c
    }
    let a = passive(1_000_000.0);
    let mut b = passive(1_000_000.0);
    b.starting_statuses = vec![applied_status("Bad_Omen", 1.0)];

    let mut cfg = ComposableAbilityConfig::default();
    cfg.bad_omen_outcomes = vec![SimpleBadOmenOutcome {
        status_id: "Burn_Status".into(),
        stacks: 8.0,
        label: "Burn 8".into(),
    }];
    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg, 6.0, true,
    );
    assert_eq!(
        result.bad_omen_outcome.map(|o| o.status_id).as_deref(),
        Some("Burn_Status"),
        "Bad Omen expiry in a full sim must apply the configured follow-up"
    );
}

#[test]
fn outcome_list_cycles_per_expiry() {
    // [REF:status_bad_omen]
    // Each expiry consumes the next entry, cycling the list - this is what makes
    // a freshly-rolled batch produce a different follow-up on each Bad Omen death
    // within a run (Compare / Sandbox), while a single-entry list (Best Builds)
    // always yields the same outcome.
    let outcomes = [
        SimpleBadOmenOutcome { status_id: "Burn_Status".into(), stacks: 8.0, label: "Burn 8".into() },
        SimpleBadOmenOutcome { status_id: "Poison_Status".into(), stacks: 10.0, label: "Poison 10".into() },
    ];
    let mut count = 0u32;
    assert_eq!(next_bad_omen_outcome(&outcomes, &mut count).unwrap().status_id, "Burn_Status");
    assert_eq!(next_bad_omen_outcome(&outcomes, &mut count).unwrap().status_id, "Poison_Status");
    assert_eq!(next_bad_omen_outcome(&outcomes, &mut count).unwrap().status_id, "Burn_Status"); // wraps
    assert!(next_bad_omen_outcome(&[], &mut count).is_none(), "empty list = no follow-up");
}
