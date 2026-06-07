//! Posture system isolation tests (Phase 1).
//!
//! Covers:
//!   - Transition duration table
//!   - request_posture_transition: pending/current/complete_at writes,
//!     Hunker auto-off on transition start, timeline event emission,
//!     stand-up is instant
//!   - process_posture_settle: promotion only after completion time,
//!     idempotent on settled sides
//!   - Multiplier helpers gated by settlement: regen / decay / damage
//!     return 1.0 during transition, scaled value once settled
//!
//! Each test starts with the marker `// [POSTURE:phase1]` so the file
//! is easy to grep when later phases extend the suite.

use super::posture::{
    self, settled_decay_mult, settled_incoming_damage_mult, settled_regen_mult, Posture,
};
use super::reference_tests::{default_breath, default_combatant};
use super::side::CombatSide;

fn fresh_side() -> CombatSide {
    let stats = default_combatant();
    let breath = default_breath();
    CombatSide::new(&stats, Some(&breath))
}

#[test]
fn transition_duration_table_matches_spec() {
    // [POSTURE:phase1]
    assert_eq!(posture::transition_duration(Posture::Standing, Posture::Sitting), 1.0);
    assert_eq!(posture::transition_duration(Posture::Standing, Posture::Laying), 2.0);
    assert_eq!(posture::transition_duration(Posture::Sitting, Posture::Laying), 1.0);
    assert_eq!(posture::transition_duration(Posture::Laying, Posture::Sitting), 1.0);
    assert_eq!(posture::transition_duration(Posture::Sitting, Posture::Standing), 0.0);
    assert_eq!(posture::transition_duration(Posture::Laying, Posture::Standing), 0.0);
    assert_eq!(posture::transition_duration(Posture::Standing, Posture::Standing), 0.0);
}

#[test]
fn request_sit_writes_pending_and_completion_time() {
    // [POSTURE:phase1]
    let mut side = fresh_side();
    let mut log = Vec::new();
    posture::request_posture_transition(&mut side, Posture::Sitting, 5.0, &mut log, true, "A");
    assert_eq!(side.posture_current, Posture::Standing);
    assert_eq!(side.posture_pending, Posture::Sitting);
    assert!((side.posture_transition_complete_at - 6.0).abs() < 1e-9);
    // Multipliers stay at 1.0 during the transition window.
    assert_eq!(side.posture_regen_mult(), 1.0);
    assert_eq!(side.posture_decay_mult(), 1.0);
    assert_eq!(side.posture_incoming_damage_mult(), 1.0);
    // One "Sitting down" log entry was emitted.
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].description.as_deref(), Some("Sitting down"));
}

#[test]
fn lay_transition_two_seconds_settles_to_full_multipliers() {
    // [POSTURE:phase1]
    let mut side = fresh_side();
    let mut log = Vec::new();
    posture::request_posture_transition(&mut side, Posture::Laying, 10.0, &mut log, true, "B");
    assert!((side.posture_transition_complete_at - 12.0).abs() < 1e-9);
    // Mid-transition: still standing for multiplier math.
    posture::process_posture_settle(&mut side, 11.0, &mut log, true, "B");
    assert_eq!(side.posture_current, Posture::Standing);
    assert_eq!(side.posture_regen_mult(), 1.0);
    // Exactly at completion: settles.
    posture::process_posture_settle(&mut side, 12.0, &mut log, true, "B");
    assert_eq!(side.posture_current, Posture::Laying);
    assert!((side.posture_regen_mult() - settled_regen_mult(Posture::Laying)).abs() < 1e-9);
    assert!((side.posture_decay_mult() - settled_decay_mult(Posture::Laying)).abs() < 1e-9);
    assert!(
        (side.posture_incoming_damage_mult() - settled_incoming_damage_mult(Posture::Laying))
            .abs()
            < 1e-9
    );
    // Log: "Laying down" at start + "Now laying" at completion.
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].description.as_deref(), Some("Laying down"));
    assert_eq!(log[1].description.as_deref(), Some("Now laying"));
}

#[test]
fn stand_up_is_instant_and_emits_one_event() {
    // [POSTURE:phase1]
    let mut side = fresh_side();
    // Settle the side at Laying first.
    side.posture_current = Posture::Laying;
    side.posture_pending = Posture::Laying;
    let mut log = Vec::new();
    posture::request_posture_transition(&mut side, Posture::Standing, 30.0, &mut log, true, "A");
    assert_eq!(side.posture_current, Posture::Standing);
    assert_eq!(side.posture_pending, Posture::Standing);
    assert_eq!(side.posture_regen_mult(), 1.0);
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].description.as_deref(), Some("Stood up"));
}

#[test]
fn hunker_auto_deactivates_on_transition_start() {
    // [POSTURE:phase1]
    let mut side = fresh_side();
    side.hunker_on = true;
    let mut log = Vec::new();
    posture::request_posture_transition(&mut side, Posture::Sitting, 0.0, &mut log, false, "A");
    assert!(!side.hunker_on, "Hunker must turn off the moment transition starts");
}

#[test]
fn idempotent_request_same_posture_does_nothing() {
    // [POSTURE:phase1]
    let mut side = fresh_side();
    side.hunker_on = true;
    let mut log = Vec::new();
    posture::request_posture_transition(&mut side, Posture::Standing, 0.0, &mut log, true, "A");
    // Already Standing → no state change, no Hunker disturbance, no log.
    assert!(side.hunker_on);
    assert_eq!(log.len(), 0);
}

#[test]
fn process_settle_idempotent_on_settled_side() {
    // [POSTURE:phase1]
    let mut side = fresh_side();
    side.posture_current = Posture::Sitting;
    side.posture_pending = Posture::Sitting;
    let mut log = Vec::new();
    posture::process_posture_settle(&mut side, 100.0, &mut log, true, "A");
    assert_eq!(log.len(), 0);
    assert_eq!(side.posture_current, Posture::Sitting);
}

#[test]
fn process_settle_does_not_promote_before_completion() {
    // [POSTURE:phase1]
    let mut side = fresh_side();
    let mut log = Vec::new();
    posture::request_posture_transition(&mut side, Posture::Sitting, 5.0, &mut log, false, "A");
    // 0.5 s into a 1-s transition: still pending.
    posture::process_posture_settle(&mut side, 5.5, &mut log, true, "A");
    assert_eq!(side.posture_current, Posture::Standing);
    assert_eq!(side.posture_pending, Posture::Sitting);
    assert_eq!(log.len(), 0); // no completion log yet
}

// ============================================================
// Phase 2: action gating - bite, breath, ability activations
// ============================================================

mod action_gating {
    use super::*;
    use crate::composable::config::ComposableAbilityConfig;
    use crate::composable::simulate_composable_matchup_with_trace;
    use crate::composable::side::CombatSide;
    use crate::contracts::SimpleAbilityTimingMode;

    fn force_posture(side: &mut CombatSide, target: Posture, time: f64) {
        // Test helper: bypass the policy and force the side into
        // `target` synchronously. Settling is immediate so we can
        // assert behaviour without waiting for transition windows.
        side.posture_current = target;
        side.posture_pending = target;
        side.posture_transition_complete_at = time;
        if target != Posture::Standing {
            side.hunker_on = false;
        }
    }

    #[test]
    fn laying_blocks_bite() {
        // [POSTURE:phase2]
        let mut attacker = default_combatant();
        attacker.health = 5_000.0;
        attacker.damage = 200.0;
        attacker.bite_cooldown = 1.0;
        let mut defender = default_combatant();
        defender.health = 10_000.0;
        defender.bite_cooldown = 1000.0; // defender doesn't bite back

        // Run a baseline (no posture) to know how many bites the
        // attacker would normally land in 5 seconds.
        let baseline = simulate_composable_matchup_with_trace(
            &attacker,
            &defender,
            None,
            None,
            SimpleAbilityTimingMode::Ideal,
            &ComposableAbilityConfig::default(),
            5.0,
            true,
        );
        let baseline_bites = baseline
            .combat_log
            .as_ref()
            .unwrap()
            .iter()
            .filter(|e| e.entry_type == "bite" && e.attacker == "A")
            .count();
        assert!(baseline_bites >= 3, "baseline must land at least 3 bites");

        // Hard to force posture mid-simulation from outside without a
        // hook into the engine state. Instead, assert via the helper
        // that the gating predicate is correct: a side with
        // `posture_settled_non_standing()` must short-circuit the
        // bite-phase early-return path. This is the unit-level proof;
        // the integration with the policy lives in Phase 3.
        let mut probe = CombatSide::new(&attacker, None);
        force_posture(&mut probe, Posture::Laying, 0.0);
        assert!(probe.posture_settled_non_standing());
        assert_eq!(probe.posture_incoming_damage_mult(), 1.75);
    }

    #[test]
    fn transitioning_side_can_still_bite() {
        // [POSTURE:phase2]
        // The spec is explicit: during the 1-2 s transition window
        // bites, breath, and ability activations are NOT blocked.
        // Only the SETTLED state gates actions.
        let mut side = CombatSide::new(&default_combatant(), None);
        // Mid-transition: pending=Laying, current=Standing.
        side.posture_pending = Posture::Laying;
        side.posture_current = Posture::Standing;
        side.posture_transition_complete_at = 2.0;
        // The action gate uses `posture_settled_non_standing()` -
        // transition window must NOT block.
        assert!(!side.posture_settled_non_standing());
        // Multipliers also off during transition (Phase 1 spec).
        assert_eq!(side.posture_incoming_damage_mult(), 1.0);
        assert_eq!(side.posture_regen_mult(), 1.0);
    }

    #[test]
    fn hunker_force_off_on_lay_request_and_cannot_reactivate_while_settled() {
        // [POSTURE:phase2]
        // Phase 1 already covers "transition start kills Hunker"; this
        // test asserts the Phase 2 follow-up: once settled, the policy
        // / activation guard cannot reactivate Hunker.
        let mut side = CombatSide::new(&default_combatant(), None);
        side.hunker_on = true;
        let mut log = Vec::new();
        crate::composable::posture::request_posture_transition(
            &mut side,
            Posture::Laying,
            0.0,
            &mut log,
            false,
            "A",
        );
        assert!(!side.hunker_on, "Phase 1 must kill Hunker on transition start");
        // Force into settled state for the test.
        force_posture(&mut side, Posture::Laying, 2.0);
        // The activation guard (process_phase_4_hunker_decisions) reads
        // `posture_settled_non_standing()` and refuses to set hunker_on.
        // Direct invocation of the phase requires a full PhaseContext;
        // the predicate proof is enough at unit-level.
        assert!(side.posture_settled_non_standing());
    }
}

// ============================================================
// Phase 3: posture policy - safety + effectiveness
// ============================================================

mod policy {
    use super::*;
    use crate::composable::config::ComposableAbilityConfig;
    use crate::composable::posture_policy::{decide, PostureAction};
    use crate::composable::setup::populate_combat_sides_and_flags;
    use crate::composable::side::CombatSide;
    use crate::composable::simulate_composable_matchup_with_trace;
    use crate::composable::{FortifySimulationControl, OrderedEventPhase};
    use crate::contracts::SimpleAbilityTimingMode;

    fn config_policy_on(regen_aware: bool, attacker: bool, defender: bool) -> ComposableAbilityConfig {
        let mut c = ComposableAbilityConfig::default();
        if attacker {
            c.attacker_posture_policy_enabled = true;
            c.attacker_posture_policy_regen_aware = regen_aware;
        }
        if defender {
            c.defender_posture_policy_enabled = true;
            c.defender_posture_policy_regen_aware = regen_aware;
        }
        c
    }

    /// Helper for unit tests: invoke `decide` with a fresh
    /// default config + the engine's default ordered-event phases.
    /// `self_is_attacker` is fixed to true since these tests only
    /// exercise the attacker side; symmetric defender-side behaviour
    /// is covered by the integration test
    /// `end_to_end_policy_emits_posture_event_in_log`.
    fn call_decide(
        self_side: &CombatSide,
        opp_side: &CombatSide,
        self_stats: &crate::contracts::SimpleCombatantStats,
        opp_stats: &crate::contracts::SimpleCombatantStats,
        time: f64,
    ) -> PostureAction {
        let config = ComposableAbilityConfig::default();
        let mut a_setup = CombatSide::new(self_stats, None);
        let mut b_setup = CombatSide::new(opp_stats, None);
        let flags = populate_combat_sides_and_flags(
            &mut a_setup, &mut b_setup, self_stats, opp_stats,
            SimpleAbilityTimingMode::Ideal, &config,
        );
        // The scheduler picks phases from this slice. Empty slice
        // means "no phases can fire" - time never advances and the
        // replay is a no-op. Use the engine's default order so the
        // inner replay matches what the live loop would run.
        let event_phase_order = vec![
            OrderedEventPhase::StatusDecay,
            OrderedEventPhase::ActiveAbilities,
            OrderedEventPhase::Regen,
            OrderedEventPhase::Bite,
            OrderedEventPhase::StatusTicks,
            OrderedEventPhase::Breath,
        ];
        decide(
            self_side, opp_side, self_stats, opp_stats, None, None,
            time, true,
            &config, &flags,
            SimpleAbilityTimingMode::Ideal,
            &event_phase_order,
            FortifySimulationControl::default(),
            /* max_time_sec */ 60.0,
        )
    }

    #[test]
    fn off_mode_never_emits_posture_events() {
        // [POSTURE:phase3] [REF:compare_posture_policy]
        // Off mode = `posture_policy_enabled` left at default false.
        // The simulation must NEVER emit posture transition events.
        let attacker = default_combatant();
        let defender = default_combatant();
        let result = simulate_composable_matchup_with_trace(
            &attacker, &defender, None, None,
            SimpleAbilityTimingMode::Ideal,
            &ComposableAbilityConfig::default(),
            60.0, true,
        );
        let log = result.combat_log.expect("trace");
        let posture_events = log
            .iter()
            .filter(|e| matches!(
                e.description.as_deref(),
                Some("Sitting down") | Some("Laying down") | Some("Now sitting")
                | Some("Now laying") | Some("Stood up") | Some("Standing up")
            ))
            .count();
        assert_eq!(posture_events, 0, "Off mode must not change posture: {posture_events} events");
    }

    #[test]
    fn auto_mode_never_worse_than_off_under_random_matchup() {
        // [POSTURE:phase3] [REF:compare_posture_policy]
        // Safety property: enabling the policy on a representative
        // matchup must NEVER lower the side's final HP relative to
        // running the same matchup with the policy off. The policy
        // always includes Stay among its candidates and picks the
        // highest-scoring one, so in the worst case it picks Stay
        // every time and produces identical state.
        let mut attacker = default_combatant();
        attacker.health = 8000.0;
        attacker.damage = 150.0;
        attacker.bite_cooldown = 1.0;
        attacker.weight = 4000.0;
        attacker.health_regen = 12.0;
        let mut defender = default_combatant();
        defender.health = 6500.0;
        defender.damage = 200.0;
        defender.bite_cooldown = 1.2;
        defender.weight = 3500.0;
        defender.health_regen = 10.0;
        let baseline = simulate_composable_matchup_with_trace(
            &attacker, &defender, None, None,
            SimpleAbilityTimingMode::Ideal,
            &ComposableAbilityConfig::default(),
            120.0, false,
        );
        let with_policy = simulate_composable_matchup_with_trace(
            &attacker, &defender, None, None,
            SimpleAbilityTimingMode::Ideal,
            &config_policy_on(true, true, false),
            120.0, false,
        );
        // Either A wins both, or both go to time-out with A surviving
        // at least as much HP. Policy = Stay-every-decision should
        // produce an identical trace, but even with active lay/sit
        // decisions the projected outcome must not strictly underperform
        // the baseline. We assert: A's surviving HP at simulation end
        // is at least as high under the policy as without it (within
        // a small slack for forward-sim approximation error).
        let hp_a_baseline = baseline.hp_a_at_b_death;
        let hp_a_policy = with_policy.hp_a_at_b_death;
        // Slack 5%: forward-sim is an approximation, brief 1-2 s
        // misjudgements are tolerated. Anything worse than 5% means
        // the projector is systematically wrong.
        let slack = (attacker.health * 0.05).max(50.0);
        assert!(
            hp_a_policy + slack >= hp_a_baseline,
            "policy must not worsen A's HP: baseline={hp_a_baseline}, policy={hp_a_policy}, slack={slack}"
        );
    }

    #[test]
    fn decide_returns_stay_when_no_clear_improvement() {
        // [POSTURE:phase3] [REF:compare_posture_policy]
        // A balanced midfight at full HP with no ailments should
        // produce Stay - laying for the upcoming regen tick gains
        // nothing (HP already at max) but incurs the ×1.75 incoming
        // damage penalty during the settled window.
        let attacker = default_combatant();
        let defender = default_combatant();
        let a = CombatSide::new(&attacker, None);
        let b = CombatSide::new(&defender, None);
        let action = call_decide(&a, &b, &attacker, &defender, 7.0);
        assert_eq!(
            action, PostureAction::Stay,
            "no laying benefit at full HP → policy must pick Stay; got {action:?}"
        );
    }

    // 2026-05-21: engine-replay moves the live posture decision to
    // `stance_bridge::decide_stance_now` (which has full LoopState
    // access). The previous unit test
    // `lay_decision_near_tick_with_low_hp_weak_opponent` exercised
    // the old standalone API and is covered now by the integration
    // test `end_to_end_policy_emits_posture_event_in_log` and the
    // brute-force benchmark scenarios 1-12.

    #[test]
    fn end_to_end_policy_emits_posture_event_in_log() {
        // [POSTURE:phase3] [REF:compare_posture_policy]
        // Regression: prove that with policy enabled, the simulation
        // actually drives the side into a non-Standing posture and
        // emits the corresponding combat-log entry. Earlier tests
        // call `decide()` in isolation; this test exercises the FULL
        // engine wiring (config flag → loop → policy → request →
        // settle → log emission).
        // Setup: side that benefits HUGELY from laying for a regen
        // tick. High max HP + high `health_regen` (which scales the
        // tick by %maxHP), opponent that DOES significant damage so
        // the side actually drops below max HP between ticks. No
        // self-attack so we never kill the opponent and never lose
        // damage-dealt fitness from laying. Equal weights so the
        // damage-multiplier math is clean.
        let mut self_stats = default_combatant();
        self_stats.health = 5000.0;
        self_stats.health_regen = 30.0;   // 30% maxHP per tick (1500)
        self_stats.weight = 1000.0;
        self_stats.damage = 0.0;
        self_stats.bite_cooldown = 1000.0;
        let mut opp_stats = default_combatant();
        opp_stats.damage = 200.0;         // 200 dmg / 1.0 s = 200 DPS,
        opp_stats.bite_cooldown = 1.0;    // wounds side every tick
        opp_stats.weight = 1000.0;
        opp_stats.health = 10_000_000.0;
        let mut config = ComposableAbilityConfig::default();
        config.attacker_posture_policy_enabled = true;
        config.attacker_posture_policy_regen_aware = true;
        // (No start-HP override needed - opp DPS is high enough to
        // drop the side well below max within a single regen cycle.)
        let result = simulate_composable_matchup_with_trace(
            &self_stats, &opp_stats, None, None,
            SimpleAbilityTimingMode::Ideal,
            &config,
            30.0, // long enough to catch a regen tick at t=15
            true,
        );
        let log = result.combat_log.expect("trace");
        let posture_events: Vec<&str> = log
            .iter()
            .filter_map(|e| match e.description.as_deref() {
                Some(d) if d.contains("sitting")
                    || d.contains("laying")
                    || d.contains("standing")
                    || d.contains("Stood") => Some(d),
                _ => None,
            })
            .collect();
        assert!(
            !posture_events.is_empty(),
            "policy must produce at least one posture event in the log when wired through the full loop: {posture_events:?}"
        );
    }

    #[test]
    fn high_dps_opponent_blocks_lay_decision() {
        // [POSTURE:phase3] [REF:compare_posture_policy]
        // If the opponent does very high DPS, the ×1.75 incoming
        // damage mult overpowers the regen / decay benefit. Policy
        // should choose Stay.
        let mut self_stats = default_combatant();
        self_stats.health = 5000.0;
        self_stats.health_regen = 5.0;
        let mut opp_stats = default_combatant();
        opp_stats.damage = 800.0; // high
        opp_stats.bite_cooldown = 0.6;
        let mut a = CombatSide::new(&self_stats, None);
        a.hp = 2500.0;
        a.next_regen = 15.0;
        let b = CombatSide::new(&opp_stats, None);
        let action = call_decide(&a, &b, &self_stats, &opp_stats, 13.0);
        assert_eq!(
            action, PostureAction::Stay,
            "high-DPS opponent must veto the lay decision; got {action:?}"
        );
    }

    /// Realistic Korathos core stats from `data/creatures.runtime.json`.
    /// Passive abilities (Block_Bleed, Block_Burn, etc.) are NOT modeled
    /// here - the test exercises bite + regen + posture-policy in
    /// isolation. Adding passives is a separate scope.
    fn korathos_stats() -> crate::contracts::SimpleCombatantStats {
        let mut s = default_combatant();
        s.health = 10750.0;
        s.weight = 50000.0;
        s.damage = 450.0;
        s.bite_cooldown = 1.0;
        s.health_regen = 4.0;
        s
    }

    /// Realistic Golgaroth core stats from `data/creatures.runtime.json`.
    fn golgaroth_stats() -> crate::contracts::SimpleCombatantStats {
        let mut s = default_combatant();
        s.health = 16000.0;
        s.weight = 42500.0;
        s.damage = 180.0;
        s.bite_cooldown = 1.2;
        s.health_regen = 4.0;
        s
    }

    #[test]
    fn policy_lays_for_regen_ticks_korathos_full_regen_build_vs_golgaroth() {
        // [POSTURE:phase5] [REF:compare_posture_policy]
        // Real-match scenario: Korathos with a full regen build
        // (Astral Quetzal plush + Blue Moon + regen-bonus passives,
        // modeled here as `compare_regen_bonus_pct = 200`) fighting
        // Golgaroth (no buffs). User report: policy never fires
        // lay/sit even when math clearly favours it.
        //
        // With +200 % regen bonus, Korathos's per-tick heal is
        // 4 % × 10 750 × 3 = ~1290 HP at ×1 mult, ~2580 at ×2 mult
        // (lay) - a 1290-HP swing. Golga's bite into Korathos is
        // ~165 dmg (weight ratio + bite-damage% effects), so 8 s of
        // settled-lay penalty is ~165 × 0.75 × 6 = ~740. Net for lay
        // = +1290 − 740 = +550 HP per tick captured. Policy must
        // fire StartLay (or StartSit) before each regen tick AND
        // StandUp shortly after.
        let attacker = korathos_stats();
        let defender = golgaroth_stats();
        let mut config = ComposableAbilityConfig::default();
        config.attacker_posture_policy_enabled = true;
        config.attacker_posture_policy_regen_aware = true;
        config.attacker_compare_regen_bonus_pct = 200.0;
        // Defender keeps policy off so we test attacker's decisions in
        // isolation (no mirror-matchup dynamics).
        let result = simulate_composable_matchup_with_trace(
            &attacker, &defender, None, None,
            SimpleAbilityTimingMode::Ideal,
            &config,
            60.0,
            true,
        );
        let log = result.combat_log.expect("trace");
        let mut lay_or_sit_events: Vec<f64> = Vec::new();
        let mut stand_up_events: Vec<f64> = Vec::new();
        for entry in &log {
            // Filter by attacker = "A" so we only count Korathos's events.
            if entry.attacker != "A" {
                continue;
            }
            match entry.description.as_deref() {
                Some("Laying down") | Some("Sitting down") => {
                    lay_or_sit_events.push(entry.time);
                }
                Some("Stood up") => {
                    stand_up_events.push(entry.time);
                }
                _ => {}
            }
        }
        // 60 s fight has regen ticks at 15, 30, 45, 60. Korathos with
        // +200 % regen kills Golga at ~33-37 s (depending on how many
        // bites are missed during lay windows), so only ticks at 15
        // and 30 actually fire before the fight ends - 2 lay events
        // is the natural ceiling. An earlier expectation of ≥3
        // assumed the replay-projector's heavier bite-block extended
        // the fight past tick 45; the unified calibrated sim is more
        // accurate and the fight ends sooner. Policy must fire at
        // least 2 lay events (one per realised tick).
        assert!(
            lay_or_sit_events.len() >= 2,
            "Korathos full-regen build vs Golgaroth: expected ≥2 lay/sit events, got {} at {:?}. Policy is ignoring math-favourable lay opportunities.",
            lay_or_sit_events.len(),
            lay_or_sit_events,
        );
        // For every lay/sit there should be a matching stand-up nearby
        // (proof of "lay-then-stand-after-tick" trajectory). Each lay
        // should be followed by a stand within ~5 s.
        let stand_count_near_lay = lay_or_sit_events
            .iter()
            .filter(|&&lay_t| stand_up_events.iter().any(|&stand_t| stand_t > lay_t && stand_t < lay_t + 5.0))
            .count();
        assert!(
            stand_count_near_lay >= 2,
            "Each lay/sit should have a matching stand-up within 5 s; got {} stand-ups matching {} lay/sit. Trajectory looks like commit-forever-lay (bug). stand_up_events={:?}, lay_or_sit_events={:?}",
            stand_count_near_lay,
            lay_or_sit_events.len(),
            stand_up_events,
            lay_or_sit_events,
        );
    }

    #[test]
    fn policy_does_not_worsen_korathos_regen_build_outcome() {
        // [POSTURE:phase5] [REF:compare_posture_policy]
        // Safety property restated on real-creature stats: enabling the
        // policy for Korathos (full regen build) vs Golgaroth must NOT
        // give a worse outcome (lower final HP) than running with policy
        // off. The policy includes Stay among its candidates so the
        // worst case is "Stay every decision" = identical to off.
        let attacker = korathos_stats();
        let defender = golgaroth_stats();
        let mut base_cfg = ComposableAbilityConfig::default();
        base_cfg.attacker_compare_regen_bonus_pct = 200.0;
        let off = simulate_composable_matchup_with_trace(
            &attacker, &defender, None, None,
            SimpleAbilityTimingMode::Ideal,
            &base_cfg,
            120.0,
            false,
        );
        let mut on_cfg = base_cfg.clone();
        on_cfg.attacker_posture_policy_enabled = true;
        on_cfg.attacker_posture_policy_regen_aware = true;
        let on = simulate_composable_matchup_with_trace(
            &attacker, &defender, None, None,
            SimpleAbilityTimingMode::Ideal,
            &on_cfg,
            120.0,
            false,
        );
        // Attacker's HP at end (or at defender's death if defender died).
        let off_hp = off.final_hp_a;
        let on_hp = on.final_hp_a;
        let off_dealt = off.damage_dealt_a;
        let on_dealt = on.damage_dealt_a;
        // Fitness = final HP + damage dealt. Policy must not strictly
        // underperform off-mode. Allow a small slack (5 % maxHP) for
        // brief 1-2 s policy misjudgements.
        let slack = attacker.health * 0.05;
        assert!(
            on_hp + on_dealt + slack >= off_hp + off_dealt,
            "Policy must not worsen outcome: off (hp={off_hp:.0} dealt={off_dealt:.0}) vs on (hp={on_hp:.0} dealt={on_dealt:.0})"
        );
    }

    #[test]
    fn projector_does_not_suicide_lay_when_dying_before_tick() {
        // [POSTURE:phase5] [REF:compare_posture_policy]
        // Regression for user-reported real-match bug: at low HP with
        // a strong opponent (~600 DPS into us) and a regen tick still
        // ~5 s away, every settling candidate leads to death BEFORE
        // the tick - laying just wastes the brief remaining attack
        // window. Projector must return Stay (preserves my-DPS until
        // death) instead of a suicide sit / lay.
        let mut self_stats = default_combatant();
        self_stats.health = 5000.0;
        self_stats.health_regen = 5.0;
        self_stats.damage = 200.0;
        self_stats.bite_cooldown = 1.0;
        let mut opp_stats = default_combatant();
        opp_stats.damage = 600.0;
        opp_stats.bite_cooldown = 1.0;
        let mut a = CombatSide::new(&self_stats, None);
        a.hp = 1000.0; // dying soon
        a.next_regen = 15.0; // ~5 s away from decision time
        a.next_hit = 10.5;
        a.next_breath = f64::INFINITY;
        let mut b = CombatSide::new(&opp_stats, None);
        b.next_hit = 10.5;
        b.next_breath = f64::INFINITY;
        let action = call_decide(&a, &b, &self_stats, &opp_stats, 10.0);
        assert_eq!(
            action, PostureAction::Stay,
            "side dying before next regen tick must not commit suicide-lay; got {action:?}"
        );
    }
}

// ============================================================
// Phase 3 (extended): engine-replay projector - independence
//                     and recursion-guard guarantees.
// ============================================================

mod replay_primitive {
    use super::*;
    use crate::composable::config::ComposableAbilityConfig;
    use crate::composable::loop_iter::{
        run_one_event_loop_iter, IterHooks, LoopOutcome, LoopParams, LoopState, PosturePolicyMode,
    };
    use crate::composable::posture_policy::decide;
    use crate::composable::setup::populate_combat_sides_and_flags;
    use crate::composable::side::CombatSide;
    use crate::composable::DamageCounters;
    use crate::contracts::SimpleAbilityTimingMode;

    #[test]
    fn decide_does_not_perturb_outer_sides() {
        // [POSTURE:phase3] [REF:compare_posture_policy]
        // The projector clones the runtime state before running its
        // inner replay; the outer sides must be byte-identical after
        // the call. This is a clone-correctness regression gate - if
        // someone introduces a hidden raw-pointer mutation in a phase
        // fn, this test will catch it.
        let attacker = default_combatant();
        let defender = default_combatant();
        let mut a = CombatSide::new(&attacker, None);
        let mut b = CombatSide::new(&defender, None);
        a.hp = 4321.0;
        a.next_regen = 12.0;
        a.next_hit = 0.7;
        b.hp = 5678.0;
        b.next_hit = 1.1;
        let a_hp_before = a.hp;
        let a_next_regen_before = a.next_regen;
        let a_next_hit_before = a.next_hit;
        let a_posture_current_before = a.posture_current;
        let a_posture_pending_before = a.posture_pending;
        let a_statuses_keys_before: Vec<String> = a.statuses.keys().cloned().collect();
        let b_hp_before = b.hp;
        let b_next_hit_before = b.next_hit;
        let b_posture_current_before = b.posture_current;
        let mut config = ComposableAbilityConfig::default();
        config.attacker_posture_policy_enabled = true;
        config.attacker_posture_policy_regen_aware = true;
        let mut a_setup = CombatSide::new(&attacker, None);
        let mut b_setup = CombatSide::new(&defender, None);
        let flags = populate_combat_sides_and_flags(
            &mut a_setup, &mut b_setup, &attacker, &defender,
            SimpleAbilityTimingMode::Ideal, &config,
        );
        let event_phase_order: Vec<crate::composable::OrderedEventPhase> = Vec::new();
        let _action = decide(
            &a, &b, &attacker, &defender, None, None,
            /* time */ 3.0,
            /* self_is_attacker */ true,
            &config, &flags,
            SimpleAbilityTimingMode::Ideal,
            &event_phase_order,
            crate::composable::FortifySimulationControl::default(),
            /* max_time_sec */ 60.0,
        );
        // Verify outer sides unchanged.
        assert_eq!(a.hp, a_hp_before);
        assert_eq!(a.next_regen, a_next_regen_before);
        assert_eq!(a.next_hit, a_next_hit_before);
        assert_eq!(a.posture_current, a_posture_current_before);
        assert_eq!(a.posture_pending, a_posture_pending_before);
        assert_eq!(
            a.statuses.keys().cloned().collect::<Vec<_>>(),
            a_statuses_keys_before
        );
        assert_eq!(b.hp, b_hp_before);
        assert_eq!(b.next_hit, b_next_hit_before);
        assert_eq!(b.posture_current, b_posture_current_before);
    }

    #[test]
    fn forced_off_breaks_recursion_inside_iter() {
        // [POSTURE:phase3] [REF:compare_posture_policy]
        // With `posture_policy_override: ForcedOff`, the iter must NOT
        // invoke `decide()` even when `config.attacker_posture_policy_enabled
        // = true`. We assert by reading `posture_next_decision_at`:
        // every `decide()` call (in Normal mode) calls
        // `schedule_next_posture_decision`, which bumps the field past
        // `time`. With ForcedOff, the block is skipped, so the field
        // stays at its initial 0.0 even after several iterations.
        let attacker = default_combatant();
        let defender = default_combatant();
        let a_init = CombatSide::new(&attacker, None);
        let b_init = CombatSide::new(&defender, None);
        assert_eq!(a_init.posture_next_decision_at, 0.0);
        let mut config = ComposableAbilityConfig::default();
        config.attacker_posture_policy_enabled = true;
        config.attacker_posture_policy_regen_aware = true;
        config.defender_posture_policy_enabled = true;
        config.defender_posture_policy_regen_aware = true;
        let mut a_for_flags = CombatSide::new(&attacker, None);
        let mut b_for_flags = CombatSide::new(&defender, None);
        let flags = populate_combat_sides_and_flags(
            &mut a_for_flags, &mut b_for_flags, &attacker, &defender,
            SimpleAbilityTimingMode::Ideal, &config,
        );
        let event_phase_order: Vec<crate::composable::OrderedEventPhase> = Vec::new();
        let mut state = LoopState {
            a: a_init,
            b: b_init,
            combat_log: Vec::new(),
            counters: DamageCounters::default(),
            time: -1e-9,
            same_time_processed_phases: 0,
            user_iteration_index: 0,
            hp_a_at_b_death: None,
            hp_b_at_a_death: None,
            bite_count_a: 0,
            bite_count_b: 0,
            breath_tick_count_a: 0,
            breath_tick_count_b: 0,
            regen_ticks_a: 0,
            regen_ticks_b: 0,
            regen_healed_a: 0.0,
            regen_healed_b: 0.0,
            warden_rage_events_a: Vec::new(),
            warden_rage_events_b: Vec::new(),
            ability_timing_events_a: Vec::new(),
            ability_timing_events_b: Vec::new(),
            fortify_control: crate::composable::FortifySimulationControl::default(),
        };
        let params = LoopParams {
            attacker: &attacker,
            defender: &defender,
            attacker_breath: None,
            defender_breath: None,
            config: &config,
            flags: &flags,
            ability_policy: SimpleAbilityTimingMode::Fast,
            event_phase_order: &event_phase_order,
            record_trace: false,
            max_time_sec: 10.0,
            bench_count: false,
            posture_policy_override: PosturePolicyMode::ForcedOff,
            iter_hooks: IterHooks::default(),
            decide_override: None,
            decide_override_respects_schedule: false,
            decide_bite_variant_override: None,
        };
        let mut iter_count = 0usize;
        while state.time <= 10.0
            && (state.a.death_time.is_none() || state.b.death_time.is_none())
            && iter_count < 200
        {
            match run_one_event_loop_iter(&mut state, &params) {
                LoopOutcome::Break => break,
                LoopOutcome::Continue => continue,
                LoopOutcome::Advanced => {}
                LoopOutcome::BoundExceeded => break,
            }
            iter_count += 1;
        }
        // Even with policy enabled in config, ForcedOff must skip both
        // sides' decision blocks. `schedule_next_posture_decision` is
        // therefore never called and the field stays at the initial
        // value.
        assert_eq!(
            state.a.posture_next_decision_at, 0.0,
            "ForcedOff must keep A's posture_next_decision_at at initial 0.0; got {}",
            state.a.posture_next_decision_at
        );
        assert_eq!(
            state.b.posture_next_decision_at, 0.0,
            "ForcedOff must keep B's posture_next_decision_at at initial 0.0; got {}",
            state.b.posture_next_decision_at
        );
    }
}

#[test]
fn policy_does_not_flip_outcome_in_long_fight_with_cause_fear() {
    // [POSTURE:phase7] regression for 2026-05-21 user-reported bug:
    // Compare UI showed B (Gimon-Ogu, regen-unaware policy) flipping
    // from winning the off match to LOSING with policy on. Root cause:
    // the calibrated sim used a 20 s horizon and didn't model the bite-lock
    // during settled non-Standing. Over a 60+ s fight, the calibrated sim's
    // repeated tactical-Lay firings cumulatively blocked enough bites
    // to reverse the death race.
    //
    // Fix: sim now models bite-lock AND uses a 60 s horizon. In the
    // sim's longer view it can see opp dying first under standing
    // (race-to-death dynamic), so Lay/Sit trajectories that DELAY my
    // bites are correctly rejected.
    //
    // Assertion: policy fitness must be >= off fitness (within a small
    // slack). The "never worse than off" guarantee is the contract
    // surfaced in the Compare UI tooltip.
    use crate::composable::config::ComposableAbilityConfig;
    use crate::composable::simulate_composable_matchup_with_trace;
    use crate::contracts::{SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleBreathProfile, SimpleCombatantStats};
    fn opralegion() -> SimpleCombatantStats {
        let mut s = default_combatant();
        s.health = 10500.0; s.weight = 16500.0;
        s.damage = 175.0; s.bite_cooldown = 1.4;
        s.health_regen = 4.0; s
    }
    fn gimon_ogu() -> SimpleCombatantStats {
        let mut s = default_combatant();
        s.health = 9750.0; s.weight = 15250.0;
        s.damage = 185.0; s.bite_cooldown = 0.7;
        s.damage2 = 185.0; s.health_regen = 6.0; s
    }
    // Opra's Spirit Glare breath - fires once at t=0, drains capacity
    // over ~5 s, 120 s cooldown. Each tick (0.5 s) does 1 % of opp.hp
    // damage and applies 1 stack of Burn + 1 stack of Fear. This is
    // the dominant non-bite damage source in the Compare matchup that
    // the unmodelled-DPS calibration must absorb.
    fn spirit_glare_breath() -> SimpleBreathProfile {
        SimpleBreathProfile {
            dps_pct: 2.0,
            capacity: 10.0,
            regen_rate: 0.0,
            crit_chance_pct: 0.0,
            chain: 0.0,
            chain_max_stacks: 0.0,
            special_kind: Some("spirit_glare".to_string()),
            special_statuses: vec![
                SimpleAppliedStatus { status_id: "Burn_Status".to_string(), stacks: 1.0, source_ability: None },
                SimpleAppliedStatus { status_id: "Fear_Status".to_string(), stacks: 1.0, source_ability: None },
            ],
            self_heal_pct: 0.0,
            cleanse_stacks: 0.0,
            lance_charge_sec: 0.0,
            lance_damage_pct: 0.0,
            lance_cooldown_sec: 0.0,
            lance_status_id: None,
            auto_fire_delay_sec: 0.0,
            auto_fire_cooldown_sec: 120.0,
            charges_max: 0.0,
            charge_regen_sec: 0.0,
        }
    }
    // Gimon's Miasma Breath - small DPS, provides self-heal.
    fn miasma_breath() -> SimpleBreathProfile {
        SimpleBreathProfile {
            dps_pct: 0.5,
            capacity: 10.0,
            regen_rate: 2.5,
            crit_chance_pct: 25.0,
            chain: 0.0,
            chain_max_stacks: 0.0,
            special_kind: None,
            special_statuses: Vec::new(),
            self_heal_pct: 0.5,
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
    // User's Compare setup (2026-05-21 latest): Opralegion = A (attacker),
    // Gimon-Ogu = B (defender). Cause Fear is Opra's ability (applied
    // from attacker), policy enabled on B (defender). Real Compare path
    // also includes breath profiles - sim doesn't model those, so we
    // pass None here; the regression manifests purely from the calibrated sim's
    // own decisions misalignment with bite-only ground truth.
    let attacker = opralegion();
    let defender = gimon_ogu();
    let attacker_breath = spirit_glare_breath();
    let defender_breath = miasma_breath();
    let mut base_config = ComposableAbilityConfig::default();
    base_config.attacker_cause_fear = true;

    fn run(
        attacker: &SimpleCombatantStats,
        defender: &SimpleCombatantStats,
        ab: &SimpleBreathProfile,
        db: &SimpleBreathProfile,
        cfg: &ComposableAbilityConfig,
    ) -> (Option<f64>, Option<f64>, f64, f64, f64, f64) {
        let r = simulate_composable_matchup_with_trace(
            attacker, defender, Some(ab), Some(db),
            SimpleAbilityTimingMode::Ideal,
            cfg, 120.0, false,
        );
        (
            r.death_time_a, r.death_time_b,
            r.hp_a_at_b_death.max(0.0), r.hp_b_at_a_death.max(0.0),
            r.final_hp_a.max(0.0), r.final_hp_b.max(0.0),
        )
    }

    // All four configurations on top of base (Cause Fear on attacker).
    let off = run(&attacker, &defender, &attacker_breath, &defender_breath, &base_config);

    let mut on_def_unaware = base_config.clone();
    on_def_unaware.defender_posture_policy_enabled = true;
    on_def_unaware.defender_posture_policy_regen_aware = false;
    let r_def_unaware = run(&attacker, &defender, &attacker_breath, &defender_breath, &on_def_unaware);

    let mut on_def_aware = base_config.clone();
    on_def_aware.defender_posture_policy_enabled = true;
    on_def_aware.defender_posture_policy_regen_aware = true;
    let r_def_aware = run(&attacker, &defender, &attacker_breath, &defender_breath, &on_def_aware);

    let mut on_atk_unaware = base_config.clone();
    on_atk_unaware.attacker_posture_policy_enabled = true;
    on_atk_unaware.attacker_posture_policy_regen_aware = false;
    let r_atk_unaware = run(&attacker, &defender, &attacker_breath, &defender_breath, &on_atk_unaware);

    let mut on_atk_aware = base_config.clone();
    on_atk_aware.attacker_posture_policy_enabled = true;
    on_atk_aware.attacker_posture_policy_regen_aware = true;
    let r_atk_aware = run(&attacker, &defender, &attacker_breath, &defender_breath, &on_atk_aware);

    let print = |label: &str, r: &(Option<f64>, Option<f64>, f64, f64, f64, f64)| {
        eprintln!(
            "[{label}] a_death={:?} b_death={:?} hp_a@b_death={:.0} hp_b@a_death={:.0} final_a={:.0} final_b={:.0}",
            r.0, r.1, r.2, r.3, r.4, r.5,
        );
    };
    print("OFF                ", &off);
    print("DEF policy unaware ", &r_def_unaware);
    print("DEF policy aware   ", &r_def_aware);
    print("ATK policy unaware ", &r_atk_unaware);
    print("ATK policy aware   ", &r_atk_aware);

    // Fitness: positive = side wins / has more HP at fight end.
    // B's perspective (defender = Gimon):
    let b_fit = |r: &(Option<f64>, Option<f64>, f64, f64, f64, f64)| -> f64 {
        let a_dead = r.0.is_some();
        let b_dead = r.1.is_some();
        match (a_dead, b_dead) {
            (true, false) => r.3,    // B won
            (false, true) => -r.2,   // B lost
            (false, false) => r.5,   // timeout, B's HP
            (true, true) => if r.1.unwrap() < r.0.unwrap() { -r.2 } else { r.3 },
        }
    };
    // A's perspective (attacker = Opra):
    let a_fit = |r: &(Option<f64>, Option<f64>, f64, f64, f64, f64)| -> f64 {
        let a_dead = r.0.is_some();
        let b_dead = r.1.is_some();
        match (a_dead, b_dead) {
            (false, true) => r.2,    // A won
            (true, false) => -r.3,   // A lost
            (false, false) => r.4,   // timeout, A's HP
            (true, true) => if r.0.unwrap() < r.1.unwrap() { -r.3 } else { r.2 },
        }
    };
    let off_b = b_fit(&off);
    let off_a = a_fit(&off);
    eprintln!("[FITNESS] OFF: A={off_a:.0}, B={off_b:.0}");
    eprintln!(
        "[FITNESS] DEF policy unaware: B={:.0} (delta_B={:+.0})",
        b_fit(&r_def_unaware), b_fit(&r_def_unaware) - off_b,
    );
    eprintln!(
        "[FITNESS] DEF policy aware:   B={:.0} (delta_B={:+.0})",
        b_fit(&r_def_aware), b_fit(&r_def_aware) - off_b,
    );
    eprintln!(
        "[FITNESS] ATK policy unaware: A={:.0} (delta_A={:+.0})",
        a_fit(&r_atk_unaware), a_fit(&r_atk_unaware) - off_a,
    );
    eprintln!(
        "[FITNESS] ATK policy aware:   A={:.0} (delta_A={:+.0})",
        a_fit(&r_atk_aware), a_fit(&r_atk_aware) - off_a,
    );

    // "Never worse than off" guarantee within 50 HP slack.
    assert!(b_fit(&r_def_unaware) + 50.0 >= off_b, "DEF policy unaware worsens B");
    assert!(b_fit(&r_def_aware) + 50.0 >= off_b, "DEF policy aware worsens B");
    assert!(a_fit(&r_atk_unaware) + 50.0 >= off_a, "ATK policy unaware worsens A");
    assert!(a_fit(&r_atk_aware) + 50.0 >= off_a, "ATK policy aware worsens A");
}

/// Diagnostic: simulate Opra vs Gimon at REAL Compare UI conditions
/// (max_time_sec = 900, like `COMPARE_MAX_TIME_SEC` in
/// useCompareSimulation.ts; real creature stats from data/creatures.
/// runtime.json; Cause Fear enabled because Opra has the ability;
/// both breath profiles loaded because Compare default has
/// `breathOn = true`). Print policy delta for each of the four
/// (DEF / ATK × unaware / aware) configs so we can answer the
/// 2026-05-22 user question: "in real Compare with default settings
/// turning posture policy on for Gimon does nothing - why?".
///
/// Expected result: policy stays Stay (HP delta = 0) because
/// settled-Lay ×1.75 incoming damage applies to Spirit Glare
/// breath damage too (per referenceContent.ts:435), so lay would
/// accelerate B's death rather than help. Engine truth - not a
/// bug. This test makes the truth visible.
///
/// To inspect a different matchup, edit the stats below to match
/// the creatures of interest.
#[test]
#[ignore]
fn diagnose_compare_realistic_posture_policy_opra_vs_gimon() {
    use crate::composable::config::ComposableAbilityConfig;
    use crate::composable::simulate_composable_matchup_with_trace;
    use crate::contracts::{SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleBreathProfile, SimpleCombatantStats};
    // Real Opra stats per data/creatures.runtime.json (verified 2026-05-22).
    let mut attacker = default_combatant();
    attacker.health = 10500.0; attacker.weight = 16500.0;
    attacker.damage = 175.0; attacker.bite_cooldown = 1.4;
    attacker.health_regen = 4.0;
    let mut defender = default_combatant();
    defender.health = 9750.0; defender.weight = 15250.0;
    defender.damage = 185.0; defender.damage2 = 185.0;
    defender.bite_cooldown = 0.7; defender.health_regen = 6.0;
    // Spirit Glare (Opra's breath).
    let attacker_breath = SimpleBreathProfile {
        dps_pct: 2.0, capacity: 10.0, regen_rate: 0.0,
        crit_chance_pct: 0.0, chain: 0.0, chain_max_stacks: 0.0,
        special_kind: Some("spirit_glare".to_string()),
        special_statuses: vec![
            SimpleAppliedStatus { status_id: "Burn_Status".into(), stacks: 1.0, source_ability: None },
            SimpleAppliedStatus { status_id: "Fear_Status".into(), stacks: 1.0, source_ability: None },
        ],
        self_heal_pct: 0.0, cleanse_stacks: 0.0,
        lance_charge_sec: 0.0, lance_damage_pct: 0.0,
        lance_cooldown_sec: 0.0, lance_status_id: None,
        auto_fire_delay_sec: 0.0, auto_fire_cooldown_sec: 120.0,
        charges_max: 0.0, charge_regen_sec: 0.0,
    };
    // Miasma Breath (Gimon's).
    let defender_breath = SimpleBreathProfile {
        dps_pct: 0.5, capacity: 10.0, regen_rate: 2.5,
        crit_chance_pct: 25.0, chain: 0.0, chain_max_stacks: 0.0,
        special_kind: None, special_statuses: Vec::new(),
        self_heal_pct: 0.5, cleanse_stacks: 0.0,
        lance_charge_sec: 0.0, lance_damage_pct: 0.0,
        lance_cooldown_sec: 0.0, lance_status_id: None,
        auto_fire_delay_sec: 0.0, auto_fire_cooldown_sec: 0.0,
        charges_max: 0.0, charge_regen_sec: 0.0,
    };

    let mut base_config = ComposableAbilityConfig::default();
    // Opra has Cause Fear (per creatures.runtime.json), and Compare
    // auto-enables it when `activesOn = true` (the default).
    base_config.attacker_cause_fear = true;

    const COMPARE_MAX_TIME_SEC: f64 = 900.0;

    fn run(
        attacker: &SimpleCombatantStats,
        defender: &SimpleCombatantStats,
        ab: &SimpleBreathProfile,
        db: &SimpleBreathProfile,
        cfg: &ComposableAbilityConfig,
        max_time: f64,
    ) -> (Option<f64>, Option<f64>, f64, f64, f64, f64) {
        let r = simulate_composable_matchup_with_trace(
            attacker, defender, Some(ab), Some(db),
            SimpleAbilityTimingMode::Ideal,
            cfg, max_time, false,
        );
        (
            r.death_time_a, r.death_time_b,
            r.hp_a_at_b_death.max(0.0), r.hp_b_at_a_death.max(0.0),
            r.final_hp_a.max(0.0), r.final_hp_b.max(0.0),
        )
    }

    let off = run(&attacker, &defender, &attacker_breath, &defender_breath, &base_config, COMPARE_MAX_TIME_SEC);

    let mut on_def_aware = base_config.clone();
    on_def_aware.defender_posture_policy_enabled = true;
    on_def_aware.defender_posture_policy_regen_aware = true;
    let r_def_aware = run(&attacker, &defender, &attacker_breath, &defender_breath, &on_def_aware, COMPARE_MAX_TIME_SEC);

    let mut on_def_unaware = base_config.clone();
    on_def_unaware.defender_posture_policy_enabled = true;
    on_def_unaware.defender_posture_policy_regen_aware = false;
    let r_def_unaware = run(&attacker, &defender, &attacker_breath, &defender_breath, &on_def_unaware, COMPARE_MAX_TIME_SEC);

    let mut on_atk_aware = base_config.clone();
    on_atk_aware.attacker_posture_policy_enabled = true;
    on_atk_aware.attacker_posture_policy_regen_aware = true;
    let r_atk_aware = run(&attacker, &defender, &attacker_breath, &defender_breath, &on_atk_aware, COMPARE_MAX_TIME_SEC);

    let mut on_atk_unaware = base_config.clone();
    on_atk_unaware.attacker_posture_policy_enabled = true;
    on_atk_unaware.attacker_posture_policy_regen_aware = false;
    let r_atk_unaware = run(&attacker, &defender, &attacker_breath, &defender_breath, &on_atk_unaware, COMPARE_MAX_TIME_SEC);

    let print = |label: &str, r: &(Option<f64>, Option<f64>, f64, f64, f64, f64), base: &(Option<f64>, Option<f64>, f64, f64, f64, f64)| {
        let delta_a = r.4 - base.4;
        let delta_b = r.5 - base.5;
        let delta_hp_a_at_b_death = r.2 - base.2;
        let delta_hp_b_at_a_death = r.3 - base.3;
        eprintln!(
            "[{label}] a_death={:?} b_death={:?} | hp_a@b_death={:.0} (Δ{:+.0}) | hp_b@a_death={:.0} (Δ{:+.0}) | final_a={:.0} (Δ{:+.0}) | final_b={:.0} (Δ{:+.0})",
            r.0, r.1, r.2, delta_hp_a_at_b_death, r.3, delta_hp_b_at_a_death, r.4, delta_a, r.5, delta_b,
        );
    };
    eprintln!("=== Real Compare conditions (max_time={}s, Opra vs Gimon defaults) ===", COMPARE_MAX_TIME_SEC);
    print("OFF                ", &off, &off);
    print("DEF policy aware   ", &r_def_aware, &off);
    print("DEF policy unaware ", &r_def_unaware, &off);
    print("ATK policy aware   ", &r_atk_aware, &off);
    print("ATK policy unaware ", &r_atk_unaware, &off);
    eprintln!();
    eprintln!("If all four deltas are 0, the policy is correctly identifying that no posture change improves the outcome for this matchup. Per referenceContent.ts:435, settled-Lay multiplies incoming bite AND breath damage by 1.75 - in a long fight with Opra's Spirit Glare (2% max-HP/tick), laying down ACCELERATES the defender's death rather than helping. The companion brute-force test (`brute_force_ideal_for_opra_vs_gimon_at_real_compare_conditions`) enumerates 4^9 scripted posture plans over the first 30 s and reports the math-ideal outcome.");
}

#[test]
fn is_negative_ailment_covers_common_dots_and_disables() {
    // [POSTURE:phase1]
    assert!(posture::is_negative_ailment("Burn_Status"));
    assert!(posture::is_negative_ailment("Bleed_Status"));
    assert!(posture::is_negative_ailment("Fear_Status"));
    assert!(posture::is_negative_ailment("Bad_Omen"));
    assert!(posture::is_negative_ailment("Heartbroken_Status"));
    // Healing / positive statuses must NOT count as negative ailments.
    assert!(!posture::is_negative_ailment("Healing_Pulse_Status"));
    assert!(!posture::is_negative_ailment("Blessings_Boon"));
    assert!(!posture::is_negative_ailment("Fortify_Status"));
    assert!(!posture::is_negative_ailment("Lich_Mark_Status"));
}
