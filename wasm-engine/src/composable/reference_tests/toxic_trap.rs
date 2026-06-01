//! Reference: ability_toxic_trap
//!
//! Covers each testable bullet in the "Toxic Trap" entry. Each test
//! body starts with the [REF:ability_toxic_trap] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: activation in `composable/mod.rs:2421-2445` (Phase 4b)
//! sets `toxic_trap_bites_remaining = 25`, `toxic_trap_next_tick_at =
//! Some(time + 3.0)`, `toxic_trap_cooldown_until = time + 75.0`.
//! Tick at `mod.rs:2447-2454` applies Poison × 5 to defender every
//! 3 s while bites_remaining > 0. Durability decrement at
//! `mod.rs:4954-4956` (Phase 10 — A bites B → B's trap loses 1
//! charge), mirrored at `mod.rs:5302-` (Phase 11 — B bites A →
//! A's trap loses 1 charge). The owner's own bites do not consume
//! their own trap.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn melee_combatant(max_hp: f64, damage: f64, bite_cd: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = damage;
    c.bite_cooldown = bite_cd;
    c
}

fn attacker_toxic_trap_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_toxic_trap = true;
    cfg
}

fn poison_dot_count(log: &[crate::contracts::CombatLogEntry], side_being_dot_ticked: &str) -> usize {
    log.iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Poison_Status")
                && e.hp_side == side_being_dot_ticked
        })
        .count()
}

#[test]
fn first_poison_tick_at_three_seconds_after_activation() {
    // [REF:ability_toxic_trap]
    // Bullets 1 + 3: "Toxic Trap is activated on cooldown. When
    // activated, a trap is placed." + "The first Poison tick occurs
    // 3 seconds after activation."
    // Activation at t=0; first tick at t=3 applying Poison × 5 to
    // defender. Poison DoT cadence is 3 s, so first DoT visible event
    // appears at the t=3 apply or shortly after.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000_000.0);

    let pre_first = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &attacker_toxic_trap_cfg(),
        2.99, true,
    );
    let pre_log = pre_first.combat_log.expect("trace");
    let pre_poison_dots = poison_dot_count(&pre_log, "B");
    assert_eq!(
        pre_poison_dots, 0,
        "no Poison DoT allowed before t=3 (first apply happens at t=3)"
    );

    // Trap apply event at t=3 doesn't push to trace; it lands a Poison
    // stack on the defender, and Poison_Status DoT cadence is 3 s.
    // First DoT tick therefore lands at t=6 (3 s after the first apply
    // at t=3). Use t=7 to capture the first DoT event.
    let post_first = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &attacker_toxic_trap_cfg(),
        7.0, true,
    );
    let post_log = post_first.combat_log.expect("trace");
    let post_poison_dots = poison_dot_count(&post_log, "B");
    assert!(
        post_poison_dots >= 1,
        "first Poison DoT must fire after the t=3 first apply: got {post_poison_dots}"
    );
}

#[test]
fn applies_five_stacks_of_poison_every_three_seconds() {
    // [REF:ability_toxic_trap]
    // Bullet 2: "While the trap is active, the opponent receives 5
    // stacks of Poison every 3 seconds."
    // Multiple Poison DoT ticks accumulate as the trap re-applies +5
    // stacks every 3 s. Verify via DoT tick count over a 30 s window
    // (30/3 = 10 trap apply events at t=3, 6, ..., 30).
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &attacker_toxic_trap_cfg(),
        30.5, true,
    );
    let log = result.combat_log.expect("trace");
    let poison_dots = poison_dot_count(&log, "B");
    assert!(
        poison_dots >= 8,
        "Toxic Trap must drive sustained Poison DoT (≥8 events in 30 s window): got {poison_dots}"
    );
}

#[test]
fn opponent_bites_consume_trap_durability_owner_bites_do_not() {
    // [REF:ability_toxic_trap]
    // Bullet 4: "Each bite by the opponent on the user consumes one
    // of the trap's 25 durability charges. The owner's own bites do
    // not affect the trap."
    //
    // Setup: attacker holds Toxic Trap, attacker bites defender (A's
    // bite on B). Engine `mod.rs:4954` decrement applies to
    // `b.toxic_trap_bites_remaining` (defender's trap), NOT
    // `a.toxic_trap_bites_remaining`. Since defender has no trap
    // here, the decrement is a no-op. Attacker's trap durability
    // stays at 25.
    //
    // To prove "owner's bites don't affect trap", we let attacker bite
    // many times and verify Poison DoT continues for the full 75 s
    // cooldown window — the trap never breaks early.
    let attacker = melee_combatant(1_000_000.0, 50.0, 0.5);
    let defender = passive_combatant(10_000_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &attacker_toxic_trap_cfg(),
        70.0, true,
    );
    let log = result.combat_log.expect("trace");
    // Attacker bit defender 140 times (70 / 0.5). If owner's bites
    // affected own trap, durability would have run out at bite 25
    // (~12.5 s). Trap then would stop at bite 25 → no more Poison
    // applies → DoT eventually decays. We expect Poison DoT ticks
    // continuing throughout — many events.
    let poison_dots = poison_dot_count(&log, "B");
    assert!(
        poison_dots >= 18,
        "owner's bites must NOT consume own trap durability: got only {poison_dots} Poison DoT events"
    );
}

#[test]
fn trap_breaks_immediately_when_durability_reaches_zero() {
    // [REF:ability_toxic_trap]
    // Bullets 5 + 6: "When all 25 charges are consumed, the trap
    // breaks immediately and Poison ticks stop." + "The trap's
    // durability is always exactly 25 opponent bites and is not
    // reduced faster by damage multipliers."
    // Setup: attacker holds Toxic Trap, defender bites attacker for
    // 25 bites — drains trap. After the 25th bite, no more Poison
    // applies fire from the trap (Poison DoT events from earlier
    // accumulated stacks may continue but no fresh apply lands).
    //
    // Hard to assert "no fresh apply" directly (apply doesn't push
    // to trace). Indirect: total Poison DoT damage to defender
    // over a long enough window stops growing once trap is depleted.
    //
    // Cleaner direct test: defender bites attacker at 0.5 s cadence
    // → 25 bites consume trap durability by t=12.5. After that, only
    // residual Poison DoT remains, which decays. Total Poison apply
    // events = 4 (at t=3, 6, 9, 12 — only 4 occur within first 12.5 s
    // before durability exhausts). Without durability gate, trap
    // would continue applying every 3 s through 75 s window — far
    // more apply events.
    //
    // Apply events do NOT push to trace; verify via Poison DoT
    // count: depleted trap → ~4 applies → ~10-15 DoT ticks total.
    // Active trap (no biting) → ~25 applies → ~75 DoT ticks total.
    let attacker = passive_combatant(1_000_000.0);
    let mut defender = passive_combatant(10_000_000_000.0);
    defender.damage = 1.0;
    defender.bite_cooldown = 0.5;

    let depleted = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &attacker_toxic_trap_cfg(),
        70.0, true,
    );
    let depleted_log = depleted.combat_log.expect("trace");
    let depleted_dots = poison_dot_count(&depleted_log, "B");

    // Compare to control: same setup but defender doesn't bite —
    // trap stays full for whole 70 s window.
    let no_pressure_defender = passive_combatant(10_000_000_000.0);
    let active = simulate_composable_matchup_with_trace(
        &attacker, &no_pressure_defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &attacker_toxic_trap_cfg(),
        70.0, true,
    );
    let active_log = active.combat_log.expect("trace");
    let active_dots = poison_dot_count(&active_log, "B");

    // Active trap should produce strictly more Poison DoT events
    // than depleted trap.
    assert!(
        active_dots > depleted_dots,
        "depleted trap must produce fewer Poison DoT events than active trap: \
         depleted={depleted_dots}, active={active_dots}"
    );
}

#[test]
fn cooldown_seventy_five_seconds_counted_from_activation() {
    // [REF:ability_toxic_trap]
    // Bullet 7: "Toxic Trap has a 75 second cooldown, counted from
    // the activation moment."
    // Engine: re-arm gate is `cooldown_until elapsed AND
    // bites_remaining == 0`. The current trap must be drained before
    // the next can arm. Use a defender that bites attacker at 0.5 s
    // cadence → 25 bites consume durability by t=12.5 (well before
    // the 75 s cooldown lapses). Second activation must then land at
    // exactly t=75.
    let attacker = passive_combatant(1_000_000.0);
    let mut defender = passive_combatant(10_000_000_000.0);
    defender.damage = 1.0;
    defender.bite_cooldown = 0.5;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &attacker_toxic_trap_cfg(),
        90.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activations: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Toxic Trap activated"))
        .map(|e| e.time)
        .collect();
    assert!(
        activations.len() >= 2,
        "Toxic Trap must fire at least twice in a 90 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - 75.0).abs() < 1.0,
        "second Toxic Trap activation must land ~75 s after the first: gap={gap}, times={activations:?}"
    );
}
