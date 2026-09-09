//! Reference: compare_oxygen_moisture
//!
//! Covers the Compare-only global Oxygen / Moisture drain mode. Each test
//! body starts with the [REF:compare_oxygen_moisture] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine paths:
//! - Mode field: `config.oxygen_moisture_mode` ("ground" / "underwater").
//! - Per-side pools: `SimpleCombatantStats.moisture_time` / `.oxygen_time`,
//!   seeded into `CombatSide.{moisture,oxygen}_remaining` in setup.rs.
//! - Per-second tick: `process_phase_4_oxygen_moisture_tick` (phase4.rs)
//!   drains 1/sec then applies 5% maxHP/sec once depleted -
//!   `oxygen_moisture::tick` floors moisture at 50% maxHP (never lethal) and
//!   leaves oxygen unfloored (drowning kills via the normal Phase-16 path).
//! - Scheduler: `oxy_moist_next_tick_at` folded with `cocoon_aware_schedule`
//!   (forward-advance / stop-not-crawl).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

/// A non-biting punching bag with a configurable pool. `moisture`/`oxygen`
/// seconds-to-depletion are set per stat; everything else inert so the only
/// HP movement is the drain damage under test.
fn passive_combatant(max_hp: f64, moisture: f64, oxygen: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.health_regen = 0.0;
    c.damage = 0.0;
    c.bite_cooldown = 100_000.0;
    c.moisture_time = moisture;
    c.oxygen_time = oxygen;
    c
}

fn ground_config() -> ComposableAbilityConfig {
    ComposableAbilityConfig {
        oxygen_moisture_mode: Some("ground".to_string()),
        ..Default::default()
    }
}

fn underwater_config() -> ComposableAbilityConfig {
    ComposableAbilityConfig {
        oxygen_moisture_mode: Some("underwater".to_string()),
        ..Default::default()
    }
}

fn run(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    duration: f64,
) -> crate::contracts::BestBuildsMatchupSummary {
    simulate_composable_matchup_with_trace(
        attacker,
        defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        cfg,
        duration,
        false,
    )
}

#[test]
fn ground_drains_then_floors_at_half_max_hp_and_never_kills() {
    // [REF:compare_oxygen_moisture]
    // Ground: a creature with moistureTime = N takes no damage for N
    // seconds, then loses 5% maxHP/sec, clamped at 50% maxHP - drying never
    // kills. Both sides share the mode; A has a short pool, B is immune
    // (moistureTime = 0) so it is untouched and acts as the floor reference.
    let max_hp = 10_000.0;
    let a = passive_combatant(max_hp, 5.0, 0.0); // 5 s of moisture
    let b = passive_combatant(max_hp, 0.0, 0.0); // immune on ground

    // No damage before depletion: at t=4 (pool still > 0) HP is untouched.
    let early = run(&a, &b, &ground_config(), 4.0);
    assert!(
        (early.final_hp_a - max_hp).abs() < 1e-6,
        "no moisture damage before the pool depletes: hp_a={}",
        early.final_hp_a
    );

    // Long run: HP drops by 5%/sec after depletion but never below 50% maxHP,
    // and the side never dies.
    let late = run(&a, &b, &ground_config(), 300.0);
    assert!(
        (late.final_hp_a - 0.5 * max_hp).abs() < 1e-6,
        "moisture damage must floor at 50% maxHP ({}): hp_a={}",
        0.5 * max_hp,
        late.final_hp_a
    );
    assert!(
        late.death_time_a.is_none(),
        "drying out must never kill: death_time_a={:?}",
        late.death_time_a
    );

    // The immune side (moistureTime = 0) is untouched in ground mode.
    assert!(
        (late.final_hp_b - max_hp).abs() < 1e-6,
        "a side with moistureTime=0 is immune on ground: hp_b={}",
        late.final_hp_b
    );
    assert!(late.death_time_b.is_none(), "immune side must not die");
}

#[test]
fn underwater_drowns_after_pool_depletes_and_can_kill() {
    // [REF:compare_oxygen_moisture]
    // Underwater: a creature with oxygenTime = N drowns after N seconds -
    // 5% maxHP/sec with NO floor, so it can die. 5% of maxHP over 20 ticks =
    // 100% maxHP, so a depleted side reaches 0 and the normal death path
    // fires.
    let max_hp = 1_000.0;
    let a = passive_combatant(max_hp, 0.0, 3.0); // 3 s of oxygen, then drowns
    let b = passive_combatant(max_hp, 0.0, 0.0); // immune underwater

    let result = run(&a, &b, &underwater_config(), 120.0);
    assert!(
        result.death_time_a.is_some(),
        "drowning must be lethal once oxygen depletes: death_time_a={:?}",
        result.death_time_a
    );
    // Death lands after the pool (3 s) drains plus 20 lethal ticks (1/sec):
    // first damage at t~4, hp hits 0 around t~23.
    let death = result.death_time_a.unwrap();
    assert!(
        (3.0..=30.0).contains(&death),
        "death should land a few seconds after the 3 s pool: got {death}"
    );
    // The immune opponent (oxygenTime = 0) survives.
    assert!(
        result.death_time_b.is_none() && (result.final_hp_b - max_hp).abs() < 1e-6,
        "a side with oxygenTime=0 is immune underwater: hp_b={} death_b={:?}",
        result.final_hp_b,
        result.death_time_b
    );
}

#[test]
fn wrong_mode_stat_is_immune() {
    // [REF:compare_oxygen_moisture]
    // The active mode reads only its own stat: a creature with oxygenTime>0
    // but moistureTime=0 is immune on GROUND (and vice-versa). Here both
    // sides carry oxygen but no moisture, so ground mode touches neither.
    let max_hp = 10_000.0;
    let a = passive_combatant(max_hp, 0.0, 5.0);
    let b = passive_combatant(max_hp, 0.0, 5.0);

    let result = run(&a, &b, &ground_config(), 120.0);
    assert!(
        (result.final_hp_a - max_hp).abs() < 1e-6
            && (result.final_hp_b - max_hp).abs() < 1e-6,
        "oxygen-only creatures are immune on ground: hp_a={} hp_b={}",
        result.final_hp_a,
        result.final_hp_b
    );
}

#[test]
fn mode_off_is_byte_identical_to_absent() {
    // [REF:compare_oxygen_moisture]
    // Mode off / absent must be inert: a matchup with pools set but the mode
    // unset (or "off") must match the default config exactly - same final HP,
    // no drain. Proves the off-path is byte-identical.
    let max_hp = 10_000.0;
    let a = passive_combatant(max_hp, 5.0, 5.0);
    let b = passive_combatant(max_hp, 5.0, 5.0);

    let default_cfg = run(&a, &b, &ComposableAbilityConfig::default(), 120.0);
    let off_cfg = run(
        &a,
        &b,
        &ComposableAbilityConfig {
            oxygen_moisture_mode: Some("off".to_string()),
            ..Default::default()
        },
        120.0,
    );

    assert_eq!(
        default_cfg.final_hp_a, off_cfg.final_hp_a,
        "mode=off must equal absent (hp_a)"
    );
    assert_eq!(
        default_cfg.final_hp_b, off_cfg.final_hp_b,
        "mode=off must equal absent (hp_b)"
    );
    // And nothing drained: both sides keep full HP under the inert config.
    assert!(
        (default_cfg.final_hp_a - max_hp).abs() < 1e-6
            && (default_cfg.final_hp_b - max_hp).abs() < 1e-6,
        "inert config must not drain HP: hp_a={} hp_b={}",
        default_cfg.final_hp_a,
        default_cfg.final_hp_b
    );

    // A mode-ON matchup MUST lose HP that the mode-off one doesn't - proving
    // the mode + per-side stats actually reach the engine.
    let on_cfg = run(&a, &b, &ground_config(), 120.0);
    assert!(
        on_cfg.final_hp_a < default_cfg.final_hp_a - 1.0,
        "ground mode must drain HP the off path keeps: on={} off={}",
        on_cfg.final_hp_a,
        default_cfg.final_hp_a
    );
}

#[test]
fn drain_pauses_once_the_side_is_dead() {
    // [REF:compare_oxygen_moisture]
    // Once a side dies (underwater/lethal), its drain stops - the corpse is
    // pinned by the normal death path and the tick parks itself (no crawl to
    // the iteration cap). A long run past the death must still terminate and
    // report the death cleanly. A is a glass cannon that kills B by biting;
    // B's oxygen would otherwise keep draining its corpse.
    let max_hp = 1_000.0;
    let mut killer = passive_combatant(max_hp, 0.0, 0.0); // immune, just bites
    killer.damage = 5_000.0; // one-shots B
    killer.bite_cooldown = 1.0;
    let victim = passive_combatant(max_hp, 0.0, 2.0); // would drown if alive

    let result = run(&killer, &victim, &underwater_config(), 300.0);
    assert!(
        result.death_time_b.is_some(),
        "victim must die (to the bite, before drowning matters): death_b={:?}",
        result.death_time_b
    );
    // The fight resolved without crawling: A (immune) keeps full HP and the
    // run did not hang on a stale corpse-drain timer.
    assert!(
        (result.final_hp_a - max_hp).abs() < 1e-6,
        "killer is immune and untouched: hp_a={}",
        result.final_hp_a
    );
}
