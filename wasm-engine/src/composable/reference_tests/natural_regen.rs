//! How a natural regeneration tick is sized.
//!
//! Two dozen entries say something moves regeneration by a percentage, and none
//! of them says what the tick itself is - so "+25% regen" cannot be turned into
//! HP by reading the Reference. It is
//!
//!     max HP x health regen % / 100, every 15 seconds, first tick at t = 15
//!
//! multiplied by every modifier that applies. The modifiers compound rather than
//! adding up, which is the half worth pinning: Muddy and Clean Water together
//! are 1.25 x 1.20, not 1 + 0.25 + 0.20, and nothing else in the suite reads the
//! difference.

use super::super::config::ComposableAbilityConfig;
use super::super::posture::Posture;
use super::super::sandbox::{SandboxAutomationMode, SandboxRuntime, SandboxSide};
use super::super::simulate_composable_matchup_with_trace;
use super::applied_status;
use crate::contracts::{SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats};

const MAX_HP: f64 = 10_000.0;
const REGEN_PCT: f64 = 5.0;
/// `MAX_HP * REGEN_PCT / 100` - what one unmodified tick restores.
const BASE_TICK: f64 = 500.0;
const TICK_SEC: f64 = crate::spec_constants::NATURAL_REGEN_INTERVAL_SEC;

/// A creature that only ever gains HP from regen, and loses it fast enough that
/// a tick never caps against full health.
fn healer(statuses: Vec<SimpleAppliedStatus>) -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: MAX_HP,
        weight: 100.0,
        damage: 0.0,
        bite_cooldown: 1_000.0,
        health_regen: REGEN_PCT,
        starting_statuses: statuses,
        ..Default::default()
    }
}

fn biter() -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: 1_000_000.0,
        weight: 100.0,
        damage: 400.0,
        bite_cooldown: 1.0,
        health_regen: 0.0,
        ..Default::default()
    }
}

/// Every natural-regen heal the wounded side received, with its time.
fn regen_heals(defender: SimpleCombatantStats, horizon: f64) -> Vec<(f64, f64)> {
    let result = simulate_composable_matchup_with_trace(
        &biter(), &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(), horizon, true,
    );
    result
        .combat_log
        .expect("trace")
        .iter()
        .filter(|e| e.hp_side == "B" && e.description.as_deref() == Some("Natural regen"))
        .filter_map(|e| e.healing.map(|h| (e.time, h)))
        .collect()
}

#[test]
fn a_tick_restores_the_share_of_max_hp_the_stat_names() {
    // [REF:status_natural_regeneration] [REF:approx_buffered_natural_regeneration]
    let heals = regen_heals(healer(vec![]), 50.0);
    assert!(heals.len() >= 3, "need several ticks to read the cadence: {heals:?}");
    for (i, (time, healed)) in heals.iter().enumerate() {
        let expected_time = TICK_SEC * (i + 1) as f64;
        assert!(
            (time - expected_time).abs() < 1e-6,
            "tick {i} must land at {expected_time}s, got {time}: {heals:?}"
        );
        assert!(
            (healed - BASE_TICK).abs() < 1e-6,
            "each tick restores {BASE_TICK} ({REGEN_PCT}% of {MAX_HP}), got {healed}"
        );
    }
}

#[test]
fn two_regen_buffs_compound_rather_than_adding_up() {
    // [REF:status_natural_regeneration] [REF:status_muddy] [REF:status_clean_water]
    // Muddy is +25% and Clean Water +20%. Chained they are 1.5x, so a tick is
    // 750; summed they would be 1.45x and 725. Every stat modifier in the game
    // is applied to the value the one before it produced, and this is
    // the only place in the suite where the two readings differ.
    let one = regen_heals(healer(vec![applied_status("Muddy_Status", 1.0)]), 20.0);
    let both = regen_heals(
        healer(vec![
            applied_status("Muddy_Status", 1.0),
            applied_status("Clean_Water_Status", 1.0),
        ]),
        20.0,
    );
    let muddy_only = one.first().expect("a tick under Muddy").1;
    let with_water = both.first().expect("a tick under both").1;

    assert!(
        (muddy_only - BASE_TICK * 1.25).abs() < 1e-6,
        "Muddy alone must lift the tick to {}, got {muddy_only}",
        BASE_TICK * 1.25
    );
    assert!(
        (with_water - BASE_TICK * 1.25 * 1.20).abs() < 1e-6,
        "Muddy and Clean Water must compound to {}, got {with_water} (summing them gives {})",
        BASE_TICK * 1.25 * 1.20,
        BASE_TICK * 1.45
    );
}

#[test]
fn a_full_block_holds_the_tick_and_releases_one_of_them() {
    // [REF:approx_buffered_natural_regeneration] [REF:status_bleed]
    // Bleed drives the multiplier to zero. Eight stacks shed one every three
    // seconds, so the block lifts at 24s - and the held tick arrives after the
    // release delay rather than at the next 15s boundary.
    let heals = regen_heals(healer(vec![applied_status("Bleed_Status", 8.0)]), 70.0);
    let (first_time, first_heal) = *heals.first().expect("regen must resume once Bleed lapses");

    assert!(
        first_time > 24.0,
        "nothing may regenerate while Bleed still holds the multiplier at zero: {heals:?}"
    );
    assert!(
        first_time < TICK_SEC * 2.0,
        "the held tick must arrive on the block lifting, not wait for the next boundary: {heals:?}"
    );
    assert!(
        (first_heal - BASE_TICK).abs() < 1e-6,
        "the released tick is an ordinary one, got {first_heal}"
    );
    // "At most one tick buffers, no matter how long the block lasts" - the two
    // ticks blocked at 15 and (had it not been held) 30 must not both arrive.
    let released_early = heals.iter().filter(|(t, _)| *t < 26.0).count();
    assert_eq!(released_early, 1, "only one tick may buffer: {heals:?}");
}

#[test]
fn sitting_and_laying_multiply_the_tick() {
    // [REF:compare_posture_policy]
    // The posture multiplier is applied at the tick itself, on top of whatever
    // the statuses already did.
    for (posture, factor) in [
        (Posture::Standing, 1.0),
        (Posture::Sitting, 1.5),
        (Posture::Laying, 2.0),
    ] {
        let mut rt = SandboxRuntime::new(
            biter(),
            healer(vec![]),
            None,
            None,
            ComposableAbilityConfig::default(),
            SimpleAbilityTimingMode::ReallyFast,
            SandboxAutomationMode::SemiAuto,
            60.0,
            true,
        );
        rt.force_posture(SandboxSide::B, posture);
        rt.step_to_time(40.0);
        let heals: Vec<f64> = rt
            .snapshot_view()
            .log
            .iter()
            .filter(|e| e.side == "B" && e.description == "Natural regen")
            .filter_map(|e| e.healing)
            .collect();

        assert!(!heals.is_empty(), "{posture:?} must still regenerate");
        for healed in &heals {
            assert!(
                (healed - BASE_TICK * factor).abs() < 1e-6,
                "{posture:?} must scale the tick by {factor} to {}, got {healed}",
                BASE_TICK * factor
            );
        }
    }
}

#[test]
fn a_creature_at_full_hp_does_not_tick_and_a_tick_never_overshoots() {
    // [REF:status_natural_regeneration]
    use std::collections::BTreeMap;
    let stats = healer(vec![]);
    let statuses: BTreeMap<String, crate::contracts::SimpleStatusInstance> = BTreeMap::new();

    let mut hp = MAX_HP;
    let mut next_regen_at = TICK_SEC;
    crate::combat::handle_simple_regen_with_statuses(
        TICK_SEC, &stats, &mut hp, &mut next_regen_at, &statuses,
    );
    assert!((hp - MAX_HP).abs() < 1e-9, "a full-HP creature must not heal, got {hp}");

    // Thirty short of full, with a tick worth BASE_TICK: it heals thirty.
    let mut hp = MAX_HP - 30.0;
    let mut next_regen_at = TICK_SEC;
    crate::combat::handle_simple_regen_with_statuses(
        TICK_SEC, &stats, &mut hp, &mut next_regen_at, &statuses,
    );
    assert!(
        (hp - MAX_HP).abs() < 1e-9,
        "a {BASE_TICK}-point tick must stop at full rather than overshoot, got {hp}"
    );
}

#[test]
fn a_zero_regen_stat_never_ticks() {
    // [REF:status_natural_regeneration]
    let mut stats = healer(vec![]);
    stats.health_regen = 0.0;
    let heals = regen_heals(stats, 60.0);
    assert!(heals.is_empty(), "no regen stat means no tick at all: {heals:?}");
}
