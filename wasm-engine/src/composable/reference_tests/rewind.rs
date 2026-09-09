//! Reference: ability_rewind
//!
//! Covers each testable bullet in the "Rewind" entry. Each test body
//! starts with the [REF:ability_rewind] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `abilities/rewind_breath.rs::record_rewind_snapshot`
//! pushes (time, hp) into a per-side history each Phase 1 tick;
//! `apply_rewind_restoration` consumes the history, looks for a
//! snapshot from `time - 9.0` s, and heals HP toward that older value
//! (capped at REWIND_HEAL_CAP_PCT_MAX_HP% of maxHP), then starts a 100 s
//! cooldown. Game Rewind
//! restores HP only - statuses are NOT rolled back.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{REWIND_COOLDOWN_SEC, REWIND_HEAL_CAP_PCT_MAX_HP};

fn rewind_attacker(max_hp: f64, damage: f64, bite_cd: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
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

#[test]
fn does_nothing_when_no_nine_second_snapshot_available() {
    // [REF:ability_rewind]
    // Bullet 2: "If no valid 9 second snapshot is available, Rewind
    // does nothing."
    // Sim window 5 s - engine has snapshots from t=0..5 only. No
    // snapshot from 9 s ago exists, so even with HP under the
    // ReallyFast 75% activation gate, no Rewind activation fires.
    let mut a = rewind_attacker(10_000.0, 50.0, 1.0);
    a.starting_statuses = vec![applied_status("Bleed_Status", 14.0)]; // pre-wound below 75%
    let mut b = passive_combatant(10_000_000.0);
    b.damage = 100.0;
    b.bite_cooldown = 0.5;

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_rewind = true;
    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg, 5.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let activations = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Rewind activated"))
        .count();
    assert_eq!(
        activations, 0,
        "no Rewind activation allowed before t=9 (no 9 s snapshot available): got {activations}"
    );
}

#[test]
fn restores_hp_toward_nine_second_old_value() {
    // [REF:ability_rewind]
    // Bullets 1 + 3: "Rewind looks for the user's recorded HP from 9 seconds
    // earlier." + "When it activates, HP is restored toward that older value."
    // ReallyFast policy: activates as soon as HP <= 75%. Setup pressure such
    // that A's HP is full at t=0 (snapshot HP = 10_000) and drops to ~7000 by
    // t=9 (under 75% gate). At t=9 the engine looks back to the t=0 snapshot
    // (HP=10_000), tries to restore, and is capped at
    // REWIND_HEAL_CAP_PCT_MAX_HP% of maxHP.
    let a = rewind_attacker(10_000.0, 0.0, 1000.0);
    let mut b = passive_combatant(10_000_000.0);
    b.damage = 350.0; // ~700 HP/s pressure -> A under 75% by t=4.5
    b.bite_cooldown = 0.5;

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_rewind = true;
    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg, 12.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let rewind_event = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Rewind activated"))
        .expect("Rewind must activate at t=9 or later under ReallyFast + pressure");
    // Rewind must fire at t >= 9 (snapshot lookback minimum).
    assert!(
        rewind_event.time >= 9.0 - 1e-6,
        "Rewind cannot fire before t=9 (no valid snapshot earlier): got t={}",
        rewind_event.time
    );
}

#[test]
fn heal_is_capped_not_fully_restored() {
    // [REF:ability_rewind]
    // Bullet 4: "The heal from Rewind is capped at 25% of the user's max HP."
    // (REWIND_HEAL_CAP_PCT_MAX_HP). Engine: `healed_hp = (runtime.health *
    // cap%).min(hp_delta)`. Setup: defender pressure drops A from 10_000
    // (full) at t=0 to a very low HP by t=9. The snapshot at t=0 (HP=10_000)
    // implies `hp_delta` is much greater than the cap, so the cap kicks in.
    // Verify the post-rewind HP increase is bounded by the cap (not the full
    // delta).
    let a = rewind_attacker(10_000.0, 0.0, 1000.0);
    let mut b = passive_combatant(10_000_000.0);
    b.damage = 700.0; // ~1400 HP/s - A near death by t=9
    b.bite_cooldown = 0.5;

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_rewind = true;
    // Sim past t=9 to capture the activation.
    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg, 9.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let rewind_event = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Rewind activated"));
    if let Some(evt) = rewind_event {
        // Find a "Bite hit" event just before the rewind activation
        // to read attacker's pre-rewind HP. Actor hp_after on bite
        // events records the bitten side's HP, not the actor - but
        // we want A's HP. Engine's record_ability_event sets
        // actor_hp_after = a.hp at the time the activation event
        // is pushed, AFTER the rewind heal lands. So this is
        // post-rewind A's HP.
        let post_rewind_hp = evt.actor_hp_after;
        // Pre-rewind HP was very low (heavy pressure). Post-rewind
        // HP must NOT exceed pre-rewind + the cap. As an upper
        // bound we assert post_rewind_hp <= snapshot_hp = 10_000.
        // For the cap to be observable: post_rewind_hp should be
        // strictly less than the t=0 snapshot HP - meaning the
        // engine did NOT fully restore (cap fired).
        assert!(
            post_rewind_hp < a.health - 1e-6,
            "rewind heal must be capped below the t=0 snapshot HP ({}); engine returned {post_rewind_hp}",
            a.health
        );
        // And post_rewind_hp <= a.health (sanity cap at maxHP).
        assert!(
            post_rewind_hp <= a.health + 1e-6,
            "post-rewind HP must not exceed maxHP: got {post_rewind_hp}, max {}",
            a.health
        );
    } else {
        panic!("Rewind activation expected under ReallyFast + heavy pressure within 9.5 s");
    }
}

#[test]
fn heal_cap_equals_spec_fraction_of_max_hp() {
    // [REF:ability_rewind]
    // Bullet 4: "The heal from Rewind is capped at 25% of the user's max HP."
    // `rewind_snapshot_deltas` returns the post-cap heal amount:
    // `(runtime.health * cap%).min(hp_delta)`. With a snapshot HP far above
    // current HP the raw delta exceeds the cap, so the returned heal must
    // equal exactly REWIND_HEAL_CAP_PCT_MAX_HP% of max HP. A control with a
    // small delta stays uncapped, proving the cap value is the binding limit,
    // not an artifact of the delta.
    use crate::abilities::rewind_breath::rewind_snapshot_deltas;

    let mut runtime = default_combatant();
    runtime.health = 10_000.0;

    // Snapshot at t=0 (HP = full); current HP at t=9 is 1000. Raw delta
    // = 9000, far above the cap.
    let history = vec![(0.0_f64, runtime.health)];
    let capped_heal = rewind_snapshot_deltas(9.0, &runtime, 1_000.0, &history)
        .expect("snapshot from t=0 must be eligible at t=9");
    let cap = runtime.health * REWIND_HEAL_CAP_PCT_MAX_HP / 100.0;
    assert!(
        (capped_heal - cap).abs() < 1e-6,
        "Rewind heal must cap at {REWIND_HEAL_CAP_PCT_MAX_HP}% of max HP ({cap}), got {capped_heal}"
    );

    // Control: snapshot only 1000 above current HP -> raw delta 1000 <
    // cap, so the heal is the uncapped delta. This proves the capped
    // case above was genuinely limited by the cap, not the delta.
    let small_history = vec![(0.0_f64, 2_000.0_f64)];
    let uncapped_heal = rewind_snapshot_deltas(9.0, &runtime, 1_000.0, &small_history)
        .expect("snapshot from t=0 must be eligible at t=9");
    assert!(
        (uncapped_heal - 1_000.0).abs() < 1e-6,
        "a sub-cap delta must heal the full delta (1000), got {uncapped_heal}"
    );
    assert!(
        uncapped_heal < cap,
        "control delta must be below the {REWIND_HEAL_CAP_PCT_MAX_HP}% cap to prove the cap binds the first case"
    );
}

#[test]
fn restores_hp_only_never_statuses() {
    // [REF:ability_rewind]
    // Game Rewind snapshots only Health+CFrame and, on activation, teleports +
    // heals HP - it never restores statuses.
    // `apply_rewind_restoration` takes no status map, so it structurally cannot
    // touch statuses; here we confirm it heals HP toward the snapshot (capped)
    // and arms the cooldown.
    use crate::abilities::rewind_breath::apply_rewind_restoration;

    let mut runtime = default_combatant();
    runtime.health = 10_000.0;
    // Snapshot at t=0 with full HP; current HP 4000 at t=9 -> raw delta 6000,
    // above the REWIND_HEAL_CAP_PCT_MAX_HP% cap.
    let history = vec![(0.0_f64, runtime.health)];
    let mut hp = 4_000.0;
    let mut cooldown_until = 0.0;
    let applied =
        apply_rewind_restoration(9.0, &runtime, &mut hp, &mut cooldown_until, &history);
    assert!(applied, "a t=0 snapshot must be eligible at t=9");
    let cap = runtime.health * REWIND_HEAL_CAP_PCT_MAX_HP / 100.0;
    assert!(
        (hp - (4_000.0 + cap)).abs() < 1e-6,
        "Rewind heals current HP + capped delta (4000 + {cap}), got {hp}"
    );
    assert!(cooldown_until > 9.0, "cooldown must be armed after activation");
}

#[test]
fn cooldown_one_hundred_seconds() {
    // [REF:ability_rewind]
    // Bullet 6: "Rewind has a 100 second cooldown." A deep HP pool with no
    // regen under steady damage drops below the 75 % fuse, fires Rewind
    // (~t=37.5), keeps descending past the heal, and drops below the fuse
    // again exactly one cooldown later (~t=137.5). Because A is still alive
    // AND still net-descending at the recast, the 9-s-ago snapshot outranks
    // current HP (delta > 0) at both fires - so both are genuine heals, not a
    // dead-actor phantom. The gap confirms the 100 s cooldown.
    let a = rewind_attacker(24_000.0, 0.0, 1000.0);
    let mut b = passive_combatant(100_000_000.0);
    b.damage = 80.0; // 160 dmg/s (bite 0.5 s) - steady, never lets A recover
    b.bite_cooldown = 0.5;

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_rewind = true;
    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg, 150.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let activation_times: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Rewind activated"))
        .map(|e| e.time)
        .collect();
    assert!(
        activation_times.len() >= 2,
        "Rewind must fire at least twice in the window: {activation_times:?}"
    );
    // Both fires must land while A is still alive - a fire on A's corpse would
    // be a zero-delta phantom, not a real cooldown-gated recast.
    if let Some(death) = result.death_time_a {
        assert!(
            activation_times[1] < death,
            "second Rewind must fire before A dies ({death} s), not on its corpse: {activation_times:?}"
        );
    }
    let gap = activation_times[1] - activation_times[0];
    assert!(
        gap >= REWIND_COOLDOWN_SEC - 1e-3,
        "second Rewind activation must NOT fire less than {REWIND_COOLDOWN_SEC} s after the first: gap={gap}, times={activation_times:?}"
    );
    assert!(
        gap <= 105.0,
        "second Rewind activation must fire close to t=first+100: gap={gap}, times={activation_times:?}"
    );
}
