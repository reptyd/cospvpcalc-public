//! Reference: ability_self_destruct
//!
//! Covers each testable bullet in the "Self-Destruct" entry. Each
//! test body starts with the [REF:ability_self_destruct] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine path: `actives::update_simple_self_destruct_state` +
//! `actives::trigger_self_destruct_explosion` driven from
//! `composable/mod.rs:4573-4619` per tick. Profile defined via
//! `SimpleCombatantStats::self_destruct_profile`. Trace events:
//! "Self-Destruct armed activated" on arming, "Self-Destruct activated"
//! on detonation.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_combatant};
use crate::contracts::{
    SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats, SimpleSelfDestructProfile,
};
use crate::spec_constants::{
    SELF_DESTRUCT_CAP_PCT, SELF_DESTRUCT_COOLDOWN_SEC, SELF_DESTRUCT_DAMAGE_PCT_MAX_HP,
};

fn standard_self_destruct_profile() -> SimpleSelfDestructProfile {
    SimpleSelfDestructProfile {
        trigger_hp_ratio_lte: 0.15,
        damage_pct: 10.0,
        self_hp_floor_pct: SELF_DESTRUCT_CAP_PCT,
        apply_statuses: vec![SimpleAppliedStatus {
            status_id: "Burn_Status".to_string(),
            stacks: 10.0,
            ..Default::default()
        }],
        cooldown_sec: 300.0,
        arming_stacks: 3.0,
    }
}

fn self_destructor(max_hp: f64, starting_burn_for_pre_wound: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c.self_destruct_profile = Some(standard_self_destruct_profile());
    if starting_burn_for_pre_wound > 0.0 {
        c.starting_statuses = vec![applied_status("Burn_Status", starting_burn_for_pre_wound)];
    }
    c
}

#[test]
fn arms_at_or_below_fifteen_percent_max_hp() {
    // [REF:ability_self_destruct]
    // Bullet 1: "Self-Destruct is armed automatically while the user's
    // HP is at or below 15%."
    // No arm allowed at full HP; arm only after defender pressure (or
    // pre-loaded DoT) drops attacker under the 15% gate. Setup uses
    // heavy defender pressure so the gate flips quickly.
    let mut a = default_combatant();
    a.health = 1_000.0;
    a.damage = 0.0;
    a.bite_cooldown = 1000.0;
    a.self_destruct_profile = Some(standard_self_destruct_profile());
    let mut b = default_combatant();
    b.health = 10_000_000.0;
    b.damage = 200.0;
    b.bite_cooldown = 0.5;

    // Sim only 0.4 s - defender bites at t=0 land 200 dmg -> A=800
    // (=80%), still well above the 15% gate. No arm allowed.
    let early = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        0.4, true,
    );
    let early_log = early.combat_log.expect("trace");
    let armed_in_early = early_log
        .iter()
        .any(|e| e.description.as_deref() == Some("Self-Destruct armed activated"));
    assert!(
        !armed_in_early,
        "no arm allowed while attacker HP > 15% maxHP"
    );

    // Sim 5 s - defender bites every 0.5 s for 200 dmg, so by ~t=2.5
    // attacker HP has dropped under 15% (250 HP). Arm event fires.
    let late = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        5.0, true,
    );
    let late_log = late.combat_log.expect("trace");
    let armed_in_late = late_log
        .iter()
        .any(|e| e.description.as_deref() == Some("Self-Destruct armed activated"));
    assert!(
        armed_in_late,
        "arm event must fire once attacker HP drops to or below 15% maxHP"
    );
}

#[test]
fn nine_second_fuse_three_stacks_one_per_three_seconds() {
    // [REF:ability_self_destruct]
    // Bullets 2 + 3 + 4 + 5: arming applies 3 stacks of the
    // Self_Destruct_Arming_Status, stacks decay 1 per 3 seconds
    // regardless of facetank, explosion fires when stacks reach zero.
    // Expected timing: arm at t=0 -> explosion at t~9.0.
    //
    // Pre-wound the attacker so arming fires on the first tick. With
    // pre-loaded Burn 14 stacks the attacker drops under 15% well
    // before the first defender bite event would fire (Burn DoT runs
    // throughout the sim).
    let mut a = default_combatant();
    a.health = 1_000.0;
    a.damage = 0.0;
    a.bite_cooldown = 1000.0;
    a.self_destruct_profile = Some(standard_self_destruct_profile());
    a.starting_statuses = vec![applied_status("Bleed_Status", 14.0)];
    let mut b = default_combatant();
    b.health = 10_000_000.0;
    b.damage = 200.0;
    b.bite_cooldown = 0.5;

    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        20.0, true,
    );
    let log = result.combat_log.expect("trace");
    let arm_time = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Self-Destruct armed activated"))
        .map(|e| e.time)
        .expect("arm event must fire in pressure setup");
    let explosion_time = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Self-Destruct activated"))
        .map(|e| e.time)
        .expect("explosion must fire after the 9 s fuse");
    let fuse_sec = explosion_time - arm_time;
    assert!(
        (fuse_sec - 9.0).abs() < 0.5,
        "Self-Destruct fuse must be ~9 seconds (3 stacks × 3 s/stack): arm={arm_time}, explosion={explosion_time}, fuse={fuse_sec}"
    );
}

#[test]
fn explosion_deals_ten_percent_target_max_hp_and_applies_ten_burn() {
    // [REF:ability_self_destruct]
    // Bullets 7 + 8: "The explosion deals 10% of the target's max HP as direct
    // damage." + "It also applies 10 stacks of Burn on explosion." Direct call
    // to `trigger_self_destruct_explosion` isolates the explosion's
    // instantaneous effect from subsequent Burn DoT ticks (which would inflate
    // the integration-style assertion).
    use crate::actives::trigger_self_destruct_explosion;
    use std::collections::BTreeMap;

    let attacker = {
        let mut c = default_combatant();
        c.health = 1_000.0;
        c
    };
    let defender = {
        let mut c = default_combatant();
        c.health = 10_000_000.0;
        c
    };
    let profile = standard_self_destruct_profile();

    let mut attacker_hp = 100.0; // post-fuse low HP
    let mut defender_hp = defender.health;
    let mut attacker_statuses: BTreeMap<String, _> = BTreeMap::new();
    // Pre-load arming status so the explosion path can clear it.
    attacker_statuses.insert(
        "Self_Destruct_Arming_Status".to_string(),
        crate::contracts::SimpleStatusInstance {
            stacks: 0.0,
            next_decay_at: None,
            next_tick_at: None,
            remaining_sec: 0.0,
            stack_value_mode: None,
            lich_mark_owned_stacks: None,
            no_decay: false,
            resolved_scalars: None,
        },
    );
    let mut defender_statuses: BTreeMap<String, _> = BTreeMap::new();
    let mut cooldown_until = 0.0;
    let mut armed = true;

    trigger_self_destruct_explosion(
        100.0,
        &attacker,
        &defender,
        &profile,
        &mut attacker_hp,
        &mut defender_hp,
        &mut attacker_statuses,
        &mut defender_statuses,
        &mut cooldown_until,
        &mut armed,
    );
    // Damage = 10% of defender maxHP.
    let damage_dealt = defender.health - defender_hp;
    let expected = defender.health * SELF_DESTRUCT_DAMAGE_PCT_MAX_HP / 100.0;
    assert!(
        (damage_dealt - expected).abs() < 1e-6,
        "explosion must deal exactly {SELF_DESTRUCT_DAMAGE_PCT_MAX_HP}% of defender maxHP: expected {expected}, got {damage_dealt}"
    );
    // Burn x 10 stacks applied to defender.
    let burn_stacks = defender_statuses
        .get("Burn_Status")
        .map(|s| s.stacks)
        .unwrap_or(0.0);
    assert!(
        (burn_stacks - 10.0).abs() < 1e-6,
        "explosion must apply exactly 10 Burn stacks to defender: got {burn_stacks}"
    );
}

#[test]
fn self_hp_capped_to_floor_after_explosion_when_higher() {
    // [REF:ability_self_destruct]
    // Bullet 9: "If the user's HP is above 15%, it is capped down to 15% of
    // max HP after the explosion." Direct unit test on the explosion: an
    // attacker above the 15% floor at detonation (e.g. it healed above the arm
    // gate during the fuse) is capped straight back down to exactly 15% maxHP.
    use crate::actives::trigger_self_destruct_explosion;
    use std::collections::BTreeMap;

    let attacker = {
        let mut c = default_combatant();
        c.health = 1_000.0;
        c
    };
    let defender = {
        let mut c = default_combatant();
        c.health = 10_000_000.0;
        c
    };
    let profile = standard_self_destruct_profile();

    let mut attacker_hp = attacker.health * 0.40; // 40%, above the 15% floor
    let mut defender_hp = defender.health;
    let mut attacker_statuses: BTreeMap<String, _> = BTreeMap::new();
    let mut defender_statuses: BTreeMap<String, _> = BTreeMap::new();
    let mut cooldown_until = 0.0;
    let mut armed = true;

    trigger_self_destruct_explosion(
        9.0, &attacker, &defender, &profile,
        &mut attacker_hp, &mut defender_hp,
        &mut attacker_statuses, &mut defender_statuses,
        &mut cooldown_until, &mut armed,
    );

    let cap_fraction = attacker_hp / attacker.health;
    assert!(
        (cap_fraction - SELF_DESTRUCT_CAP_PCT / 100.0).abs() < 1e-6,
        "HP above the floor must be capped down to exactly {SELF_DESTRUCT_CAP_PCT}% maxHP: got {cap_fraction}"
    );
}

#[test]
fn self_hp_below_floor_left_alone_after_explosion() {
    // [REF:ability_self_destruct]
    // Bullet 10: "If the user's HP is already at or below 15%, it is left
    // alone (no heal)." Direct unit test: an attacker already below the 15%
    // floor keeps its HP on explosion - the cap only lowers, never raises.
    use crate::actives::trigger_self_destruct_explosion;
    use std::collections::BTreeMap;

    let attacker = {
        let mut c = default_combatant();
        c.health = 1_000.0;
        c
    };
    let defender = {
        let mut c = default_combatant();
        c.health = 10_000_000.0;
        c
    };
    let profile = standard_self_destruct_profile();

    let start_hp = attacker.health * 0.03; // 3%, below the 15% floor
    let mut attacker_hp = start_hp;
    let mut defender_hp = defender.health;
    let mut attacker_statuses: BTreeMap<String, _> = BTreeMap::new();
    let mut defender_statuses: BTreeMap<String, _> = BTreeMap::new();
    let mut cooldown_until = 0.0;
    let mut armed = true;

    trigger_self_destruct_explosion(
        9.0, &attacker, &defender, &profile,
        &mut attacker_hp, &mut defender_hp,
        &mut attacker_statuses, &mut defender_statuses,
        &mut cooldown_until, &mut armed,
    );

    assert!(
        (attacker_hp - start_hp).abs() < 1e-6,
        "HP already below the floor must be left untouched: got {attacker_hp}, expected {start_hp}"
    );
}

#[test]
fn cooldown_three_hundred_seconds_after_explosion() {
    // [REF:ability_self_destruct]
    // Bullet 12: "Self-Destruct has a 300 second cooldown after each
    // explosion." Direct unit test on `update_simple_self_destruct_state`:
    // arm, explode, then verify second arm is blocked while time <
    // explosion_time + 300, and unblocked once the cooldown elapses.
    use crate::actives::{update_simple_self_destruct_state, SelfDestructEvent};
    use std::collections::BTreeMap;

    let attacker = {
        let mut c = default_combatant();
        c.health = 1_000.0;
        c
    };
    let defender = {
        let mut c = default_combatant();
        c.health = 10_000_000.0;
        c
    };
    let profile = standard_self_destruct_profile();

    let mut attacker_hp = attacker.health * 0.10; // under the 15% gate
    let mut defender_hp = defender.health;
    let mut attacker_statuses: BTreeMap<String, _> = BTreeMap::new();
    let mut defender_statuses: BTreeMap<String, _> = BTreeMap::new();
    let mut cooldown_until = 0.0;
    let mut armed = false;

    // First arm at t=0 (HP under gate).
    let event = update_simple_self_destruct_state(
        0.0, &attacker, &defender, &profile,
        &mut attacker_hp, &mut defender_hp,
        &mut attacker_statuses, &mut defender_statuses,
        &mut cooldown_until, &mut armed,
    );
    assert!(matches!(event, SelfDestructEvent::Armed));
    assert!(armed);

    // Manually clear arming stacks to simulate fuse expiry.
    attacker_statuses.insert(
        "Self_Destruct_Arming_Status".to_string(),
        crate::contracts::SimpleStatusInstance {
            stacks: 0.0, next_decay_at: None, next_tick_at: None,
            remaining_sec: 0.0, stack_value_mode: None, lich_mark_owned_stacks: None,
            no_decay: false, resolved_scalars: None,
        },
    );

    // Explode at t=9 (fuse end).
    let event = update_simple_self_destruct_state(
        9.0, &attacker, &defender, &profile,
        &mut attacker_hp, &mut defender_hp,
        &mut attacker_statuses, &mut defender_statuses,
        &mut cooldown_until, &mut armed,
    );
    assert!(matches!(event, SelfDestructEvent::Exploded));
    assert!(!armed);
    // Cooldown set to t=9 + 300 = 309.
    assert!(
        (cooldown_until - (9.0 + SELF_DESTRUCT_COOLDOWN_SEC)).abs() < 1e-6,
        "cooldown_until must equal explosion_time + {SELF_DESTRUCT_COOLDOWN_SEC}: got {cooldown_until}"
    );

    // Mid-cooldown: t=200 (HP still under gate). Must NOT re-arm.
    attacker_hp = attacker.health * 0.10; // still under the 15% gate
    let event = update_simple_self_destruct_state(
        200.0, &attacker, &defender, &profile,
        &mut attacker_hp, &mut defender_hp,
        &mut attacker_statuses, &mut defender_statuses,
        &mut cooldown_until, &mut armed,
    );
    assert!(matches!(event, SelfDestructEvent::None),
        "no re-arm allowed during the 300 s cooldown window");
    assert!(!armed);

    // Just before cooldown ends: t=308.99. Still blocked.
    let event = update_simple_self_destruct_state(
        308.99, &attacker, &defender, &profile,
        &mut attacker_hp, &mut defender_hp,
        &mut attacker_statuses, &mut defender_statuses,
        &mut cooldown_until, &mut armed,
    );
    assert!(matches!(event, SelfDestructEvent::None),
        "no re-arm allowed at t=308.99 (cooldown ends at 309)");

    // Cooldown ended: t=309.01 with HP under gate. Re-arm allowed.
    let event = update_simple_self_destruct_state(
        309.01, &attacker, &defender, &profile,
        &mut attacker_hp, &mut defender_hp,
        &mut attacker_statuses, &mut defender_statuses,
        &mut cooldown_until, &mut armed,
    );
    assert!(matches!(event, SelfDestructEvent::Armed),
        "re-arm must fire once cooldown elapses (t=309.01) if HP is still under gate");
}

#[test]
fn fires_on_death_while_armed() {
    // [REF:ability_self_destruct]
    // Bullet 11: "If the user dies while armed, the explosion fires at the
    // moment of death." Setup: arm at low HP, then heavy defender pressure
    // kills attacker before the 9 s fuse completes naturally. Explosion event
    // must still fire.
    let mut a = default_combatant();
    a.health = 1_000.0;
    a.damage = 0.0;
    a.bite_cooldown = 1000.0;
    a.self_destruct_profile = Some(standard_self_destruct_profile());
    a.starting_statuses = vec![applied_status("Bleed_Status", 14.0)]; // pre-wound to under 15%
    let mut b = default_combatant();
    b.health = 10_000_000.0;
    b.damage = 5_000.0; // one-shot kill on next bite
    b.bite_cooldown = 0.5;

    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        15.0, true,
    );
    let log = result.combat_log.expect("trace");
    let arm = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Self-Destruct armed activated"));
    let explosion = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Self-Destruct activated"));
    assert!(
        arm.is_some(),
        "arm event must fire under pre-wound + pressure setup"
    );
    assert!(
        explosion.is_some(),
        "explosion must fire even when attacker dies during the fuse"
    );
    // Sanity: attacker is dead at sim end (death_time set).
    assert!(
        result.death_time_a.is_some(),
        "attacker must have died (verifying the death-path explosion test)"
    );
}
