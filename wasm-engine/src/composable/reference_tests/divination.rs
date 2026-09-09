//! Reference: ability_divination
//!
//! Covers each testable bullet in the "Divination" entry. Each test body
//! starts with the [REF:ability_divination] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! The "applies 2 stacks of Burn per charged bite" claim is verified by
//! source inspection of composable/mod.rs:4811-4823 (and the symmetric
//! defender block at mod.rs:5157-5169): each charge consumes one bite
//! and emits a `Burn_Status` apply with `stacks: 2.0`. The runtime tests
//! below cover the +50 flat damage bonus, the 120 s cooldown, the
//! re-arm gate (only when charges are fully spent), and the lack of
//! policy-mode timing differences.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{
    DIVINATION_BITE_CHARGES, DIVINATION_COOLDOWN_SEC, DIVINATION_FLAT_DAMAGE,
};

fn divination_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_divination = true;
    cfg
}

fn biting_attacker(damage: f64, bite_cd: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = 1_000.0;
    c.damage = damage;
    c.bite_cooldown = bite_cd;
    c
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn divination_activation_times(
    cfg: &ComposableAbilityConfig,
    policy: SimpleAbilityTimingMode,
    max_time_sec: f64,
    bite_cd: f64,
) -> Vec<f64> {
    let attacker = biting_attacker(50.0, bite_cd);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None, policy, cfg, max_time_sec, true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Divination activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn exactly_three_bites_get_fifty_flat_bonus() {
    // [REF:ability_divination]
    // Three charges -> exactly three of the first several bites carry a
    // +50 flat damage bonus on top of the weight-symmetric base damage.
    let attacker = biting_attacker(50.0, 2.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &divination_attacker_config(),
        12.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let bite_damages: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "A")
        .map(|e| e.damage)
        .collect();
    assert!(
        bite_damages.len() >= 4,
        "need at least 4 bites to observe charges + post-charge baseline: {bite_damages:?}"
    );
    let base_bite = 50.0; // equal-weight melee per-hit = attacker damage
    let charged_count = bite_damages
        .iter()
        .filter(|&&d| (d - (base_bite + DIVINATION_FLAT_DAMAGE)).abs() < 1e-6)
        .count();
    let baseline_count = bite_damages
        .iter()
        .filter(|&&d| (d - base_bite).abs() < 1e-6)
        .count();
    assert_eq!(
        charged_count, DIVINATION_BITE_CHARGES as usize,
        "Divination must arm exactly {DIVINATION_BITE_CHARGES} charged bites (each at base+{DIVINATION_FLAT_DAMAGE}): {bite_damages:?}"
    );
    assert!(
        baseline_count >= 1,
        "at least one post-charge baseline bite must appear (charges exhausted): {bite_damages:?}"
    );
}

#[test]
fn charged_bites_apply_burn_to_target() {
    // [REF:ability_divination]
    // "...applies 2 stacks of Burn to the target." The apply itself emits no
    // combat_log event and the trace does not carry stack counts, so the
    // 2-stack magnitude is welded to the spec prose by the spine and verified
    // by source inspection at composable/mod.rs:4811. The applied Burn is a
    // DoT, so its ticks do surface in the trace: witness that charged bites put
    // Burn on the target by observing Burn_Status DoT ticks.
    let attacker = biting_attacker(50.0, 2.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &divination_attacker_config(),
        12.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let burn_dot_ticks = log
        .iter()
        .filter(|e| e.entry_type == "dot" && e.status_id.as_deref() == Some("Burn_Status"))
        .count();
    assert!(
        burn_dot_ticks >= 2,
        "Divination charged bites must apply Burn (Burn_Status DoT ticks must appear): got {burn_dot_ticks}"
    );
}

#[test]
fn cooldown_one_hundred_twenty_seconds() {
    // [REF:ability_divination]
    let times = divination_activation_times(
        &divination_attacker_config(),
        SimpleAbilityTimingMode::Fast,
        300.0,
        2.0,
    );
    assert!(
        times.len() >= 2,
        "Divination must fire at least twice in a 300 s window: {times:?}"
    );
    let gap = times[1] - times[0];
    assert!(
        (gap - DIVINATION_COOLDOWN_SEC).abs() < 1.0,
        "second Divination activation must be ~{DIVINATION_COOLDOWN_SEC} s after the first, got {gap}: {times:?}"
    );
}

#[test]
fn cannot_rearm_while_charges_unspent() {
    // [REF:ability_divination]
    // The activation gate at composable/mod.rs:2498 requires
    // `divination_charges_left == 0`. With a very slow biter that does
    // not consume any charge during the cooldown window, the engine
    // must not re-arm: only one activation event in 200 s.
    let attacker = biting_attacker(50.0, 1000.0); // no bite within window
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &divination_attacker_config(),
        200.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let activations: Vec<f64> = log
        .iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Divination activated")
        })
        .map(|e| e.time)
        .collect();
    assert_eq!(
        activations.len(),
        1,
        "Divination must not re-arm while charges remain unspent: {activations:?}"
    );
}

#[test]
fn activates_immediately_under_all_policies() {
    // [REF:ability_divination]
    let cfg = divination_attacker_config();
    for mode in [
        SimpleAbilityTimingMode::ReallyFast,
        SimpleAbilityTimingMode::Fast,
        SimpleAbilityTimingMode::SemiIdeal,
        SimpleAbilityTimingMode::Ideal,
        SimpleAbilityTimingMode::Extreme,
    ] {
        let times = divination_activation_times(&cfg, mode, 5.0, 2.0);
        let first = *times
            .first()
            .unwrap_or_else(|| panic!("first activation under {mode:?}: log empty"));
        assert!(
            first.abs() < 1e-6,
            "Divination must activate at t=0 under {mode:?}, got {first}"
        );
    }
}

#[test]
fn the_flat_bonus_survives_the_attackers_own_hunker() {
    // [REF:ability_divination]
    // The game halves a hunkering creature's Damage stat, and Divination's bonus
    // is handed out after that, at the end of the attacker's own chain - so the
    // bite lands at half base plus the whole bonus, not half of their sum.
    let mut attacker = biting_attacker(50.0, 2.0);
    attacker.hunker_reduction_pct = 40.0;
    let defender = passive_combatant(10_000_000.0);
    let mut cfg = divination_attacker_config();
    cfg.attacker_hunker = true;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg, 12.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let bite_damages: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "A")
        .map(|e| e.damage)
        .collect();
    assert!(
        !bite_damages.is_empty(),
        "the attacker has to actually bite for this to say anything"
    );

    let halved_base = 50.0 * 0.5;
    let charged = bite_damages
        .iter()
        .filter(|&&d| (d - (halved_base + DIVINATION_FLAT_DAMAGE)).abs() < 1e-6)
        .count();
    let halved_sum = (halved_base + DIVINATION_FLAT_DAMAGE) * 0.5;
    assert!(
        !bite_damages
            .iter()
            .any(|&d| (d - halved_sum).abs() < 1e-6),
        "no bite may land at half of base-plus-bonus - that is the old order: {bite_damages:?}"
    );
    assert_eq!(
        charged, DIVINATION_BITE_CHARGES as usize,
        "each charged bite must be half the base plus the whole {DIVINATION_FLAT_DAMAGE}: {bite_damages:?}"
    );
}
