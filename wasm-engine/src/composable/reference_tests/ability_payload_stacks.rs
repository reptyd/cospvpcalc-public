//! How many stacks each ability hands out.
//!
//! The reference test for an ability generally proves that its status turned up
//! on the target. That is the easy half. Halving the stack count, or dropping it
//! to a hundredth, leaves the status present and the ability all but deleted -
//! Cause Fear's window shrinks to a third of a tick, Power Charge stops
//! grounding a flier and the opponent dodges the rest of the fight - and the
//! per-ability tests stay green through all of it.
//!
//! The magnitudes come from the generated spec constants, so the number lives in
//! the entry's own prose and the codegen refuses a quote that is not a verbatim
//! slice of it. A rebalance moves the bullet and the assertion follows.
//!
//! Firing goes through the Sandbox manual path because it is the one trigger
//! that does not depend on cooldowns, HP gates or the opponent's cadence: the
//! ability fires when asked and the stacks can be read straight off the target.

use super::super::sandbox::{SandboxAutomationMode, SandboxRuntime, SandboxSide};
use super::super::config::ComposableAbilityConfig;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{
    CAUSE_FEAR_STACKS, DROWSY_AREA_STACKS, FROST_NOVA_FROSTBITE_STACKS,
    FROST_SNARE_FROSTBITE_STACKS, POISON_AREA_STACKS, THORN_TRAP_BLEED_STACKS,
    THORN_TRAP_FREEZE_STACKS,
};

fn combatant() -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: 10_000.0,
        weight: 100.0,
        damage: 50.0,
        bite_cooldown: 2.0,
        ..Default::default()
    }
}

fn manual_sandbox(configure: impl FnOnce(&mut ComposableAbilityConfig)) -> Box<SandboxRuntime> {
    let mut config = ComposableAbilityConfig::default();
    configure(&mut config);
    SandboxRuntime::new(
        combatant(),
        combatant(),
        None,
        None,
        config,
        SimpleAbilityTimingMode::Ideal,
        SandboxAutomationMode::Manual,
        120.0,
        false,
    )
}

/// Stacks of `status_id` sitting on the opponent after `ability` is used once.
fn stacks_on_opponent(
    ability: &str,
    status_id: &str,
    configure: impl FnOnce(&mut ComposableAbilityConfig),
) -> f64 {
    let mut rt = manual_sandbox(configure);
    assert!(
        rt.force_ability(SandboxSide::A, ability),
        "{ability} must be a name the sandbox recognises - a typo here would pass everything below"
    );
    rt.snapshot_view()
        .side_b
        .statuses
        .iter()
        .find(|s| s.id == status_id)
        .map(|s| s.stacks)
        .unwrap_or(0.0)
}

fn assert_stacks(ability: &str, status_id: &str, expected: f64, got: f64) {
    assert!(
        (got - expected).abs() < 1e-6,
        "{ability} must land {expected} stacks of {status_id}, got {got}"
    );
}

#[test]
fn cause_fear_lands_the_stacks_its_entry_states() {
    // [REF:ability_cause_fear]
    let got = stacks_on_opponent("Cause Fear", "Fear_Status", |c| c.attacker_cause_fear = true);
    assert_stacks("Cause Fear", "Fear_Status", CAUSE_FEAR_STACKS, got);
}

#[test]
fn drowsy_area_lands_the_stacks_its_entry_states() {
    // [REF:ability_drowsy_area]
    let got = stacks_on_opponent("Drowsy Area", "Drowsy_Status", |c| c.attacker_drowsy_area = true);
    assert_stacks("Drowsy Area", "Drowsy_Status", DROWSY_AREA_STACKS, got);
}

#[test]
fn poison_area_lands_the_stacks_its_entry_states() {
    // [REF:compare_poison_area]
    let got = stacks_on_opponent("Poison Area", "Poison_Status", |c| c.attacker_poison_area = true);
    assert_stacks("Poison Area", "Poison_Status", POISON_AREA_STACKS, got);
}

#[test]
fn frost_snare_lands_the_stacks_its_entry_states() {
    // [REF:ability_frost_snare]
    let got = stacks_on_opponent("Frost Snare", "Frostbite_Status", |c| {
        c.attacker_frost_snare = true
    });
    assert_stacks("Frost Snare", "Frostbite_Status", FROST_SNARE_FROSTBITE_STACKS, got);
}

#[test]
fn thorn_trap_lands_both_payloads_its_entry_states() {
    // [REF:ability_thorn_trap]
    // Two statuses on one activation, and the Bleed half held while the Freeze
    // half could be deleted outright - so both are read.
    let bleed = stacks_on_opponent("Thorn Trap", "Bleed_Status", |c| c.attacker_thorn_trap = true);
    let freeze = stacks_on_opponent("Thorn Trap", "Freeze_Status", |c| c.attacker_thorn_trap = true);
    assert_stacks("Thorn Trap", "Bleed_Status", THORN_TRAP_BLEED_STACKS, bleed);
    assert_stacks("Thorn Trap", "Freeze_Status", THORN_TRAP_FREEZE_STACKS, freeze);
}

#[test]
fn frost_nova_lands_the_stacks_its_entry_states_on_each_tick() {
    // [REF:ability_frost_nova]
    // Frost Nova arms a window rather than applying on the spot, so the first
    // tick is what carries the payload.
    let mut rt = manual_sandbox(|c| c.attacker_frost_nova = true);
    assert!(rt.force_ability(SandboxSide::A, "Frost Nova"), "Frost Nova must be recognised");
    rt.step_to_time(3.5);
    let got = rt
        .snapshot_view()
        .side_b
        .statuses
        .iter()
        .find(|s| s.id == "Frostbite_Status")
        .map(|s| s.stacks)
        .unwrap_or(0.0);
    assert_stacks("Frost Nova", "Frostbite_Status", FROST_NOVA_FROSTBITE_STACKS, got);
}

#[test]
fn an_unknown_ability_name_is_refused() {
    // The control for every row above: they all lean on `force_ability`
    // returning true, so a silent false would make each of them assert nothing.
    let mut rt = manual_sandbox(|_| {});
    assert!(!rt.force_ability(SandboxSide::A, "Not An Ability"));
}

// The rest fire off a real event rather than a menu press - a first bite, an HP
// threshold, an opponent's bite - so they run a live matchup and read the
// payload out of the timeline.

use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::spec_constants::{
    BLESSINGS_BOON_HEAL_PCT_MAX_HP, GORE_CHARGE_BLEED_STACKS, GORE_CHARGE_DEEP_WOUNDS_STACKS,
    PLAGUE_TRAIL_DISEASE_STACKS, POWER_CHARGE_SHREDDED_WINGS_STACKS, TOXIC_TRAIL_POISON_STACKS,
    TOXIC_TRAP_POISON_STACKS,
};

fn brawler() -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = 200_000.0;
    c.damage = 100.0;
    c.bite_cooldown = 1.0;
    c
}

/// Stacks sitting on the opponent after `seconds` of an automated fight. Power
/// Charge and Gore Charge apply their payload without writing a status line to
/// the timeline, so they are read off the creature instead.
fn stacks_after_auto_fight(
    configure: impl FnOnce(&mut ComposableAbilityConfig),
    status_id: &str,
    seconds: f64,
) -> f64 {
    let mut config = ComposableAbilityConfig::default();
    configure(&mut config);
    let mut rt = SandboxRuntime::new(
        brawler(),
        brawler(),
        None,
        None,
        config,
        SimpleAbilityTimingMode::ReallyFast,
        SandboxAutomationMode::SemiAuto,
        120.0,
        false,
    );
    rt.step_to_time(seconds);
    rt.snapshot_view()
        .side_b
        .statuses
        .iter()
        .find(|s| s.id == status_id)
        .map(|s| s.stacks)
        .unwrap_or(0.0)
}

/// Stacks the first application of `status_id` put on `hp_side` in a live fight.
fn first_applied_stacks(
    config: ComposableAbilityConfig,
    status_id: &str,
    hp_side: &str,
    horizon: f64,
) -> f64 {
    let attacker = brawler();
    let defender = brawler();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &config, horizon, true,
    );
    let log = result.combat_log.expect("trace");
    let entry = log
        .iter()
        .find(|e| {
            e.status_id.as_deref() == Some(status_id)
                && e.hp_side == hp_side
                && e.description.as_deref().is_some_and(|d| d.contains("applied"))
        })
        .unwrap_or_else(|| panic!("nothing applied {status_id} to {hp_side} within {horizon}s"));
    // "<source> applied <Label> (<N>)" - the count is the only bracketed number.
    let text = entry.description.as_deref().unwrap_or_default();
    let open = text.rfind('(').expect("an apply entry states its stack count");
    let close = text.rfind(')').expect("an apply entry states its stack count");
    text[open + 1..close].parse::<f64>().expect("stack count parses")
}

#[test]
fn power_charge_grounds_with_the_stacks_its_entry_states() {
    // [REF:compare_power_charge]
    // Shredded Wings is what takes a flier out of the air, so a thinner payload
    // leaves the opponent dodging for the rest of the fight.
    let got = stacks_after_auto_fight(|c| c.attacker_power_charge = true, "Shredded_Wings", 1.5);
    assert_stacks("Power Charge", "Shredded_Wings", POWER_CHARGE_SHREDDED_WINGS_STACKS, got);
}

#[test]
fn gore_charge_lands_both_payloads_its_entry_states() {
    // [REF:compare_gore_charge]
    let bleed = stacks_after_auto_fight(|c| c.attacker_gore_charge = true, "Bleed_Status", 1.5);
    let deep = stacks_after_auto_fight(|c| c.attacker_gore_charge = true, "Deep_Wounds_Status", 1.5);
    assert_stacks("Gore Charge", "Bleed_Status", GORE_CHARGE_BLEED_STACKS, bleed);
    assert_stacks("Gore Charge", "Deep_Wounds_Status", GORE_CHARGE_DEEP_WOUNDS_STACKS, deep);
}

#[test]
fn a_trail_tick_lands_the_stacks_its_entry_states() {
    // [REF:ability_plague_trail] [REF:ability_toxic_trail]
    // Both trails share one payload constant in the engine, so a thinned value
    // deletes the DoT on both while the status still shows up in the timeline.
    let mut plague = ComposableAbilityConfig::default();
    plague.attacker_plague_trail_value = 100.0;
    let disease = first_applied_stacks(plague, "Disease_Status", "B", 10.0);
    assert_stacks("Plague Trail", "Disease_Status", PLAGUE_TRAIL_DISEASE_STACKS, disease);

    let mut toxic = ComposableAbilityConfig::default();
    toxic.attacker_toxic_trail_value = 100.0;
    let poison = first_applied_stacks(toxic, "Poison_Status", "B", 10.0);
    assert_stacks("Toxic Trail", "Poison_Status", TOXIC_TRAIL_POISON_STACKS, poison);
}

#[test]
fn a_toxic_trap_tick_lands_the_stacks_its_entry_states() {
    // [REF:ability_toxic_trap]
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_toxic_trap = true;
    let got = first_applied_stacks(cfg, "Poison_Status", "B", 10.0);
    assert_stacks("Toxic Trap", "Poison_Status", TOXIC_TRAP_POISON_STACKS, got);
}

#[test]
fn blessings_boon_restores_the_share_its_entry_states() {
    // [REF:status_blessings_boon]
    // A heal, so it is read as the HP two otherwise identical fights end on.
    // The target has to be losing HP faster than the Boon returns it, or a tick
    // caps against full health and the difference understates the heal.
    let mut biter = default_combatant();
    biter.damage = 500.0;
    biter.bite_cooldown = 1.0;
    biter.health = 10_000_000.0;

    let mut healed = default_combatant();
    healed.health = 10_000.0;
    healed.damage = 0.0;
    healed.bite_cooldown = 1_000.0;
    healed.health_regen = 0.0;
    let mut control = healed.clone();
    // Five stacks outlive the window, so every tick inside it lands.
    healed.starting_statuses = vec![super::applied_status("Blessings_Boon", 5.0)];
    control.starting_statuses = vec![];

    let run = |side: &SimpleCombatantStats| {
        simulate_composable_matchup_with_trace(
            side, &biter, None, None,
            SimpleAbilityTimingMode::ReallyFast,
            &ComposableAbilityConfig::default(), 10.0, true,
        )
        .final_hp_a
    };

    // Ticks land at t = 3, 6 and 9 inside a ten-second window.
    let ticks = 3.0;
    let per_tick = healed.health * BLESSINGS_BOON_HEAL_PCT_MAX_HP / 100.0;
    let gap = run(&healed) - run(&control);
    assert!(
        (gap - ticks * per_tick).abs() < 1e-6,
        "{ticks} Blessing's Boon ticks must return {} HP ({BLESSINGS_BOON_HEAL_PCT_MAX_HP}% of max each), the two fights differ by {gap}",
        ticks * per_tick
    );
}

use crate::spec_constants::{
    FROST_NOVA_DURATION_SEC, POWER_CHARGE_FIRST_HIT_DAMAGE_PCT, TOXIC_TRAP_DURABILITY_BITES,
};

/// Every bite `side` landed, in order.
fn bite_damages(config: &ComposableAbilityConfig, side: &str, horizon: f64) -> Vec<f64> {
    let attacker = brawler();
    let defender = brawler();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        config, horizon, true,
    );
    result
        .combat_log
        .expect("trace")
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == side)
        .map(|e| e.damage)
        .collect()
}

#[test]
fn power_charge_lifts_the_first_hit_by_the_share_its_entry_states() {
    // [REF:compare_power_charge]
    // Only the first hit is lifted, so the second bite is the baseline the
    // first is measured against.
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_power_charge = true;
    let bites = bite_damages(&cfg, "A", 6.0);
    assert!(bites.len() >= 2, "need a second bite as the baseline: {bites:?}");

    let expected = bites[1] * (1.0 + POWER_CHARGE_FIRST_HIT_DAMAGE_PCT / 100.0);
    assert!(
        (bites[0] - expected).abs() < 1e-6,
        "the first bite must be {POWER_CHARGE_FIRST_HIT_DAMAGE_PCT}% above the next one \
         ({expected}), got {}: {bites:?}",
        bites[0]
    );
}

#[test]
fn frost_nova_stops_ticking_when_its_window_closes() {
    // [REF:ability_frost_nova]
    // The window is what the ability is worth; without this the duration could
    // be any number and the payload test above would still pass.
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_frost_nova = true;
    let attacker = brawler();
    let defender = brawler();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg, FROST_NOVA_DURATION_SEC * 2.0, true,
    );
    let applies: Vec<f64> = result
        .combat_log
        .expect("trace")
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some("Frostbite_Status")
                && e.description.as_deref().is_some_and(|d| d.contains("applied"))
        })
        .map(|e| e.time)
        .collect();

    assert!(!applies.is_empty(), "Frost Nova must tick at all");
    let last = applies.iter().cloned().fold(f64::MIN, f64::max);
    assert!(
        last <= FROST_NOVA_DURATION_SEC + 1e-6,
        "no Frost Nova tick may land past its {FROST_NOVA_DURATION_SEC}s window, last was {last}"
    );
}

#[test]
fn a_toxic_trap_breaks_on_the_bite_count_its_entry_states() {
    // [REF:ability_toxic_trap]
    // The durability is the whole cost of the trap. Left unasserted it can be
    // any number, and the Poison it ticks looks identical either way.
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_toxic_trap = true;

    let mut owner = brawler();
    owner.damage = 0.0;
    owner.bite_cooldown = 1_000.0;
    let mut biter = brawler();
    biter.damage = 1.0;
    biter.bite_cooldown = 1.0;

    // Long enough for the opponent to spend every charge and then some.
    let horizon = TOXIC_TRAP_DURABILITY_BITES * 2.0;
    let result = simulate_composable_matchup_with_trace(
        &owner, &biter, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg, horizon, true,
    );
    let log = result.combat_log.expect("trace");
    // Applications, not ticks: the Poison the trap already laid keeps ticking
    // long after the trap itself is spent.
    let last_poison = log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some("Poison_Status")
                && e.hp_side == "B"
                && e.description.as_deref().is_some_and(|d| d.contains("applied"))
        })
        .map(|e| e.time)
        .fold(f64::MIN, f64::max);
    let bites_by_then = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "B" && e.time <= last_poison)
        .count() as f64;

    assert!(
        bites_by_then <= TOXIC_TRAP_DURABILITY_BITES + 1.0,
        "the trap must be spent by {TOXIC_TRAP_DURABILITY_BITES} opponent bites, but it was still \
         ticking after {bites_by_then}"
    );
    assert!(
        bites_by_then >= TOXIC_TRAP_DURABILITY_BITES - 1.0,
        "the trap must survive close to {TOXIC_TRAP_DURABILITY_BITES} opponent bites, it stopped \
         after {bites_by_then}"
    );
}
