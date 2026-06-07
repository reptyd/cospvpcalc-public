//! Reference: status_bad_omen
//!
//! Covers each testable bullet in the "Bad Omen" entry. Each test
//! body starts with the [REF:status_bad_omen] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine paths:
//! - Regen reduction: `combat.rs:404-406` - Bad_Omen presence
//!   multiplies passive regen by 0.75 (= -25% flat).
//! - Follow-up application: `statuses.rs:442-478`
//!   `apply_bad_omen_outcome_if_removed` reads the pre-resolved
//!   `bad_omen_outcome` from `ComposableAbilityConfig` and applies
//!   the chosen status × stacks to the target the moment Bad_Omen
//!   transitions from stacks > 0 to stacks == 0.

use super::default_combatant;
use crate::combat::hp_regen_multiplier_from_statuses;
use crate::contracts::SimpleStatusInstance;
use crate::statuses::apply_bad_omen_outcome_if_removed;
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
    assert!(
        (mult - 0.75).abs() < 1e-12,
        "Bad Omen must yield 0.75x regen multiplier (-25%): got {mult}"
    );
}

#[test]
fn no_regen_modifier_without_bad_omen_present() {
    // [REF:status_bad_omen]
    // Inverse sanity: empty statuses map → 1.0x regen.
    let statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    let mult = hp_regen_multiplier_from_statuses(&statuses);
    assert!(
        (mult - 1.0).abs() < 1e-12,
        "no Bad Omen present → 1.0x regen: got {mult}"
    );
}

#[test]
fn follow_up_status_applies_when_bad_omen_expires() {
    // [REF:status_bad_omen]
    // Bullet 2 + 3: "When Bad Omen ends, it applies one follow-up
    // status." + "That follow-up status can be one of the following:
    // 5 Frostbite, 8 Burn, 10 Bleed, 5 Corrosion, 3 Confusion, 3
    // Shredded Wings, 20 Disease, 10 Injury, 10 Necropoison, or 10
    // Poison."
    // Engine: helper applies the configured outcome (status_id +
    // stacks) when Bad_Omen transitions stacks > 0 → 0. Use Burn × 8
    // as the canonical Best Builds / Optimizer outcome.
    let target = default_combatant();
    let mut previous: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    previous.insert("Bad_Omen".to_string(), instance(1.0, 100.0));
    let mut current: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    // Bad_Omen has dropped to 0 stacks (= removed from current)
    let outcome = crate::contracts::SimpleBadOmenOutcome {
        status_id: "Burn_Status".to_string(),
        stacks: 8.0,
        label: "Burn 8".to_string(),
    };
    apply_bad_omen_outcome_if_removed(
        0.0,
        &target,
        target.health,
        &previous,
        &mut current,
        Some(&outcome),
        0.0,
    );
    let burn = current.get("Burn_Status").map(|s| s.stacks).unwrap_or(0.0);
    assert!(
        (burn - 8.0).abs() < 1e-9,
        "Bad Omen expiry must apply 8 stacks of Burn_Status: got {burn}"
    );
}
