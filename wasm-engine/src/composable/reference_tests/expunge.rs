//! Reference: ability_expunge
//!
//! Covers each testable bullet in the "Expunge" entry. Each test body
//! starts with the [REF:ability_expunge] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Both the "× (1 + 0.05 × bleed_stacks)" damage multiplier and the
//! "0.5 × D_normal × 0.05 × bleed_stacks" heal are measured against a
//! control run of the same fight with Expunge off, which fixes D_normal -
//! the landed normal bite (game Expunge.OnAttack p4, the CalculateDamage
//! output before on-attack bonuses).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats};

fn expunge_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_expunge = true;
    cfg
}

fn standard_attacker(damage: f64, bite_cd: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = 1_000.0;
    c.damage = damage;
    c.bite_cooldown = bite_cd;
    c
}

fn expunge_activation_count(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    max_time_sec: f64,
) -> Vec<f64> {
    let result = simulate_composable_matchup_with_trace(
        attacker,
        defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        cfg,
        max_time_sec,
        true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Expunge activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn does_not_fire_without_bleed_on_target() {
    // [REF:ability_expunge]
    // Without Bleed_Status on the defender, expunge_eligible is false;
    // no activation event must appear.
    let attacker = standard_attacker(50.0, 2.0);
    let defender = standard_attacker(0.0, 1000.0);
    let cfg = expunge_attacker_config();
    let activations = expunge_activation_count(&attacker, &defender, &cfg, 10.0);
    assert!(
        activations.is_empty(),
        "Expunge must not fire without Bleed on the target: {activations:?}"
    );
}

#[test]
fn kill_secure_fires_when_bonus_bite_kills_target() {
    // [REF:ability_expunge]
    // Construct a scenario where the normal bite leaves B alive and the
    // Expunge bonus bite (x (1 + 0.05 x bleed_stacks)) brings B's HP to
    // 0 or below. With baseAttack=100, base bite damage approximates 100
    // (weight-symmetric). With 20 Bleed stacks, expunge multiplier =
    // 1 + 0.05 x 20 = 2.0, so the bonus bite deals 200. B's HP sits at
    // exactly 200 -> the normal bite leaves half of it, the bonus bite
    // takes all of it, and the landed damage is not truncated by the
    // remaining-HP clamp, so it can be read off the trace.
    //
    // The control run (Expunge off) is the same fight, so it fixes
    // D_normal: the bonus bite has to be exactly that x 2.0, and the
    // kill has to land on the bite the control run survives.
    let bleed_stacks = 20.0;
    let attacker = standard_attacker(100.0, 2.0);
    let mut defender = default_combatant();
    defender.health = 200.0;
    defender.weight = 100.0;
    defender.damage = 0.0;
    defender.bite_cooldown = 1000.0;
    defender.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: bleed_stacks,
        ..Default::default()
    }];
    let cfg = expunge_attacker_config();
    let activations = expunge_activation_count(&attacker, &defender, &cfg, 1.5);
    assert_eq!(
        activations.len(),
        1,
        "Expunge must fire exactly once, on the bite that secures the kill: {activations:?}"
    );

    let run = |cfg: &ComposableAbilityConfig| {
        simulate_composable_matchup_with_trace(
            &attacker, &defender, None, None,
            SimpleAbilityTimingMode::Fast,
            cfg, 1.5, true,
        )
    };
    let first_bite_damage = |result: &crate::contracts::BestBuildsMatchupSummary| -> f64 {
        result
            .combat_log
            .as_ref()
            .expect("trace log requested")
            .iter()
            .find(|e| e.entry_type == "bite" && e.attacker == "A")
            .expect("attacker must land a bite")
            .damage
    };
    let control = run(&ComposableAbilityConfig::default());
    let expunged = run(&cfg);
    let d_normal = first_bite_damage(&control);
    let bonus = first_bite_damage(&expunged);
    let expected = d_normal * (1.0 + 0.05 * bleed_stacks);
    assert!(
        (bonus - expected).abs() < 1e-6,
        "the Expunge bite must deal D_normal × (1 + 0.05 × {bleed_stacks}) = {expected}, \
         got {bonus} against D_normal={d_normal}"
    );
    assert!(
        control.final_hp_b > 0.0,
        "the scenario only secures a kill if the normal bite leaves B alive: \
         control final_hp_b={}",
        control.final_hp_b
    );
    assert!(
        expunged.final_hp_b <= 0.0,
        "the bonus bite must actually secure the kill: final_hp_b={}",
        expunged.final_hp_b
    );
}

#[test]
fn heals_half_the_bonus_damage_off_the_normal_bite() {
    // [REF:ability_expunge]
    // Bullet 2: "On the same bite, the user is healed for 0.5 × D_normal ×
    // 0.05 × bleed_stacks, using the same two quantities - D_normal is the
    // normal bite's landed damage (weight- and posture-scaled, after
    // mitigation), the same base the bonus damage multiplies, before the
    // Expunge bonus and other on-attack bonuses."
    //
    // The attacker must be missing HP for the heal to be observable, so
    // the defender lands one opening bite and then goes quiet. B survives
    // A's opening bite (bonus 2 x D_normal < 300) and is killed by the
    // second one at t=2, which is the bite Expunge rides.
    let bleed_stacks = 20.0;
    let attacker = standard_attacker(100.0, 2.0);
    let mut defender = default_combatant();
    defender.health = 300.0;
    defender.weight = 100.0;
    defender.damage = 300.0;
    defender.bite_cooldown = 1000.0;
    defender.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: bleed_stacks,
        ..Default::default()
    }];
    let cfg = expunge_attacker_config();
    let run = |cfg: &ComposableAbilityConfig| {
        simulate_composable_matchup_with_trace(
            &attacker, &defender, None, None,
            SimpleAbilityTimingMode::Fast,
            cfg, 2.5, true,
        )
        .combat_log
        .expect("trace log requested")
    };
    let control = run(&ComposableAbilityConfig::default());
    let expunged = run(&cfg);

    let heal = expunged
        .iter()
        .find(|e| e.attacker == "A" && e.description.as_deref() == Some("Expunge heal"))
        .expect("Expunge must log its heal on the bite it rides");
    let d_normal = control
        .iter()
        .find(|e| {
            e.entry_type == "bite" && e.attacker == "A" && (e.time - heal.time).abs() < 1e-9
        })
        .expect("control run must land a bite at the same instant")
        .damage;
    let expected = 0.5 * d_normal * 0.05 * bleed_stacks;
    let healed = heal.healing.unwrap_or(0.0);
    assert!(
        (healed - expected).abs() < 1e-6,
        "Expunge heal must be 0.5 × D_normal ({d_normal}) × 0.05 × {bleed_stacks} = {expected}, \
         got {healed}"
    );
}

#[test]
fn cooldown_forty_five_seconds() {
    // [REF:ability_expunge]
    // Bullet 3: "Cooldown is 45 seconds and starts when the bonus bite
    // lands."
    //
    // Expunge erases the target's Bleed when it fires, so a single
    // kill-secure scenario can never repeat. To get a recurring trigger:
    // the attacker re-seeds Bleed on every bite, and the heal-save branch
    // supplies the trigger instead of kill-secure - the attacker is held
    // just under `projected_incoming + 5% max HP` by a Healing Step drip
    // that roughly balances the defender's chip damage, so the heal-save
    // window is open continuously and only the cooldown paces the fires.
    let mut attacker = standard_attacker(50.0, 1.0);
    attacker.health = 10_000.0;
    attacker.on_hit_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 3.0,
        ..Default::default()
    }];
    let mut defender = default_combatant();
    defender.health = 100_000_000.0;
    defender.damage = 40.0;
    defender.bite_cooldown = 1.0;
    defender.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 99.0,
        ..Default::default()
    }];
    let mut cfg = expunge_attacker_config();
    // Warden's Rage is what gates `compare_start_hp_pct` in setup.rs; it
    // also keeps the attacker's bite - and so the Expunge heal, which
    // scales off it - large enough at 5% HP to sustain the loop.
    cfg.attacker_warden_rage = true;
    cfg.attacker_compare_start_hp_pct = 5.5;
    cfg.attacker_healing_step_value = 0.05;

    let activations = expunge_activation_count(&attacker, &defender, &cfg, 250.0);
    assert!(
        activations.len() >= 3,
        "the heal-save window must stay open long enough for repeated fires \
         (retune the drip if this stops holding): {activations:?}"
    );
    let gaps: Vec<f64> = activations.windows(2).map(|w| w[1] - w[0]).collect();
    for gap in &gaps {
        assert!(
            *gap >= 45.0 - 1e-9,
            "Expunge must not re-fire inside its 45 s cooldown: gaps={gaps:?}"
        );
    }
    let shortest = gaps.iter().cloned().fold(f64::INFINITY, f64::min);
    assert!(
        shortest < 45.0 + attacker.bite_cooldown,
        "the cooldown must free Expunge again at 45 s, not later - the trigger is \
         satisfied continuously here, so the shortest gap should land on the first \
         bite past 45 s: gaps={gaps:?}"
    );
}
