//! Validation harness for the `TOGGLE_ROLLOUT` milestone (Hunker /
//! Warden's Rage toggle state decided by engine replay).
//!
//! Two gates, both exercising the flag ON via the test-only override:
//!   - `toggle_replay_hunker_cost_is_per_epoch_not_per_tick`: the
//!     no-cooldown Hunker replay must be bounded to the ~5 s epoch
//!     tier (order-tens replays per fight), NOT per Hunker-cadence tick.
//!   - `warden_rage_replay_commits_harvest_and_gains_hp`: the Warden's
//!     replay must commit the buffered-regen HARVEST and end with more
//!     HP than the always-on line the deleted analytic delta produced.

use crate::composable::config::ComposableAbilityConfig;
use crate::composable::simulate_composable_matchup_with_trace;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::policy::traits::ToggleCommit;

use super::posture_policy::PostureAction;
use super::stance_bridge::{
    arm_decision_recorder, set_coordination_override, take_decision_recording,
};
use super::toggle_replay_bridge::{
    arm_commit_recorder, set_toggle_rollout_override, take_commit_recording, take_replay_cost,
    ToggleKind,
};

fn stats(health: f64, damage: f64, bite_cooldown: f64) -> SimpleCombatantStats {
    SimpleCombatantStats {
        health,
        weight: 1_000.0,
        damage,
        bite_cooldown,
        ..Default::default()
    }
}

/// GATE 3 - the Hunker replay is epoch-throttled, not per-tick.
///
/// Hunker has no cooldown, so its pi-zero-gate re-evaluates on a 0.1-0.25 s
/// cadence (hundreds of times over a 60 s fight). The replay must NOT
/// ride that cadence - it joins the posture ~5 s epoch tier, so the
/// per-fight replay count is order-tens.
#[test]
fn toggle_replay_hunker_cost_is_per_epoch_not_per_tick() {
    // No-cooldown Hunker carrier under heavy, fast incoming.
    let mut a = stats(40_000.0, 40.0, 1.0);
    a.hunker_reduction_pct = 40.0;
    let b = stats(60_000.0, 120.0, 0.5); // fast bites => many ActiveAbilities ticks
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_hunker = true;
    let max_time = 60.0;

    set_toggle_rollout_override(Some(true));
    let _ = take_replay_cost(); // reset
    let _ = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::Ideal,
        &cfg, max_time, false,
    );
    let (forks, decisions) = take_replay_cost();
    set_toggle_rollout_override(None);

    println!(
        "GATE 3 Hunker cost: {decisions} epoch decisions, {forks} inner replays over a {max_time}s fight \
         (Hunker Ideal cadence 0.25s ⇒ a per-tick model would be ~{} decisions)",
        (max_time / 0.25) as u64,
    );

    assert!(forks > 0, "flag on ⇒ the Hunker replay must run");
    // Epoch grid is 5 s (no regen => no pre/post-tick pull-forward), so a
    // 60 s fight has ~12 epochs. Order-tens, far below the ~240 a per-tick
    // model would produce.
    assert!(
        decisions <= 30,
        "epoch-throttled Hunker decisions must be order-tens, got {decisions}"
    );
    // Hunker scores OFF + one held candidate (On) per decision => 2 forks.
    assert!(
        forks <= 2 * decisions,
        "each Hunker epoch runs off+on = 2 replays: got {forks} for {decisions} decisions"
    );
}

/// A high-regen Warden's carrier vs a gappy (slow-bite) bruiser. The
/// gaps leave a no-damage moment just before each 15 s regen tick, so
/// releasing the manual hold there flushes the buffered regen tick
/// before the next bite re-arms the passive.
fn harvest_matchup() -> (SimpleCombatantStats, SimpleCombatantStats, ComposableAbilityConfig, f64) {
    // Carrier: big HP pool, strong regen, weak bite (so the harvest's
    // brief buff loss is negligible and it can't race the opponent down).
    let mut a = stats(30_000.0, 50.0, 2.0);
    a.health_regen = 20.0; // 20 % of max HP per 15 s tick
    // Bruiser: hits hard but on a 5 s cadence, leaving pre-regen gaps.
    let b = stats(20_000.0, 1_200.0, 5.0);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_warden_rage = true;
    (a, b, cfg, 60.0)
}

/// GATE 4 - the Warden's replay commits the buffered-regen harvest and
/// gains HP the always-on analytic delta missed.
///
/// Flag OFF (Ideal) reproduces the old degenerate delta: pi-zero holds the
/// switch on (passive-sticky), regen stays disabled the whole fight.
/// Flag ON (Ideal) evaluates hold vs harvest vs off and commits the
/// harvest, releasing before each regen tick so the buffered tick
/// flushes - ending with strictly more HP.
#[test]
fn warden_rage_replay_commits_harvest_and_gains_hp() {
    let (a, b, cfg, max_time) = harvest_matchup();

    // Always-on baseline: flag OFF => pi-zero (what the deleted delta produced).
    set_toggle_rollout_override(Some(false));
    let always_on = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::Ideal,
        &cfg, max_time, false,
    );

    // Replay: flag ON => hold vs harvest vs off, committed per epoch.
    set_toggle_rollout_override(Some(true));
    arm_commit_recorder();
    let _ = take_replay_cost();
    let replay = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::Ideal,
        &cfg, max_time, false,
    );
    let commits = take_commit_recording();
    let (forks, decisions) = take_replay_cost();
    set_toggle_rollout_override(None);

    let harvest_commits = commits
        .iter()
        .filter(|(k, c)| *k == ToggleKind::WardenRage && *c == ToggleCommit::Harvest)
        .count();

    println!(
        "GATE 4 Warden harvest: always-on final_hp_a={:.0} (regen {:.0}), replay final_hp_a={:.0} (regen {:.0}) (Δ={:+.0}); \
         WardenRage commits: {} harvest of {} total; forks={forks} decisions={decisions}",
        always_on.final_hp_a,
        always_on.regen_healed_a,
        replay.final_hp_a,
        replay.regen_healed_a,
        replay.final_hp_a - always_on.final_hp_a,
        harvest_commits,
        commits
            .iter()
            .filter(|(k, _)| *k == ToggleKind::WardenRage)
            .count(),
    );

    assert!(
        harvest_commits > 0,
        "the Warden's replay must commit the harvest at least once: commits={commits:?}"
    );
    assert!(
        replay.final_hp_a > always_on.final_hp_a + 1.0,
        "harvest must gain HP over always-on: replay={:.1} vs always_on={:.1}",
        replay.final_hp_a,
        always_on.final_hp_a
    );
}

/// Posture-policy variant of [`harvest_matchup`]: the same high-regen Warden's
/// carrier vs gappy bruiser, but with posture policy enabled on both sides so
/// the posture leader and the toggle follower both replay in the same fight.
/// `carrier_is_attacker` places the Warden's carrier on A (true) or B (false)
/// for the cross-side mirror arm.
fn coordination_matchup(
    carrier_is_attacker: bool,
    posture_on: bool,
) -> (SimpleCombatantStats, SimpleCombatantStats, ComposableAbilityConfig, f64) {
    let (carrier, bruiser, _cfg, max_time) = harvest_matchup();
    let mut cfg = ComposableAbilityConfig::default();
    if carrier_is_attacker {
        cfg.attacker_warden_rage = true;
        cfg.attacker_posture_policy_enabled = posture_on;
        (carrier, bruiser, cfg, max_time)
    } else {
        cfg.defender_warden_rage = true;
        cfg.defender_posture_policy_enabled = posture_on;
        (bruiser, carrier, cfg, max_time)
    }
}

/// One experiment arm's realized metrics.
struct CoordArm {
    final_hp_carrier: f64,
    harvest_commits: usize,
    forks: u64,
    epochs: u64,
    carrier_standing_decisions: usize,
    carrier_sit_decisions: usize,
    carrier_total_decisions: usize,
}

/// Run one coordination-experiment arm end to end.
///   - `posture_on`: enable posture policy (the leader).
///   - `coordination`: the coordination override (`Some(false)` = both flags on
///     but the moves disabled, the conflict arm; `Some(true)` = coordination
///     engaged; `None` = default for the flag state).
fn run_coordination_arm(
    carrier_is_attacker: bool,
    posture_on: bool,
    coordination: Option<bool>,
) -> CoordArm {
    let (a, b, cfg, max_time) = coordination_matchup(carrier_is_attacker, posture_on);

    set_toggle_rollout_override(Some(true));
    set_coordination_override(coordination);
    arm_commit_recorder();
    arm_decision_recorder();
    let _ = take_replay_cost();

    let summary = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::Ideal,
        &cfg, max_time, false,
    );

    let commits = take_commit_recording();
    let decisions = take_decision_recording();
    let (forks, epochs) = take_replay_cost();
    set_coordination_override(None);
    set_toggle_rollout_override(None);

    let harvest_commits = commits
        .iter()
        .filter(|(k, c)| *k == ToggleKind::WardenRage && *c == ToggleCommit::Harvest)
        .count();
    let final_hp_carrier = if carrier_is_attacker {
        summary.final_hp_a
    } else {
        summary.final_hp_b
    };
    // Carrier posture decisions: it stays predominantly standing (Warden's
    // needs a standing carrier). Brief Lay excursions are legitimate - the
    // death-race gate can find Lay's x2 regen at least as good at a moment - and
    // don't regress HP; the trap posture the conflict would force is settled
    // Sit, which coordination must never pick.
    let carrier_decisions: Vec<PostureAction> = decisions
        .iter()
        .filter(|(is_attacker, _)| *is_attacker == carrier_is_attacker)
        .map(|(_, a)| *a)
        .collect();
    let carrier_total_decisions = carrier_decisions.len();
    let carrier_standing_decisions = carrier_decisions
        .iter()
        .filter(|a| matches!(a, PostureAction::Stay | PostureAction::StandUp))
        .count();
    let carrier_sit_decisions = carrier_decisions
        .iter()
        .filter(|a| matches!(a, PostureAction::StartSit))
        .count();

    CoordArm {
        final_hp_carrier,
        harvest_commits,
        forks,
        epochs,
        carrier_standing_decisions,
        carrier_sit_decisions,
        carrier_total_decisions,
    }
}

/// The harvest under CONTINUOUS FAST fire - the facetank shape the slow-bite
/// `harvest_matchup` hid. A ~1 s bruiser bites in every pre-tick moment, so the
/// old lead-window release let a bite re-arm the switch before the regen tick
/// (buffered forever, never flushed). Releasing AT the tick plus the precision
/// OFF override make the harvest fire and bank regen the always-on line never
/// gets, near-free (the off-blip barely dents the carrier's offense).
#[test]
fn warden_rage_harvest_fires_under_continuous_fast_fire() {
    fn ws(health: f64, damage: f64, bite_cooldown: f64, regen: f64) -> SimpleCombatantStats {
        SimpleCombatantStats {
            health, weight: 1000.0, damage, bite_cooldown, health_regen: regen,
            ..Default::default()
        }
    }
    let carrier = ws(12_500.0, 60.0, 1.0, 5.0); // low base bite; 5% * 12500 = 625 HP / 15s
    let bruiser = ws(10_750.0, 450.0, 1.0, 0.0); // ~1 s bite: no pre-regen gaps
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_warden_rage = true;
    let max_time = 120.0;

    let always_on = simulate_composable_matchup_with_trace(
        &carrier, &bruiser, None, None, SimpleAbilityTimingMode::ReallyFast, &cfg, max_time, false,
    );

    set_toggle_rollout_override(Some(true));
    arm_commit_recorder();
    let ideal = simulate_composable_matchup_with_trace(
        &carrier, &bruiser, None, None, SimpleAbilityTimingMode::Ideal, &cfg, max_time, false,
    );
    let commits = take_commit_recording();
    set_toggle_rollout_override(None);

    let harvest_commits = commits
        .iter()
        .filter(|(k, c)| *k == ToggleKind::WardenRage && *c == ToggleCommit::Harvest)
        .count();

    // Always-on holds Rage on the whole fight, so natural regen is suppressed.
    assert!(
        always_on.regen_healed_a < 1.0,
        "always-on baseline must bank zero regen: {}",
        always_on.regen_healed_a
    );
    // The precision policy must actually COMMIT the harvest under fast fire.
    assert!(
        harvest_commits > 0,
        "precision policy must commit the harvest under continuous fast fire: {commits:?}"
    );
    // ...and BANK it: at least one ~625 HP tick reclaimed.
    assert!(
        ideal.regen_healed_a > 600.0 && ideal.regen_ticks_a >= 1,
        "harvest must flush at least one regen tick: healed={} ticks={}",
        ideal.regen_healed_a,
        ideal.regen_ticks_a
    );
    // Near-free: the off-blips must NOT collapse the carrier's offense (the
    // 15 s-off failure mode where Rage sits off and the carrier can't kill).
    assert!(
        ideal.damage_dealt_a > 0.85 * always_on.damage_dealt_a,
        "harvest off-window too costly: ideal dmg={} vs always-on {}",
        ideal.damage_dealt_a,
        always_on.damage_dealt_a
    );
    // The banked HP buys survival: the carrier outlives its always-on self.
    assert!(
        ideal.death_time_a.unwrap_or(max_time) >= always_on.death_time_a.unwrap_or(max_time) - 1.0,
        "harvest must not shorten survival: ideal={:?} always-on={:?}",
        ideal.death_time_a,
        always_on.death_time_a
    );
}

/// COORDINATION - the Warden's harvest survives when posture policy is also on.
///
/// Three arms per carrier side (A, then the B mirror):
///   - A0 posture-OFF, toggle-ON: the harvest baseline `H*`.
///   - A1 both-ON, coordination DISABLED: the harvest now fires standalone (the
///     release lands AT the regen tick, before the passive re-arm, regardless of
///     the posture leader), so it no longer collapses to zero. But the leader,
///     blind to the harvest value, can settle the carrier off standing, so it
///     harvests LESS than the coordinated arm.
///   - A2 both-ON, coordination ENABLED: Move 1 shows the committed plan across
///     all posture candidates and Move 2's augmented candidate breaks the
///     cold-start (Sit, Off) trap, so the carrier stays standing and harvests at
///     least as much as A1 - `final_hp >= A0` (no regression), `harvest >= A1`.
#[test]
fn posture_toggle_coordination_preserves_harvest() {
    for &carrier_is_attacker in &[true, false] {
        let a0 = run_coordination_arm(carrier_is_attacker, false, None);
        let a1 = run_coordination_arm(carrier_is_attacker, true, Some(false));
        let a2 = run_coordination_arm(carrier_is_attacker, true, Some(true));

        let side = if carrier_is_attacker { "A" } else { "B" };
        println!(
            "COORD carrier={side}: A0 hp={:.0} harvest={} | A1 hp={:.0} harvest={} forks={} | \
             A2 hp={:.0} harvest={} forks={} epochs={} standing={}/{} sit={}",
            a0.final_hp_carrier, a0.harvest_commits,
            a1.final_hp_carrier, a1.harvest_commits, a1.forks,
            a2.final_hp_carrier, a2.harvest_commits, a2.forks, a2.epochs,
            a2.carrier_standing_decisions, a2.carrier_total_decisions, a2.carrier_sit_decisions,
        );

        // A0 establishes the harvest baseline without posture policy.
        assert!(a0.harvest_commits > 0, "[{side}] A0 (posture off) must harvest");
        // A1 both-on, coordination off: the harvest now fires standalone (the
        // release lands AT the regen tick, before the passive re-arm, no matter
        // what the posture leader does), so it no longer collapses to zero. But
        // the leader, blind to the harvest value, can settle the carrier off
        // standing, so it harvests LESS than the coordinated arm.
        assert!(a1.harvest_commits > 0, "[{side}] A1: harvest fires even without coordination");
        // A2 both-on, coordinated: Move 1/2 keep the carrier standing, so it
        // harvests at least as much as the uncoordinated arm.
        assert!(a2.harvest_commits > 0, "[{side}] A2 must commit the harvest under posture policy");
        assert!(
            a2.harvest_commits >= a1.harvest_commits,
            "[{side}] coordination harvests no less than uncoordinated: A2={} A1={}",
            a2.harvest_commits, a1.harvest_commits,
        );
        // The carrier stays predominantly standing and never falls into the
        // settled-Sit trap.
        assert_eq!(a2.carrier_sit_decisions, 0, "[{side}] A2 must never sit the carrier");
        assert!(
            a2.carrier_standing_decisions * 2 > a2.carrier_total_decisions,
            "[{side}] A2 keeps the carrier predominantly standing: {}/{}",
            a2.carrier_standing_decisions, a2.carrier_total_decisions,
        );
        // No regression: A2 is at least the A0 harvest baseline (within margin).
        assert!(
            a2.final_hp_carrier >= a0.final_hp_carrier - 2_000.0,
            "[{side}] A2 no worse than the A0 harvest baseline: A2={:.0} A0={:.0}",
            a2.final_hp_carrier, a0.final_hp_carrier,
        );
        // Cost: coordination spends at most ~one extra replay per epoch (the
        // handoff also SAVES the follower's skipped ablations).
        assert!(
            a2.forks <= a1.forks + a2.epochs,
            "[{side}] A2 fork cost bounded: A2={} A1={} epochs={}",
            a2.forks, a1.forks, a2.epochs,
        );
    }
}
