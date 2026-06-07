//! Per-phase isolation tests.
//!
//! The 24 extracted `process_phase_*` fns are
//! tested end-to-end by `composable/tests.rs` and the per-ability
//! `reference_tests/`. This file adds *isolation* tests that exercise
//! one phase fn at a time with a hand-built `PhaseContext` - fast
//! to add, fast to run, surgical when one phase regresses. The
//! existing end-to-end suite catches behavioural regressions across
//! the whole engine; these tests catch *which phase* broke.
//!
//! Pattern:
//!   1. `simple_stats` + `default_config` give minimal valid state.
//!   2. `make_test_context` wires a `PhaseContext` from owned locals.
//!      Lifetimes line up because `attacker/defender/config` outlive
//!      the borrow of `a/b/combat_log` inside the context.
//!   3. Each `#[test]` constructs state, calls one `process_phase_*`,
//!      asserts the observable state change.
//!
//! Adding a new phase test takes ~30 lines: stats + config flags +
//! one assertion block. The helpers below are deliberately minimal -
//! a fuller fixture builder lives in `tests.rs` for end-to-end runs.

use super::*;
use std::collections::BTreeMap;

fn simple_stats(health: f64) -> SimpleCombatantStats {
    SimpleCombatantStats {
        health,
        weight: 100.0,
        damage: 10.0,
        bite_cooldown: 2.0,
        damage2: 0.0,
        health_regen: 0.0,
        active_cooldown_multiplier: 1.0,
        quick_recovery_hp_ratio_threshold: 0.0,
        unbreakable_damage_cap_pct: 0.0,
        damage_taken_multiplier_on_being_bitten: 1.0,
        breath_resistance: 0.0,
        berserk_bite_cooldown_multiplier: 1.0,
        berserk_hp_ratio_threshold: 0.0,
        first_strike_pct: 0.0,
        first_strike_hp_ratio_threshold: 1.0,
        has_warden_resistance: false,
        has_reflect: false,
        immune_status_ids: vec![],
        hunker_reduction_pct: 0.0,
        self_destruct_profile: None,
        on_hit_statuses: vec![],
        on_hit_taken_statuses: vec![],
        starting_statuses: vec![],
        status_resist_fractions: BTreeMap::new(),
        plushie_status_block_fractions: BTreeMap::new(),
        plushie_reflect_avg_pct: 0.0,
        disabled_abilities: vec![],
        compare_air_rule_cooldown_sec: 0.0,
        user_ability_ids: Vec::new(),
        identity: None,
    }
}

// ── Phase 2 (pre-step: dead-side HP pin + appetite drain) ──────────

#[test]
fn phase_2_pins_dead_side_hp_to_one() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);

    // Mark a as dead with HP at 50 (any non-1.0 value).
    a.hp = 50.0;
    a.death_time = Some(3.0);

    let mut ctx = PhaseContext {
        time: 5.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_2_pre_step(&mut ctx);

    assert_eq!(a.hp, 1.0, "dead-side HP must be pinned to 1.0");
    assert_eq!(b.hp, 1000.0, "alive side untouched");
}

#[test]
fn phase_2_leaves_alive_side_hp_alone() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    a.hp = 537.5;
    b.hp = 412.0;

    let mut ctx = PhaseContext {
        time: 1.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_2_pre_step(&mut ctx);

    assert_eq!(a.hp, 537.5);
    assert_eq!(b.hp, 412.0);
}

// ── Phase 5+6 (regen) ──────────────────────────────────────────────

#[test]
fn phase_5_6_regen_advances_hp_on_tick() {
    let mut attacker = simple_stats(1000.0);
    attacker.health_regen = 4.0; // 4% maxHP per 15s = 40 HP per tick
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    a.hp = 500.0;
    // CombatSide::new sets next_regen to 15.0; we set time to 15.0
    // so the tick fires exactly once.
    let mut regen_healed_a = 0.0;
    let mut regen_healed_b = 0.0;
    let mut regen_ticks_a = 0u32;
    let mut regen_ticks_b = 0u32;

    let mut ctx = PhaseContext {
        time: 15.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_5_6_regen(
        &mut ctx,
        &mut regen_healed_a,
        &mut regen_healed_b,
        &mut regen_ticks_a,
        &mut regen_ticks_b,
    );

    assert_eq!(regen_ticks_a, 1, "exactly one tick fires at t=15");
    assert!(a.hp > 500.0, "HP should have advanced from regen");
    assert!((a.hp - 540.0).abs() < 1e-6, "expected 500 + 40 = 540, got {}", a.hp);
    assert!((regen_healed_a - 40.0).abs() < 1e-6, "healed counter should track");
    assert_eq!(regen_ticks_b, 0, "defender has no regen, no tick");
}

#[test]
fn phase_5_6_regen_caps_at_max_hp() {
    let mut attacker = simple_stats(1000.0);
    attacker.health_regen = 50.0; // huge regen - would overshoot
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    a.hp = 999.0; // near max - regen of 500 would overshoot
    let mut regen_healed_a = 0.0;
    let mut regen_healed_b = 0.0;
    let mut regen_ticks_a = 0u32;
    let mut regen_ticks_b = 0u32;

    let mut ctx = PhaseContext {
        time: 15.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_5_6_regen(
        &mut ctx,
        &mut regen_healed_a,
        &mut regen_healed_b,
        &mut regen_ticks_a,
        &mut regen_ticks_b,
    );

    assert_eq!(a.hp, 1000.0, "HP must be capped at max");
    assert!((regen_healed_a - 1.0).abs() < 1e-6, "only 1 HP of healing fits");
}

fn default_scheduler_flags() -> SchedulerPassiveFlags {
    SchedulerPassiveFlags {
        has_any_thorn_trap: false,
        has_any_toxic_trap: false,
        has_any_frost_snare: false,
        has_any_poison_area: false,
        has_any_yolk_bomb: false,
        has_any_divination: false,
        has_any_aura: false,
        has_any_healing_step: false,
        has_any_healing_pulse: false,
        has_any_damage_trail: false,
        has_any_active_ability: false,
        has_any_fortify: false,
    }
}

// ── Phase 1 Scheduler ─────────────────────────────────────────────

#[test]
fn phase_1_scheduler_break_when_all_events_infinite() {
    // No abilities, no breath, no regen → every scheduled event is
    // f64::INFINITY → `next_time.is_finite() == false` → Break.
    let mut attacker = simple_stats(1000.0);
    attacker.health_regen = 0.0; // ensures next_regen → f64::INFINITY
    let mut defender = simple_stats(1000.0);
    defender.health_regen = 0.0;
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    // Force all scheduled events to infinity by emulating "everything
    // already past max time" - set every Optional/finite scheduler
    // input to INFINITY.
    a.next_hit = f64::INFINITY;
    b.next_hit = f64::INFINITY;
    a.next_breath = f64::INFINITY;
    b.next_breath = f64::INFINITY;
    a.next_regen = f64::INFINITY;
    b.next_regen = f64::INFINITY;
    let event_phase_order: Vec<OrderedEventPhase> = vec![];
    let fortify_control = FortifySimulationControl::default();
    let flags = default_scheduler_flags();
    let mut time = 5.0;
    let mut same_time_processed_phases = 0u32;

    let step = process_phase_1_scheduler(
        &mut a,
        &mut b,
        &attacker,
        &defender,
        &config,
        &mut combat_log,
        false,
        &mut time,
        &mut same_time_processed_phases,
        &event_phase_order,
        300.0,
        &fortify_control,
        &flags,
        false,
    );

    assert!(matches!(step, SchedulerStep::Break), "expected Break, got something else");
}

#[test]
fn phase_1_scheduler_break_when_time_exceeds_max() {
    // next_time advance pushes `time` past max_time_sec → Break.
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    a.next_hit = 500.0; // very far future - will become next_time
    b.next_hit = f64::INFINITY;
    a.next_breath = f64::INFINITY;
    b.next_breath = f64::INFINITY;
    a.next_regen = f64::INFINITY;
    b.next_regen = f64::INFINITY;
    let event_phase_order: Vec<OrderedEventPhase> = vec![];
    let fortify_control = FortifySimulationControl::default();
    let flags = default_scheduler_flags();
    let mut time = 5.0;
    let mut same_time_processed_phases = 0u32;

    let step = process_phase_1_scheduler(
        &mut a,
        &mut b,
        &attacker,
        &defender,
        &config,
        &mut combat_log,
        false,
        &mut time,
        &mut same_time_processed_phases,
        &event_phase_order,
        100.0, // max_time_sec - well below next_hit at 500
        &fortify_control,
        &flags,
        false,
    );

    assert!(matches!(step, SchedulerStep::Break), "exceeding max_time_sec must Break");
    // time was advanced before the Break check; that's the spec.
    assert!(time > 100.0, "time advanced past max ({} > 100)", time);
}

fn simple_breath_profile(dps_pct: f64) -> SimpleBreathProfile {
    SimpleBreathProfile {
        dps_pct,
        capacity: 10.0,
        regen_rate: 5.0,
        crit_chance_pct: 0.0,
        chain: 0.0,
        chain_max_stacks: 0.0,
        special_kind: None,
        special_statuses: vec![],
        self_heal_pct: 0.0,
        cleanse_stacks: 0.0,
        lance_charge_sec: 0.0,
        lance_damage_pct: 0.0,
        lance_cooldown_sec: 0.0,
        lance_status_id: None,
        auto_fire_delay_sec: 0.0,
        auto_fire_cooldown_sec: 0.0,
        charges_max: 0.0,
        charge_regen_sec: 0.0,
    }
}

/// Build a fresh ctx + scaffold for "all-defaults, no abilities" tests.
/// Most gate-off tests use exactly this shape - collapse the boilerplate.
macro_rules! default_ctx_scaffold {
    ($attacker:ident, $defender:ident, $config:ident, $a:ident, $b:ident, $combat_log:ident, $time:expr) => {
        let $attacker = simple_stats(1000.0);
        let $defender = simple_stats(1000.0);
        let $config = ComposableAbilityConfig::default();
        let mut $combat_log = Vec::new();
        #[allow(unused_mut)]
        let mut $a = CombatSide::new(&$attacker, None);
        #[allow(unused_mut)]
        let mut $b = CombatSide::new(&$defender, None);
        // Marker comment so `$time` use is visible in macro caller.
        let _ = $time;
    };
}

// ── Phase 16 Post-tick housekeeping ────────────────────────────────

#[test]
fn phase_16_pins_dead_side_hp_to_one_post_tick() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    let mut counters = DamageCounters::default();
    let mut hp_a_at_b_death = None;
    let mut hp_b_at_a_death = None;
    let snapshot_a_dots = std::collections::BTreeSet::new();
    let snapshot_b_dots = std::collections::BTreeSet::new();
    // Side B is at zero HP this iteration - Phase 16 must commit
    // death, set death_time, pin HP to 1.0, and record hp_a_at_b_death.
    b.hp = 0.0;

    let mut ctx = PhaseContext {
        time: 7.5,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_16_post_tick(
        &mut ctx,
        &mut counters,
        &mut hp_a_at_b_death,
        &mut hp_b_at_a_death,
        &snapshot_a_dots,
        &snapshot_b_dots,
        false, // track_damage_triggers - off, skip the trigger surface
        false, // track_status_hooks - off, no dynamic user statuses here
        attacker.health, // attacker_base_health (unused while track_status_hooks=false)
        defender.health, // defender_base_health
        1000.0, // hp_a_pre
        1000.0, // hp_b_pre
        false, // death_a_pre
        false, // death_b_pre
        None, // status_keys_a_pre
        None, // status_keys_b_pre
        None, // status_stacks_a_pre
        None, // status_stacks_b_pre
        false, // first_strike_a_pre
        false, // first_strike_b_pre
        SimpleAbilityTimingMode::Ideal,
    );

    assert_eq!(b.death_time, Some(7.5), "B's death committed");
    assert_eq!(b.hp, 1.0, "B's HP pinned to 1.0");
    assert_eq!(hp_a_at_b_death, Some(1000.0), "A's HP at B's death recorded");
    assert!(a.death_time.is_none(), "A still alive");
}

// ── Phase 3 family (StatusDecay gate + ActiveAbilities gate) ───────

#[test]
fn phase_status_decay_gate_no_statuses_no_change() {
    default_ctx_scaffold!(attacker, defender, config, a, b, combat_log, 5.0);
    let mut ctx = PhaseContext {
        time: 5.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_status_decay_gate(&mut ctx);
    assert!(a.statuses.is_empty());
    assert!(b.statuses.is_empty());
    assert_eq!(a.hp, 1000.0);
    assert_eq!(b.hp, 1000.0);
}

#[test]
fn phase_3_activations_harden_fires_when_cooldown_expired() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_harden = true;
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    let mut fortify_control = FortifySimulationControl::default();
    // Harden requires: cooldown elapsed + active window elapsed.
    a.harden_cooldown_until = 0.0;
    a.harden_active_until = 0.0;

    let mut ctx = PhaseContext {
        time: 5.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_3_activations(
        &mut ctx,
        false, // has_any_rewind
        SimpleAbilityTimingMode::Ideal,
        &mut fortify_control,
    );

    assert!(a.harden_active_until > 5.0, "Harden should fire and set active window");
    assert!(a.harden_cooldown_until > 5.0, "cooldown applied");
}

// ── Phase 4 cluster gate-off short-circuits ────────────────────────

#[test]
fn phase_4_traps_cluster_gates_off() {
    default_ctx_scaffold!(attacker, defender, config, a, b, combat_log, 5.0);
    let mut ctx = PhaseContext {
        time: 5.0, attacker: &attacker, defender: &defender,
        attacker_breath: None, defender_breath: None,
        config: &config, record_trace: false,
        a: &mut a, b: &mut b, combat_log: &mut combat_log,
    };
    process_phase_4_traps_cluster(&mut ctx, false, false);
    assert!(combat_log.is_empty());
    assert_eq!(a.thorn_trap_cooldown_until, 0.0);
    assert_eq!(b.thorn_trap_cooldown_until, 0.0);
}

#[test]
fn phase_4_areas_cluster_gates_off() {
    default_ctx_scaffold!(attacker, defender, config, a, b, combat_log, 5.0);
    let mut ctx = PhaseContext {
        time: 5.0, attacker: &attacker, defender: &defender,
        attacker_breath: None, defender_breath: None,
        config: &config, record_trace: false,
        a: &mut a, b: &mut b, combat_log: &mut combat_log,
    };
    process_phase_4_areas_cluster(&mut ctx, false, false, false, false);
    assert!(combat_log.is_empty());
    assert_eq!(a.frost_snare_cooldown_until, 0.0);
}

#[test]
fn phase_4_aura_and_trails_cluster_gates_off() {
    default_ctx_scaffold!(attacker, defender, config, a, b, combat_log, 5.0);
    let mut counters = DamageCounters::default();
    let mut ctx = PhaseContext {
        time: 5.0, attacker: &attacker, defender: &defender,
        attacker_breath: None, defender_breath: None,
        config: &config, record_trace: false,
        a: &mut a, b: &mut b, combat_log: &mut combat_log,
    };
    process_phase_4_aura_and_trails_cluster(
        &mut ctx, false, false, None, None, &mut counters,
    );
    assert_eq!(counters.dealt_a, 0.0);
    assert_eq!(counters.dealt_b, 0.0);
}

#[test]
fn phase_4_healing_actives_cluster_gates_off() {
    default_ctx_scaffold!(attacker, defender, config, a, b, combat_log, 5.0);
    let mut ctx = PhaseContext {
        time: 5.0, attacker: &attacker, defender: &defender,
        attacker_breath: None, defender_breath: None,
        config: &config, record_trace: false,
        a: &mut a, b: &mut b, combat_log: &mut combat_log,
    };
    process_phase_4_healing_actives_cluster(&mut ctx, false, false);
    assert_eq!(a.hp, 1000.0);
    assert_eq!(b.hp, 1000.0);
}

#[test]
fn phase_4_healing_ailment_tick_no_status_no_op() {
    default_ctx_scaffold!(attacker, defender, config, a, b, combat_log, 5.0);
    let mut ctx = PhaseContext {
        time: 5.0, attacker: &attacker, defender: &defender,
        attacker_breath: None, defender_breath: None,
        config: &config, record_trace: false,
        a: &mut a, b: &mut b, combat_log: &mut combat_log,
    };
    process_phase_4_healing_ailment_tick(&mut ctx);
    assert_eq!(a.hp, 1000.0);
    assert_eq!(b.hp, 1000.0);
}

#[test]
fn phase_4_status_applies_cluster_no_config_no_op() {
    default_ctx_scaffold!(attacker, defender, config, a, b, combat_log, 5.0);
    let mut ctx = PhaseContext {
        time: 5.0, attacker: &attacker, defender: &defender,
        attacker_breath: None, defender_breath: None,
        config: &config, record_trace: false,
        a: &mut a, b: &mut b, combat_log: &mut combat_log,
    };
    process_phase_4_status_applies_cluster(&mut ctx);
    assert!(a.statuses.is_empty());
    assert!(b.statuses.is_empty());
}

#[test]
fn phase_4_lich_and_spite_cluster_no_config_no_op() {
    default_ctx_scaffold!(attacker, defender, config, a, b, combat_log, 5.0);
    let mut ctx = PhaseContext {
        time: 5.0, attacker: &attacker, defender: &defender,
        attacker_breath: None, defender_breath: None,
        config: &config, record_trace: false,
        a: &mut a, b: &mut b, combat_log: &mut combat_log,
    };
    process_phase_4_lich_and_spite_cluster(&mut ctx);
    assert!(!a.spite_armed);
    assert!(!b.spite_armed);
    assert_eq!(a.lich_mark_cooldown_until, 0.0);
}

#[test]
fn phase_4_delayed_activations_cluster_no_config_no_op() {
    default_ctx_scaffold!(attacker, defender, config, a, b, combat_log, 5.0);
    let mut ability_timing_events_a = Vec::new();
    let mut ability_timing_events_b = Vec::new();
    let mut warden_rage_events_a = Vec::new();
    let mut warden_rage_events_b = Vec::new();
    let mut ctx = PhaseContext {
        time: 5.0, attacker: &attacker, defender: &defender,
        attacker_breath: None, defender_breath: None,
        config: &config, record_trace: false,
        a: &mut a, b: &mut b, combat_log: &mut combat_log,
    };
    process_phase_4_delayed_activations_cluster(
        &mut ctx,
        SimpleAbilityTimingMode::Ideal,
        false,
        &mut ability_timing_events_a,
        &mut ability_timing_events_b,
        &mut warden_rage_events_a,
        &mut warden_rage_events_b,
    );
    assert!(!a.warden_rage_on);
    assert_eq!(a.unbridled_rage_active_until, 0.0);
    assert_eq!(a.hunters_curse_active_until, 0.0);
    assert!(ability_timing_events_a.is_empty());
}

#[test]
fn phase_4_tick_actives_cluster_no_config_no_op() {
    default_ctx_scaffold!(attacker, defender, config, a, b, combat_log, 5.0);
    let mut counters = DamageCounters::default();
    let mut ability_timing_events_a = Vec::new();
    let mut ability_timing_events_b = Vec::new();
    let mut ctx = PhaseContext {
        time: 5.0, attacker: &attacker, defender: &defender,
        attacker_breath: None, defender_breath: None,
        config: &config, record_trace: false,
        a: &mut a, b: &mut b, combat_log: &mut combat_log,
    };
    process_phase_4_tick_actives_cluster(
        &mut ctx,
        SimpleAbilityTimingMode::Ideal,
        &mut counters,
        &mut ability_timing_events_a,
        &mut ability_timing_events_b,
    );
    assert_eq!(counters.dealt_a, 0.0);
    assert_eq!(a.reflect_active_until, 0.0);
    assert!(!a.reflux_armed);
}

#[test]
fn phase_4_misc_and_cocoon_cluster_no_config_no_op() {
    default_ctx_scaffold!(attacker, defender, config, a, b, combat_log, 5.0);
    let mut counters = DamageCounters::default();
    let mut ctx = PhaseContext {
        time: 5.0, attacker: &attacker, defender: &defender,
        attacker_breath: None, defender_breath: None,
        config: &config, record_trace: false,
        a: &mut a, b: &mut b, combat_log: &mut combat_log,
    };
    process_phase_4_misc_and_cocoon_cluster(
        &mut ctx,
        SimpleAbilityTimingMode::Ideal,
        &mut counters,
    );
    assert_eq!(counters.dealt_a, 0.0);
    assert_eq!(a.cocoon_phase2_until, 0.0);
    assert_eq!(a.cause_fear_cooldown_until, 0.0);
}

// ── Phase 10+11 Melee A and B ──────────────────────────────────────

#[test]
fn phase_10_11_no_op_when_bites_not_due() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    let mut counters = DamageCounters::default();
    let mut bite_count_a = 0u32;
    let mut bite_count_b = 0u32;
    // CombatSide::new sets next_hit = 0.0 (first bite at t=0). Pick
    // time well before that - actually next_hit defaults need to be
    // checked. Let's set explicitly to ensure they're in the future.
    a.next_hit = 10.0;
    b.next_hit = 10.0;
    let hp_a_before = a.hp;
    let hp_b_before = b.hp;

    let mut ctx = PhaseContext {
        time: 5.0, // before either bite is due
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_10_11_melee(
        &mut ctx,
        &attacker,
        &defender,
        false,
        false,
        &mut counters,
        &mut bite_count_a,
        &mut bite_count_b,
        None,
        None,
        None,
    );

    assert_eq!(bite_count_a, 0);
    assert_eq!(bite_count_b, 0);
    assert_eq!(a.hp, hp_a_before);
    assert_eq!(b.hp, hp_b_before);
    assert_eq!(counters.dealt_a, 0.0);
    assert_eq!(counters.dealt_b, 0.0);
}

#[test]
fn phase_10_11_a_bite_due_damages_b() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    let mut counters = DamageCounters::default();
    let mut bite_count_a = 0u32;
    let mut bite_count_b = 0u32;
    // A's bite due at t=5, B's bite not due.
    a.next_hit = 5.0;
    b.next_hit = 100.0;

    let mut ctx = PhaseContext {
        time: 5.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: true,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_10_11_melee(
        &mut ctx,
        &attacker,
        &defender,
        false,
        false,
        &mut counters,
        &mut bite_count_a,
        &mut bite_count_b,
        None,
        None,
        None,
    );

    assert_eq!(bite_count_a, 1, "A's bite counter increments");
    assert_eq!(bite_count_b, 0, "B's bite not due, no increment");
    assert!(b.hp < 1000.0, "B took bite damage, hp={}", b.hp);
    assert!(counters.dealt_a > 0.0, "counters.dealt_a tracks the bite");
    assert_eq!(counters.dealt_b, 0.0, "no damage from B");
    // A's bite is rescheduled past current time (cooldown applied).
    assert!(a.next_hit > 5.0, "next_hit rescheduled (cooldown applied)");
}

#[test]
fn phase_10_11_cocoon_invincibility_reschedules_a_bite() {
    // When B is in Cocoon Ph2 window AND A's bite would land in that
    // window, A's bite gets rescheduled to Ph2 end and no damage
    // applies that tick. This is the Cocoon target-invincibility
    // contract (see comment block in `process_phase_10_11_melee`).
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    let mut counters = DamageCounters::default();
    let mut bite_count_a = 0u32;
    let mut bite_count_b = 0u32;
    // A's bite due at t=5. B is in Cocoon Ph2 window [3, 10].
    a.next_hit = 5.0;
    b.next_hit = 100.0;
    b.cocoon_phase1_until = 3.0;
    b.cocoon_phase2_until = 10.0;

    let mut ctx = PhaseContext {
        time: 5.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_10_11_melee(
        &mut ctx,
        &attacker,
        &defender,
        false,
        false,
        &mut counters,
        &mut bite_count_a,
        &mut bite_count_b,
        None,
        None,
        None,
    );

    assert_eq!(bite_count_a, 0, "Cocoon Ph2 reschedules, no bite fired");
    assert_eq!(b.hp, 1000.0, "B's HP untouched while invincible");
    assert_eq!(counters.dealt_a, 0.0);
    // A's next_hit was rescheduled to b.cocoon_phase2_until.
    assert_eq!(a.next_hit, 10.0, "bite rescheduled to Ph2 end");
}

// ── Phase 14+15 Breath (A and B) ───────────────────────────────────

#[test]
fn phase_14_15_breath_no_op_when_tick_not_due() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let breath_a = simple_breath_profile(20.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, Some(&breath_a));
    let mut b = CombatSide::new(&defender, None);
    let mut counters = DamageCounters::default();
    let mut breath_tick_count_a = 0u32;
    let mut breath_tick_count_b = 0u32;
    // CombatSide::new sets next_breath via runtime_breath_tick_sec.
    // We pick a time deliberately before the first tick to verify
    // the early-return.
    let original_next = a.next_breath;
    assert!(original_next > 0.0, "fixture sanity: A scheduled a breath");

    let mut ctx = PhaseContext {
        time: original_next - 0.5, // 0.5 s before due
        attacker: &attacker,
        defender: &defender,
        attacker_breath: Some(&breath_a),
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_14_15_breath(
        &mut ctx,
        &attacker,
        &defender,
        false,
        false,
        &mut counters,
        &mut breath_tick_count_a,
        &mut breath_tick_count_b,
    );

    assert_eq!(breath_tick_count_a, 0, "tick must not fire before due time");
    assert_eq!(b.hp, 1000.0, "no breath damage when tick not due");
    assert_eq!(a.next_breath, original_next, "next_breath untouched");
}

#[test]
fn phase_14_15_breath_a_tick_damages_b_and_reschedules() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let breath_a = simple_breath_profile(50.0); // strong DPS for clean signal
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, Some(&breath_a));
    let mut b = CombatSide::new(&defender, None);
    let mut counters = DamageCounters::default();
    let mut breath_tick_count_a = 0u32;
    let mut breath_tick_count_b = 0u32;
    // Force the tick to be due at our test time.
    let fire_at = a.next_breath;

    let mut ctx = PhaseContext {
        time: fire_at,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: Some(&breath_a),
        defender_breath: None,
        config: &config,
        record_trace: true,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_14_15_breath(
        &mut ctx,
        &attacker,
        &defender,
        false,
        false,
        &mut counters,
        &mut breath_tick_count_a,
        &mut breath_tick_count_b,
    );

    assert_eq!(breath_tick_count_a, 1, "exactly one A tick fired");
    assert_eq!(breath_tick_count_b, 0, "B has no breath profile, no tick");
    assert!(b.hp < 1000.0, "B took breath damage, got {}", b.hp);
    assert!(counters.dealt_a > 0.0, "counters.dealt_a tracks A's breath damage");
    assert!(a.next_breath > fire_at, "next_breath rescheduled past current time");
}

#[test]
fn phase_14_15_no_breath_profile_no_tick() {
    // Side has no breath profile (`attacker_breath: None`) - fn must
    // be a no-op even if `next_breath` happens to align with `time`.
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    let mut counters = DamageCounters::default();
    let mut breath_tick_count_a = 0u32;
    let mut breath_tick_count_b = 0u32;

    let mut ctx = PhaseContext {
        time: a.next_breath, // would be due if profile existed
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_14_15_breath(
        &mut ctx,
        &attacker,
        &defender,
        false,
        false,
        &mut counters,
        &mut breath_tick_count_a,
        &mut breath_tick_count_b,
    );

    assert_eq!(breath_tick_count_a, 0);
    assert_eq!(breath_tick_count_b, 0);
    assert_eq!(a.hp, 1000.0);
    assert_eq!(b.hp, 1000.0);
}

// ── Phase 4 Hunker decisions ───────────────────────────────────────

#[test]
fn phase_4_hunker_short_circuits_when_neither_side_has_hunker() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);

    let mut ctx = PhaseContext {
        time: 1.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    // `has_any_hunker = false` is the early-return gate.
    process_phase_4_hunker_decisions(
        &mut ctx,
        false,
        false,
        false,
        SimpleAbilityTimingMode::Ideal,
        1.0,
    );

    assert!(!a.hunker_on, "no change when has_any_hunker=false");
    assert!(!b.hunker_on);
    assert!(combat_log.is_empty(), "no events emitted");
}

// ── Phase 9 Lance aura ─────────────────────────────────────────────

#[test]
fn phase_9_lance_aura_no_op_when_no_aura_active() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    let mut counters = DamageCounters::default();
    // Default state: lance_aura_until = 0.0, lance_aura_next_tick_at = None.

    let mut ctx = PhaseContext {
        time: 5.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_9_lance_aura(&mut ctx, &attacker, &defender, &mut counters);

    assert_eq!(b.hp, 1000.0, "no aura → no damage to B");
    assert_eq!(a.hp, 1000.0, "no aura → no damage to A");
    assert_eq!(counters.dealt_a, 0.0);
    assert_eq!(counters.dealt_b, 0.0);
}

// ── Phase 12 Status DOT ticks ──────────────────────────────────────

#[test]
fn phase_12_dot_no_op_when_no_statuses() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    let mut counters = DamageCounters::default();
    // Both sides have empty `.statuses` - phase 12 short-circuits.

    let mut ctx = PhaseContext {
        time: 5.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_12_status_dot_ticks(&mut ctx, &attacker, &defender, &mut counters);

    assert_eq!(a.hp, 1000.0);
    assert_eq!(b.hp, 1000.0);
    assert_eq!(counters.dealt_a, 0.0);
    assert_eq!(counters.dealt_b, 0.0);
}

#[test]
fn phase_12_dot_consumes_burn_tick_dealing_damage() {
    // Phase 12 fires when a status with `next_tick_at <= time` is
    // present. Burn ticks deal flat damage scaled by max HP.
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    let mut counters = DamageCounters::default();
    // Apply Burn to side A with a tick due at t=3.
    a.statuses.insert(
        "Burn_Status".to_string(),
        SimpleStatusInstance {
            stacks: 5.0,
            next_tick_at: Some(3.0),
            next_decay_at: Some(10.0),
            remaining_sec: 15.0,
            stack_value_mode: None,
            lich_mark_owned_stacks: None,
            no_decay: false,
            resolved_scalars: None,
        },
    );
    let hp_a_before = a.hp;

    let mut ctx = PhaseContext {
        time: 3.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_12_status_dot_ticks(&mut ctx, &attacker, &defender, &mut counters);

    assert!(a.hp < hp_a_before, "Burn tick must drop A's HP, got {} → {}", hp_a_before, a.hp);
    // Burn damage flows into counters.dealt_b (B is the implicit
    // attacker of a DOT on A - DOT attribution goes to the side
    // whose status is hitting the other).
    assert!(counters.dealt_b > 0.0, "DOT damage tracked on counters.dealt_b");
    // The status was rescheduled or expired - its next_tick_at must
    // have advanced past `time` or be removed.
    if let Some(status) = a.statuses.get("Burn_Status") {
        let nt = status.next_tick_at.unwrap_or(f64::INFINITY);
        assert!(nt > 3.0, "next_tick_at advanced past current time");
    }
}

// ── Phase 7 (Self-Destruct passive) ───────────────────────────────

#[test]
fn phase_7_no_op_when_neither_side_has_self_destruct() {
    // Sanity: gate flag `has_any_self_destruct = false` short-circuits.
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);

    let mut ctx = PhaseContext {
        time: 1.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_7_self_destruct_passive(&mut ctx, false);

    assert!(!a.self_destruct_armed);
    assert!(!b.self_destruct_armed);
}

// ── Phase 15b + 15c (post-breath hooks: rewind + self-destruct death) ─

#[test]
fn phase_15b_15c_no_op_when_no_passives_active() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);

    let mut ctx = PhaseContext {
        time: 5.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    // Both gates off - fn returns immediately.
    process_phase_15b_15c_post_breath_hooks(&mut ctx, false, false);

    assert_eq!(a.rewind_history.len(), 0, "no rewind snapshot recorded");
    assert!(!a.self_destruct_armed, "no self-destruct death triggered");
    assert!(combat_log.is_empty(), "no events emitted");
}

#[test]
fn phase_15b_records_rewind_snapshot_when_configured() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_rewind = true;
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    a.hp = 750.0; // distinctive HP for the snapshot

    let mut ctx = PhaseContext {
        time: 3.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_15b_15c_post_breath_hooks(&mut ctx, true, false);

    assert_eq!(a.rewind_history.len(), 1, "exactly one snapshot recorded");
    // Snapshot tuple is (time, hp, statuses).
    let snap = &a.rewind_history[0];
    assert_eq!(snap.0, 3.0, "snapshot time");
    assert_eq!(snap.1, 750.0, "snapshot hp");
    assert_eq!(b.rewind_history.len(), 0, "defender unchanged");
}

// ── Phase 9 Lance aura ACTIVE (positive-path damage) ──────────────

#[test]
fn phase_9_lance_aura_active_ticks_deal_1pct_max_hp() {
    // Aura window is open and next_tick_at == time → aura tick fires:
    // damage = 0.01 * defender.health (1000 → 10), counter on dealt_a,
    // next_tick_at advances by 1.0.
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    let mut counters = DamageCounters::default();
    a.lance_aura_until = 10.0;
    a.lance_aura_next_tick_at = Some(5.0);

    let mut ctx = PhaseContext {
        time: 5.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_9_lance_aura(&mut ctx, &attacker, &defender, &mut counters);

    assert!((b.hp - 990.0).abs() < 1e-6, "B took 1% maxHP aura damage, hp={}", b.hp);
    assert!((counters.dealt_a - 10.0).abs() < 1e-6, "dealt_a tracks aura damage");
    assert_eq!(counters.dealt_b, 0.0, "B has no aura");
    assert_eq!(a.lance_aura_next_tick_at, Some(6.0), "next tick advanced by 1s");
}

// ── Phase 4 areas - Poison Area positive-path ──────────────────────

#[test]
fn phase_4_areas_poison_area_applies_status_and_reschedules() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_poison_area = true;
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    // next_poison_area defaults to INFINITY - must lower to fire.
    a.next_poison_area = 0.0;

    let mut ctx = PhaseContext {
        time: 5.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_4_areas_cluster(&mut ctx, false, true, false, false);

    assert!(b.statuses.contains_key("Poison_Status"), "Poison_Status applied to B");
    assert!(a.poison_area_cooldown_until > 5.0, "cooldown applied");
    assert!(a.next_poison_area > 5.0, "next_poison_area rescheduled past time");
    assert_eq!(a.hp, 1000.0, "Poison Area doesn't damage A");
    // B's HP isn't dropped directly - Poison_Status DOTs in Phase 12.
    assert_eq!(b.hp, 1000.0, "Poison Area applies status only, no direct hit");
}

// ── Phase 4 misc - Grim Lariat positive-path ───────────────────────

#[test]
fn phase_4_misc_grim_lariat_hits_and_applies_heartbroken() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_grim_lariat = true;
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    let mut counters = DamageCounters::default();
    // Default a.grim_lariat_cooldown_until = 0.0 → gate passes.

    let mut ctx = PhaseContext {
        time: 5.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_4_misc_and_cocoon_cluster(
        &mut ctx,
        SimpleAbilityTimingMode::Ideal,
        &mut counters,
    );

    // damage = attacker.damage * 0.5 = 10 * 0.5 = 5
    assert!((b.hp - 995.0).abs() < 1e-6, "B took Grim Lariat hit (5 dmg), hp={}", b.hp);
    assert!((counters.dealt_a - 5.0).abs() < 1e-6, "dealt_a tracks Grim Lariat damage");
    assert!(b.statuses.contains_key("Heartbroken_Status"), "Heartbroken applied to B");
    assert!(a.grim_lariat_cooldown_until > 5.0, "cooldown applied");
}

// ── Phase 4 tick actives - Reflux impact positive-path ─────────────

#[test]
fn phase_4_tick_actives_reflux_impact_damages_and_applies_slow() {
    let attacker = simple_stats(1000.0);
    let defender = simple_stats(1000.0);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_reflux = true;
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    let mut counters = DamageCounters::default();
    let mut ability_timing_events_a = Vec::new();
    let mut ability_timing_events_b = Vec::new();
    // Arm Reflux at impact-ready state: armed flag + charge ready.
    a.reflux_armed = true;
    a.reflux_charge_ready_at = 5.0;

    let mut ctx = PhaseContext {
        time: 5.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_4_tick_actives_cluster(
        &mut ctx,
        SimpleAbilityTimingMode::Ideal,
        &mut counters,
        &mut ability_timing_events_a,
        &mut ability_timing_events_b,
    );

    // impact = defender.health * 0.05 = 1000 * 0.05 = 50
    assert!((b.hp - 950.0).abs() < 1e-6, "B took Reflux impact (50 dmg), hp={}", b.hp);
    assert!((counters.dealt_a - 50.0).abs() < 1e-6, "dealt_a tracks Reflux impact");
    assert!(b.statuses.contains_key("Slow_Status"), "Slow applied to B");
    assert!(!a.reflux_armed, "Reflux disarmed after impact");
    assert_eq!(a.reflux_charge_ready_at, 0.0, "charge timer reset");
    assert!((a.reflux_puddle_until - 15.0).abs() < 1e-6, "puddle window opens for 10s");
    assert_eq!(a.reflux_next_tick_at, Some(6.0), "first puddle tick scheduled +1s");
    assert!(a.reflux_cooldown_until > 5.0, "cooldown applied");
}

#[test]
fn phase_5_6_regen_zero_when_health_regen_is_zero() {
    let attacker = simple_stats(1000.0); // default health_regen = 0
    let defender = simple_stats(1000.0);
    let config = ComposableAbilityConfig::default();
    let mut combat_log = Vec::new();
    let mut a = CombatSide::new(&attacker, None);
    let mut b = CombatSide::new(&defender, None);
    a.hp = 500.0;
    let mut regen_healed_a = 0.0;
    let mut regen_healed_b = 0.0;
    let mut regen_ticks_a = 0u32;
    let mut regen_ticks_b = 0u32;

    let mut ctx = PhaseContext {
        time: 15.0,
        attacker: &attacker,
        defender: &defender,
        attacker_breath: None,
        defender_breath: None,
        config: &config,
        record_trace: false,
        a: &mut a,
        b: &mut b,
        combat_log: &mut combat_log,
    };
    process_phase_5_6_regen(
        &mut ctx,
        &mut regen_healed_a,
        &mut regen_healed_b,
        &mut regen_ticks_a,
        &mut regen_ticks_b,
    );

    // With health_regen = 0, the scheduler should push next_regen to
    // infinity and never tick again.
    assert_eq!(a.hp, 500.0, "no regen → no HP change");
    assert_eq!(regen_ticks_a, 0);
    assert!(!a.next_regen.is_finite(), "next_regen pushed to infinity");
}
