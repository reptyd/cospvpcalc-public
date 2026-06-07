//! Reference: ability_cocoon
//!
//! Covers each testable bullet in the "Cocoon" entry. Each test body
//! starts with the [REF:ability_cocoon] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn cocoon_attacker(max_hp: f64, bite_damage: f64, bite_cd: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = bite_damage;
    c.bite_cooldown = bite_cd;
    c
}

fn cocoon_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_cocoon = true;
    cfg
}

fn cocoon_activation_times(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    policy: SimpleAbilityTimingMode,
    max_time_sec: f64,
) -> (Vec<f64>, Vec<f64>, f64, f64) {
    let result = simulate_composable_matchup_with_trace(
        attacker, defender, None, None, policy, cfg, max_time_sec, true,
    );
    let log = result.combat_log.as_ref().expect("trace log requested");
    let activations: Vec<f64> = log
        .iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Cocoon activated")
        })
        .map(|e| e.time)
        .collect();
    let attacker_bites: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    (activations, attacker_bites, result.final_hp_a, result.final_hp_b)
}

#[test]
fn requires_seventy_percent_hp_to_activate() {
    // [REF:ability_cocoon]
    // Attacker at full HP, defender deals damage to drag attacker's HP
    // down. Cocoon must activate at the first tick where HP / max_hp
    // <= 0.70.
    let attacker = cocoon_attacker(1_000.0, 1.0, 1000.0); // passive: full HP at start
    let mut defender = default_combatant();
    defender.health = 10_000.0;
    defender.damage = 350.0; // one bite drops A from 1000 to 650 → 65% HP, below the 70% gate.
    defender.bite_cooldown = 0.5;
    let cfg = cocoon_attacker_config();
    let (activations, _, _, _) = cocoon_activation_times(
        &attacker, &defender, &cfg, SimpleAbilityTimingMode::Fast, 5.0,
    );
    assert_eq!(
        activations.len(),
        1,
        "Cocoon must activate once after HP drops below 70%: {activations:?}"
    );
    assert!(
        activations[0] > 0.0,
        "activation must not happen at t=0 with full HP: {}",
        activations[0]
    );
}

#[test]
fn does_not_activate_above_seventy_percent_hp() {
    // [REF:ability_cocoon]
    // Defender bites are too weak to drop attacker below 70%. No activation.
    let attacker = cocoon_attacker(10_000.0, 1.0, 1000.0);
    let mut defender = default_combatant();
    defender.health = 10_000.0;
    defender.damage = 100.0; // 10 bites take 1000 HP → 90% HP after 10 bites.
    defender.bite_cooldown = 0.5;
    let cfg = cocoon_attacker_config();
    let (activations, _, _, _) = cocoon_activation_times(
        &attacker, &defender, &cfg, SimpleAbilityTimingMode::Fast, 4.0,
    );
    assert!(
        activations.is_empty(),
        "Cocoon must not activate while HP stays above 70%: {activations:?}"
    );
}

#[test]
fn cooldown_one_hundred_twenty_seconds() {
    // [REF:ability_cocoon]
    // Steady damage drops HP below 70% at t≈1, then Cocoon fires; after
    // Ph2 ends at activation+10 s, attacker is restored to nearly full HP
    // by the +30% lump heal but defender keeps biting it down. Second
    // activation is gated by the 120 s cooldown from the first activation.
    let attacker = cocoon_attacker(1_000.0, 1.0, 1000.0);
    let mut defender = default_combatant();
    defender.health = 1_000_000.0;
    defender.damage = 50.0;
    defender.bite_cooldown = 0.5;
    let cfg = cocoon_attacker_config();
    let (activations, _, _, _) = cocoon_activation_times(
        &attacker, &defender, &cfg, SimpleAbilityTimingMode::Fast, 250.0,
    );
    assert!(
        activations.len() >= 2,
        "Cocoon must fire at least twice in a 250 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - 120.0).abs() < 1.0,
        "second Cocoon activation must be ~120 s after the first, got {gap}: {activations:?}"
    );
}

#[test]
fn phase_two_blocks_attacker_bite_for_five_seconds() {
    // [REF:ability_cocoon]
    // Post-2026-05-12 behavior: Phase 1 is no longer a lock-out. After
    // activation at time T, the user's bite cadence continues normally
    // through P1 [T, T+5) and only the P2 invincibility window
    // [T+5, T+10) suppresses bites. The bite that would have fired
    // inside P2 is rescheduled to P2 end.
    let attacker = cocoon_attacker(1_000.0, 100.0, 1.0);
    let mut defender = default_combatant();
    defender.health = 1_000_000.0;
    defender.damage = 350.0;
    defender.bite_cooldown = 0.5;
    let cfg = cocoon_attacker_config();
    let (activations, attacker_bites, _, _) = cocoon_activation_times(
        &attacker, &defender, &cfg, SimpleAbilityTimingMode::Fast, 15.0,
    );
    let activation_time = *activations
        .first()
        .expect("Cocoon must activate within 15 s");
    // Phase 1 [T, T+5) should contain at least one bite - confirms the
    // wind-up window allows normal play.
    let p1_bites = attacker_bites
        .iter()
        .filter(|&&t| t > activation_time + 1e-9 && t < activation_time + 5.0 - 1e-9)
        .count();
    assert!(
        p1_bites > 0,
        "Phase 1 [{activation_time}, {}) must allow attacker bites (post-2026-05-12 rework): bites={attacker_bites:?}",
        activation_time + 5.0
    );
    // Phase 2 [T+5, T+10) must contain zero bites - invincibility
    // window still blocks them.
    let p2_blocked = attacker_bites
        .iter()
        .filter(|&&t| t > activation_time + 5.0 + 1e-9 && t < activation_time + 10.0 - 1e-9)
        .count();
    assert_eq!(
        p2_blocked,
        0,
        "no attacker bites must land during Ph2 invincibility window [{}, {}): bites={attacker_bites:?}",
        activation_time + 5.0,
        activation_time + 10.0
    );
}

#[test]
fn phase_two_heal_thirty_percent_max_hp_at_end_of_ph2() {
    // [REF:ability_cocoon]
    // Defender damage chosen so A survives Ph1: 25 damage/bite at 0.5 s
    // bite cooldown = 50 dps. At t=6 (300 damage taken) A reaches 70% HP
    // and Cocoon activates. Ph1 ends at t=11 (A at ~450 HP after another
    // 250 damage). Ph2 5 s of invincibility plus the +30% lump heal at
    // Ph2 end (t=16): 450 + 300 = 750. Compare to baseline at t=16: A
    // would be at 1000 − 16 × 50 = 200 HP. Difference > 30% × max_hp.
    let max_hp = 1_000.0;
    let attacker = cocoon_attacker(max_hp, 1.0, 1000.0);
    let mut defender = default_combatant();
    defender.health = 1_000_000.0;
    defender.damage = 25.0;
    defender.bite_cooldown = 0.5;
    let cfg = cocoon_attacker_config();
    let (_, _, hp_with, _) = cocoon_activation_times(
        &attacker, &defender, &cfg, SimpleAbilityTimingMode::Fast, 16.5,
    );
    let no_cocoon = ComposableAbilityConfig::default();
    let (_, _, hp_without, _) = cocoon_activation_times(
        &attacker, &defender, &no_cocoon, SimpleAbilityTimingMode::Fast, 16.5,
    );
    let heal_delta = hp_with - hp_without;
    assert!(
        heal_delta >= max_hp * 0.30 - 1.0,
        "Cocoon must lift A's HP by at least 30% of max HP relative to baseline: \
         hp_with={hp_with}, hp_without={hp_without}, delta={heal_delta}"
    );
}

#[test]
fn phase_three_buff_lifts_bite_damage_by_fifteen_percent() {
    // [REF:ability_cocoon]
    // First post-Ph2 attacker bite carries the +15% damage buff from
    // Cocoon_Damage_Status. Compare with a no-Cocoon baseline at the same
    // simulated bite index: cocooned damage / baseline damage ≈ 1.15.
    let attacker = cocoon_attacker(1_000.0, 100.0, 2.0);
    let mut defender = default_combatant();
    defender.health = 1_000_000.0;
    defender.damage = 350.0;
    defender.bite_cooldown = 0.5;
    let cfg = cocoon_attacker_config();
    let result_with = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &cfg,
        15.0,
        true,
    );
    let log_with = result_with.combat_log.expect("trace log");
    let post_ph2_bite = log_with
        .iter()
        .find(|e| e.entry_type == "bite" && e.attacker == "A" && e.time >= 10.0)
        .expect("attacker must bite after Ph2 ends");
    // Baseline: same setup, no Cocoon. Find a bite at any time (damage is
    // weight-symmetric and the baseline damage value at the same combatant
    // configuration matches what Cocoon would have produced without buff).
    let bare_cfg = ComposableAbilityConfig::default();
    let result_bare = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &bare_cfg,
        15.0,
        true,
    );
    let log_bare = result_bare.combat_log.expect("trace log");
    let bare_bite = log_bare
        .iter()
        .find(|e| e.entry_type == "bite" && e.attacker == "A")
        .expect("baseline attacker must bite");
    let ratio = post_ph2_bite.damage / bare_bite.damage;
    assert!(
        (ratio - 1.15).abs() < 1e-3,
        "Cocoon Ph3 buff must scale bite damage by 1.15x: post-Ph2 bite={}, baseline bite={}, ratio={ratio}",
        post_ph2_bite.damage,
        bare_bite.damage
    );
}

#[test]
fn phase_one_defensive_ailment_lands_on_attacker() {
    // [REF:ability_cocoon]
    // Post-2026-05-12 rework: defensive ailments fire when the user is
    // bitten during Phase 1 (P1 = full normal play, just visually inside
    // the cocoon). Use a creature carrying Defensive Bleed; verify the
    // attacker accrues Bleed_Status stacks for bites that land in P1.
    let mut attacker = cocoon_attacker(1_000.0, 100.0, 1.0);
    attacker.on_hit_taken_statuses =
        vec![super::applied_status("Bleed_Status", 2.0)];
    let mut defender = default_combatant();
    defender.health = 1_000_000.0;
    defender.damage = 350.0;
    defender.bite_cooldown = 0.5;
    let cfg = cocoon_attacker_config();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast, &cfg, 12.0, true,
    );
    let log = result.combat_log.as_ref().expect("trace log");
    let cocoon_t = log
        .iter()
        .find(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Cocoon activated")
        })
        .map(|e| e.time)
        .expect("Cocoon must activate within 12 s");
    let bleed_applied_in_p1 = log.iter().any(|e| {
        e.status_id.as_deref() == Some("Bleed_Status")
            && e.description.as_deref().is_some_and(|d| d.contains("applied"))
            && e.time >= cocoon_t - 1e-9
            && e.time < cocoon_t + 5.0 - 1e-9
    });
    assert!(
        bleed_applied_in_p1,
        "Defensive Bleed must apply during Phase 1 when attacker bites the cocoon-user: cocoon_t={cocoon_t}"
    );
}
