//! Posture policy LOCAL DIAGNOSTIC — math-ideal benchmark vs current policy.
//!
//! Not part of CI (test is `#[ignore]`-marked). Run via:
//!
//! ```text
//! cargo test --lib --manifest-path "C:\Users\Tuma\Desktop\My_Project\COS_calc\wasm-engine\Cargo.toml" \
//!     composable::posture_benchmark -- --ignored --nocapture
//! ```
//!
//! For each of N diverse scenarios, this module runs three simulations:
//!
//! 1. **off**   — `posture_policy_enabled = false`, no scripted postures.
//! 2. **policy** — current `decide_via_replay` policy enabled.
//! 3. **ideal** — beam-search-best scripted posture timeline, found by
//!    enumerating candidate sequences at all decision points and picking
//!    the one that maximises end-state fitness.
//!
//! Fitness function (matches `decide_via_replay`):
//! - If SELF survived: `self.hp` (higher = better; rewards both
//!   damage dealt and good mitigation, since opp dying sooner means
//!   less reciprocal damage on us).
//! - If SELF died: `-opp.hp` (less wounded opp = worse; rewards leaving
//!   the opp as low as possible before death).
//!
//! The report prints per-scenario gap between `policy` and `ideal` — the
//! diagnostic signal for where the policy systematically under-performs.

use std::collections::BTreeMap;

use crate::contracts::{
    CombatLogEntry, SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats,
    SimpleStatusInstance,
};

use super::config::ComposableAbilityConfig;
use super::loop_iter::{
    run_one_event_loop_iter, IterHooks, LoopOutcome, LoopParams, LoopState, PosturePolicyMode,
};
use super::posture::{request_posture_transition, Posture};
use super::posture_policy::PostureAction;
use super::setup::populate_combat_sides_and_flags;
use super::side::CombatSide;
use super::{DamageCounters, FortifySimulationControl, OrderedEventPhase};

// =========================================================================
// Default event phase order — same as `DEFAULT_ORDERED_EVENT_PHASES` in
// mod.rs. Repeated here to avoid pub-export gymnastics.
// =========================================================================
fn default_event_phase_order() -> Vec<OrderedEventPhase> {
    vec![
        OrderedEventPhase::StatusDecay,
        OrderedEventPhase::ActiveAbilities,
        OrderedEventPhase::Regen,
        OrderedEventPhase::Bite,
        OrderedEventPhase::StatusTicks,
        OrderedEventPhase::Breath,
    ]
}

// =========================================================================
// Apply a posture action to a clone side (used by scripted simulation
// AND by brute-force / beam-search enumeration).
// =========================================================================
fn apply_posture_action(side: &mut CombatSide, action: PostureAction, time: f64) {
    let mut throwaway: Vec<CombatLogEntry> = Vec::new();
    match action {
        PostureAction::Stay => {}
        PostureAction::StartSit => {
            request_posture_transition(side, Posture::Sitting, time, &mut throwaway, false, "");
        }
        PostureAction::StartLay => {
            request_posture_transition(side, Posture::Laying, time, &mut throwaway, false, "");
        }
        PostureAction::StandUp => {
            request_posture_transition(side, Posture::Standing, time, &mut throwaway, false, "");
        }
    }
}

// =========================================================================
// Fitness — user-spec formula.
// =========================================================================
fn compute_fitness(state: &LoopState, self_is_attacker: bool) -> f64 {
    // Mirrors `posture_policy::compute_replay_fitness` so policy and
    // benchmark use the SAME formula (per the
    // `policy sim fitness must match benchmark` rule). Updated
    // 2026-05-22 (twice):
    //   - First update: consider death timestamps for the both-dead
    //     case so outliving opp counts as a win even if I also die.
    //   - Second update: use opp_hp_at_my_death (state.hp_a_at_b_death
    //     / state.hp_b_at_a_death) instead of FINAL opp HP in the
    //     "lost the trade" branch. Final opp HP collapses to 0 when
    //     opp eventually dies, erasing the signal between "opp had
    //     1792 HP when I died" vs "opp had 976 HP when I died". The
    //     Kendyll vs Goreganthus diagnostic surfaced this — both
    //     trajectories scored identical 0 in the old formula even
    //     though the second is a clearly better trade. See
    //     `posture_policy::compute_replay_fitness` for the full
    //     rationale.
    let (self_side, opp_side, opp_hp_at_my_death) = if self_is_attacker {
        (&state.a, &state.b, state.hp_b_at_a_death)
    } else {
        (&state.b, &state.a, state.hp_a_at_b_death)
    };
    match (self_side.death_time, opp_side.death_time) {
        // Mirror of `compute_replay_fitness`: both-alive branch now
        // subtracts opp_hp so short-horizon simulations have a
        // damage-delta signal instead of collapsing all "both
        // alive" trajectories to my_hp. See the long-form rationale
        // in `composable::posture_policy::compute_replay_fitness`.
        (None, None) => self_side.hp.max(0.0) - opp_side.hp.max(0.0),
        (None, Some(_)) => self_side.hp.max(0.0) + 1.0,
        (Some(_), None) => -opp_side.hp.max(0.0),
        (Some(me_t), Some(op_t)) => {
            if me_t > op_t + 1e-9 {
                (me_t - op_t) + 1.0
            } else if op_t > me_t + 1e-9 {
                -opp_hp_at_my_death.unwrap_or(0.0).max(0.0)
            } else {
                0.0
            }
        }
    }
}

// =========================================================================
// Decision-time schedule: matches `schedule_next_posture_decision` in
// mod.rs (periodic 5 s + pre-tick lead 2 s + post-tick +1µs in regen-aware
// mode). Returns sorted, deduplicated decision times within [0, max_time].
// =========================================================================
fn decision_times(max_time: f64, regen_aware: bool) -> Vec<f64> {
    let mut times: Vec<f64> = Vec::new();
    let mut tick_moments: Vec<f64> = Vec::new();
    // Always compute tick moments — even in regen-unaware mode, Module A
    // can fire Lay at coincidental scheduler-event times that land in
    // its pre-tick window. Brute-force must include the same tick-
    // aligned decision points as candidates, otherwise the policy's
    // opportunistic Lay@(tick-2) appears strictly better than the
    // ideal trajectory (which lacks that decision point in its menu).
    let mut tick = 15.0_f64;
    while tick <= max_time + 1e-9 {
        tick_moments.push(tick);
        tick += 15.0;
    }
    let _ = regen_aware;
    // Periodic 5 s from t = 0. Skip those within 0.5 s of a tick —
    // pre/post-tick decisions land in those windows and a scripted
    // action exactly at tick-time would be applied BEFORE the iter
    // that processes the tick, mis-firing (e.g., Stand@15.0 cancels
    // the lay BEFORE regen-phase fires, losing the ×2 heal benefit).
    let mut t = 0.0_f64;
    while t < max_time + 1e-9 {
        let near_tick = tick_moments.iter().any(|&tk| (t - tk).abs() < 0.5);
        if !near_tick {
            times.push(t);
        }
        t += 5.0;
    }
    // ALWAYS add pre-tick and post-tick decision points, even in
    // regen-unaware mode. The policy's `schedule_next_posture_decision`
    // only schedules pre/post-tick when regen-aware, but Module A's
    // `decide` can still fire Lay at any decision moment whose
    // `time_to_tick` lands in [LAY_TRANSITION ± tolerance]. In
    // regen-unaware mode that happens by coincidence as periodic
    // decisions drift via state.time landing on scheduler events.
    // If brute-force doesn't include the tick-aligned candidates,
    // it can't replicate the policy's lucky-coincidence trajectory
    // and shows < 100 % capture even when policy is actually optimal
    // for that decision moment.
    //
    // Pre-tick at tick − LAY_TRANSITION_SEC (= 13, 28, …): lay
    // transition completes EXACTLY at tick → ×2 heal with zero
    // settled-before-tick damage penalty.
    //
    // Post-tick offsets: just-past-tick (0.001 s — applies at next
    // iter after tick) and tick + 1 s (lets brute-force explore
    // "stand later" alternatives when next bite timing favours it).
    for &tick in &tick_moments {
        let pre = tick - 2.0;
        if pre > 0.001 && pre < max_time {
            times.push(pre);
        }
        for offset in [0.001_f64, 1.0] {
            let post = tick + offset;
            if post < max_time + 1e-9 {
                times.push(post);
            }
        }
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    // Tightened dedup so post_tick (tick + 0.001) survives even when a
    // periodic at the same tick wasn't filtered out for any reason.
    times.dedup_by(|a, b| (*a - *b).abs() < 1.0e-5);
    times.retain(|&t| t <= max_time + 1e-9);
    times
}

// =========================================================================
// Scenario definition.
// =========================================================================
pub struct BenchmarkScenario {
    pub name: &'static str,
    pub attacker: SimpleCombatantStats,
    pub defender: SimpleCombatantStats,
    pub attacker_breath: Option<SimpleBreathProfile>,
    pub defender_breath: Option<SimpleBreathProfile>,
    pub config_overrides: Box<dyn Fn(&mut ComposableAbilityConfig)>,
    pub max_time_sec: f64,
    /// Override starting HP of attacker (None = full health).
    pub attacker_start_hp: Option<f64>,
    /// Override starting HP of defender.
    pub defender_start_hp: Option<f64>,
    /// Inject these statuses on attacker at t = 0 (status_id, instance).
    pub attacker_initial_statuses: Vec<(String, SimpleStatusInstance)>,
    /// Self side perspective: which physical slot is "self" (true = a / attacker).
    pub self_is_attacker: bool,
    /// Brute-force / beam decision times use regen-aware schedule.
    pub regen_aware: bool,
}

// =========================================================================
// Build initial LoopState from scenario, with stats / breath / config /
// flags fully populated. Returns state plus the flags struct (kept on the
// stack so refs into it remain valid).
// =========================================================================
fn build_initial_state(
    scenario: &BenchmarkScenario,
    config: &ComposableAbilityConfig,
) -> (LoopState, super::setup::ComposableLoopFlags) {
    let mut a = CombatSide::new(&scenario.attacker, scenario.attacker_breath.as_ref());
    let mut b = CombatSide::new(&scenario.defender, scenario.defender_breath.as_ref());
    let flags = populate_combat_sides_and_flags(
        &mut a, &mut b, &scenario.attacker, &scenario.defender,
        SimpleAbilityTimingMode::Fast, config,
    );
    if let Some(hp) = scenario.attacker_start_hp {
        a.hp = hp;
    }
    if let Some(hp) = scenario.defender_start_hp {
        b.hp = hp;
    }
    // Inject initial statuses on attacker. Used for Fear / Burn scenarios.
    for (key, inst) in &scenario.attacker_initial_statuses {
        a.statuses.insert(key.clone(), inst.clone());
    }
    let state = LoopState {
        a, b,
        combat_log: Vec::new(),
        counters: DamageCounters::default(),
        time: -1.0e-9,
        same_time_processed_phases: 0,
        user_iteration_index: 0,
        hp_a_at_b_death: None,
        hp_b_at_a_death: None,
        bite_count_a: 0, bite_count_b: 0,
        breath_tick_count_a: 0, breath_tick_count_b: 0,
        regen_ticks_a: 0, regen_ticks_b: 0,
        regen_healed_a: 0.0, regen_healed_b: 0.0,
        warden_rage_events_a: Vec::new(), warden_rage_events_b: Vec::new(),
        ability_timing_events_a: Vec::new(), ability_timing_events_b: Vec::new(),
        fortify_control: FortifySimulationControl::default(),
    };
    (state, flags)
}

// =========================================================================
// Simulate the scenario with a SCRIPTED posture timeline. Policy is OFF
// inside the loop (override = ForcedOff). Scripted actions are applied at
// the start of each iter when state.time >= scripted time.
// =========================================================================
fn simulate_with_scripted_postures(
    scenario: &BenchmarkScenario,
    config: &ComposableAbilityConfig,
    scripted_self: &[(f64, PostureAction)],
) -> f64 {
    let event_phase_order = default_event_phase_order();
    let (mut state, flags) = build_initial_state(scenario, config);
    let params = LoopParams {
        attacker: &scenario.attacker,
        defender: &scenario.defender,
        attacker_breath: scenario.attacker_breath.as_ref(),
        defender_breath: scenario.defender_breath.as_ref(),
        config,
        flags: &flags,
        ability_policy: SimpleAbilityTimingMode::Fast,
        event_phase_order: &event_phase_order,
        record_trace: false,
        max_time_sec: scenario.max_time_sec,
        bench_count: false,
        // Posture policy off — only scripted actions drive postures.
        posture_policy_override: PosturePolicyMode::ForcedOff,
        iter_hooks: IterHooks::default(),
        decide_override: None,
        decide_override_respects_schedule: false,
        decide_bite_variant_override: None,
    };
    let mut script_idx = 0usize;
    let mut iter_count = 0u32;
    while state.time <= scenario.max_time_sec
        && (state.a.death_time.is_none() || state.b.death_time.is_none())
        && iter_count < 50_000
    {
        // Apply any scripted self-postures whose time has passed.
        while script_idx < scripted_self.len() && state.time + 1e-9 >= scripted_self[script_idx].0 {
            let action = scripted_self[script_idx].1;
            let side = if scenario.self_is_attacker { &mut state.a } else { &mut state.b };
            apply_posture_action(side, action, state.time);
            script_idx += 1;
        }
        match run_one_event_loop_iter(&mut state, &params) {
            LoopOutcome::Break => break,
            LoopOutcome::Continue => {
                iter_count += 1;
                continue;
            }
            LoopOutcome::Advanced => { iter_count += 1; }
            LoopOutcome::BoundExceeded => break,
        }
    }
    compute_fitness(&state, scenario.self_is_attacker)
}

// =========================================================================
// Simulate with policy ON (current decide_via_replay-driven policy on the
// self-side; opponent policy off — opp stays standing).
// =========================================================================
fn simulate_policy_on(
    scenario: &BenchmarkScenario,
    base_config: &ComposableAbilityConfig,
) -> (f64, Vec<(f64, &'static str)>) {
    let mut config = base_config.clone();
    if scenario.self_is_attacker {
        config.attacker_posture_policy_enabled = true;
        config.attacker_posture_policy_regen_aware = scenario.regen_aware;
    } else {
        config.defender_posture_policy_enabled = true;
        config.defender_posture_policy_regen_aware = scenario.regen_aware;
    }
    let event_phase_order = default_event_phase_order();
    let (mut state, flags) = build_initial_state(scenario, &config);
    let params = LoopParams {
        attacker: &scenario.attacker,
        defender: &scenario.defender,
        attacker_breath: scenario.attacker_breath.as_ref(),
        defender_breath: scenario.defender_breath.as_ref(),
        config: &config,
        flags: &flags,
        ability_policy: SimpleAbilityTimingMode::Fast,
        event_phase_order: &event_phase_order,
        record_trace: true,
        max_time_sec: scenario.max_time_sec,
        bench_count: false,
        posture_policy_override: PosturePolicyMode::Normal,
        iter_hooks: IterHooks::default(),
        decide_override: None,
        decide_override_respects_schedule: false,
        decide_bite_variant_override: None,
    };
    let mut iter_count = 0u32;
    while state.time <= scenario.max_time_sec
        && (state.a.death_time.is_none() || state.b.death_time.is_none())
        && iter_count < 50_000
    {
        match run_one_event_loop_iter(&mut state, &params) {
            LoopOutcome::Break => break,
            LoopOutcome::Continue => {
                iter_count += 1;
                continue;
            }
            LoopOutcome::Advanced => { iter_count += 1; }
            LoopOutcome::BoundExceeded => break,
        }
    }
    let fitness = compute_fitness(&state, scenario.self_is_attacker);
    // Collect posture events from combat_log for the self-side.
    let self_label = if scenario.self_is_attacker { "A" } else { "B" };
    let mut events: Vec<(f64, &'static str)> = Vec::new();
    for entry in &state.combat_log {
        if entry.attacker != self_label {
            continue;
        }
        match entry.description.as_deref() {
            Some("Laying down") => events.push((entry.time, "Lay")),
            Some("Sitting down") => events.push((entry.time, "Sit")),
            Some("Stood up") => events.push((entry.time, "Stand")),
            _ => {}
        }
    }
    (fitness, events)
}

// =========================================================================
// Simulate with NO policy (off-mode baseline).
// =========================================================================
fn simulate_off(
    scenario: &BenchmarkScenario,
    base_config: &ComposableAbilityConfig,
) -> f64 {
    simulate_with_scripted_postures(scenario, base_config, &[])
}

// =========================================================================
// Simulate via decide_override — applies scripted actions INSIDE iter
// (after scheduler) instead of BEFORE iter. Matches policy's natural
// timing: scheduler may advance state.time mid-iter to e.g. 15.6,
// posture-policy block then fires the scripted action at that exact
// state.time. Eliminates the "scheduler skipped past script time"
// artifact that the pre-iter scripted application suffered.
//
// Enables policy on the test side (config flag) so the override
// callback actually fires. Opponent has policy off (per scenario).
// =========================================================================
fn simulate_via_decide_override(
    scenario: &BenchmarkScenario,
    base_config: &ComposableAbilityConfig,
    script: &[(f64, PostureAction)],
) -> f64 {
    let mut config = base_config.clone();
    if scenario.self_is_attacker {
        config.attacker_posture_policy_enabled = true;
    } else {
        config.defender_posture_policy_enabled = true;
    }
    let event_phase_order = default_event_phase_order();
    let (mut state, flags) = build_initial_state(scenario, &config);
    let cursor = std::cell::RefCell::new(0_usize);
    let self_is_attacker = scenario.self_is_attacker;
    let closure = |_a: &CombatSide, _b: &CombatSide, time: f64, is_attacker: bool| -> PostureAction {
        if is_attacker != self_is_attacker {
            return PostureAction::Stay;
        }
        let mut idx = cursor.borrow_mut();
        if *idx < script.len() && time + 1e-9 >= script[*idx].0 {
            let (_, action) = script[*idx];
            *idx += 1;
            return action;
        }
        PostureAction::Stay
    };
    let params = LoopParams {
        attacker: &scenario.attacker,
        defender: &scenario.defender,
        attacker_breath: scenario.attacker_breath.as_ref(),
        defender_breath: scenario.defender_breath.as_ref(),
        config: &config,
        flags: &flags,
        ability_policy: SimpleAbilityTimingMode::Fast,
        event_phase_order: &event_phase_order,
        record_trace: false,
        max_time_sec: scenario.max_time_sec,
        bench_count: false,
        posture_policy_override: PosturePolicyMode::Normal,
        iter_hooks: IterHooks::default(),
        decide_override: Some(&closure),
        decide_override_respects_schedule: false,
        decide_bite_variant_override: None,
    };
    let mut iter_count = 0u32;
    while state.time <= scenario.max_time_sec
        && (state.a.death_time.is_none() || state.b.death_time.is_none())
        && iter_count < 50_000
    {
        match run_one_event_loop_iter(&mut state, &params) {
            LoopOutcome::Break => break,
            LoopOutcome::Continue => {
                iter_count += 1;
                continue;
            }
            LoopOutcome::Advanced => { iter_count += 1; }
            LoopOutcome::BoundExceeded => break,
        }
    }
    compute_fitness(&state, scenario.self_is_attacker)
}

// =========================================================================
// Brute-force the truly-optimal posture script.
//
// Beam search proved unreliable: compound strategies (e.g., "Lay → catch
// tick → Stand right after") look catastrophic at the first decision
// because the partial script "[Lay@k]" without a Stand suffix means the
// side commits to laying for the rest of the fight, accruing a huge
// settled-state damage penalty. Beam=8 prunes such prefixes early so the
// good full compound never gets a chance. Switching to exhaustive
// 4^N-style enumeration (N = decision count) is feasible because each
// simulation is microsecond-fast in release; for 9-decision scenarios
// (max_time = 30 s) we evaluate 4^9 = 262 144 scripts in ~10-15 s.
// =========================================================================
fn brute_force_best_script(
    scenario: &BenchmarkScenario,
    base_config: &ComposableAbilityConfig,
) -> (f64, Vec<(f64, PostureAction)>) {
    let times = decision_times(scenario.max_time_sec, scenario.regen_aware);
    let n = times.len();
    let candidates: [PostureAction; 4] = [
        PostureAction::Stay,
        PostureAction::StartSit,
        PostureAction::StartLay,
        PostureAction::StandUp,
    ];
    assert!(n <= 12, "brute-force too expensive for {n} decisions; shorten scenario.max_time_sec");
    let total = 4_u64.pow(n as u32);
    let mut best_fitness = f64::NEG_INFINITY;
    let mut best_script: Vec<(f64, PostureAction)> = Vec::new();
    let mut script_buf: Vec<(f64, PostureAction)> = Vec::with_capacity(n);
    for combo in 0..total {
        script_buf.clear();
        let mut c = combo;
        for &t in &times {
            let action = candidates[(c & 3) as usize];
            script_buf.push((t, action));
            c >>= 2;
        }
        // Use decide_override (closure inside iter) instead of
        // pre-iter scripted apply — matches policy's natural timing.
        let fitness =
            simulate_via_decide_override(scenario, base_config, &script_buf);
        if fitness > best_fitness {
            best_fitness = fitness;
            best_script = script_buf.clone();
        }
    }
    (best_fitness, best_script)
}

// =========================================================================
// Beam-search ideal-finder for LONG fights (max_time_sec >> 30 s) where
// `brute_force_best_script`'s 4^N exhaustive search hits the n ≤ 12
// guard. Trades exhaustive coverage for tractable cost by keeping only
// the top-K scripts at each decision layer.
//
// Use case: measure how close the current policy is to the math ideal
// in REAL Compare conditions (max_time = 900 s, full Opra+Gimon stats
// with breath profiles + Cause Fear). The benchmark file's other
// scenarios use max_time = 30 s for tractable brute-force; they don't
// answer the question "what does the policy actually leave on the
// table in a 15-min Compare fight?".
//
// Cost: `max_decisions × beam_width × 4 × per-script-sim-cost`. For
// the typical knobs (max_decisions=30, beam_width=8, sim ≈ 3 ms in
// release) the search runs in ~3 s — slow but acceptable for one-off
// `#[ignore]`-marked diagnostic runs.
fn beam_search_best_script(
    scenario: &BenchmarkScenario,
    base_config: &ComposableAbilityConfig,
    beam_width: usize,
    max_decisions: usize,
) -> (f64, Vec<(f64, PostureAction)>) {
    let mut times = decision_times(scenario.max_time_sec, scenario.regen_aware);
    if times.len() > max_decisions {
        times.truncate(max_decisions);
    }
    let candidates: [PostureAction; 4] = [
        PostureAction::Stay,
        PostureAction::StartSit,
        PostureAction::StartLay,
        PostureAction::StandUp,
    ];
    let mut beam: Vec<(Vec<(f64, PostureAction)>, f64)> = vec![(Vec::new(), 0.0)];
    for &t in &times {
        let mut next_beam: Vec<(Vec<(f64, PostureAction)>, f64)> =
            Vec::with_capacity(beam.len() * candidates.len());
        for (prior_script, _) in &beam {
            for &action in &candidates {
                let mut script = prior_script.clone();
                script.push((t, action));
                let fitness = simulate_via_decide_override(scenario, base_config, &script);
                next_beam.push((script, fitness));
            }
        }
        next_beam.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        next_beam.truncate(beam_width);
        beam = next_beam;
    }
    beam.into_iter().next().map(|(s, f)| (f, s)).unwrap_or((f64::NEG_INFINITY, Vec::new()))
}

// =========================================================================
// Scenario builders.
// =========================================================================
fn default_combatant_local() -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: 1000.0, weight: 100.0, damage: 50.0, bite_cooldown: 2.0,
        damage2: 0.0, health_regen: 0.0,
        active_cooldown_multiplier: 1.0, quick_recovery_hp_ratio_threshold: 0.0,
        unbreakable_damage_cap_pct: 0.0, damage_taken_multiplier_on_being_bitten: 1.0,
        breath_resistance: 0.0, berserk_bite_cooldown_multiplier: 1.0,
        berserk_hp_ratio_threshold: 0.0, first_strike_pct: 0.0,
        first_strike_hp_ratio_threshold: 1.0, has_warden_resistance: false,
        has_reflect: false, immune_status_ids: vec![],
        hunker_reduction_pct: 0.0, self_destruct_profile: None,
        on_hit_statuses: vec![], on_hit_taken_statuses: vec![],
        starting_statuses: vec![], status_resist_fractions: BTreeMap::new(),
        plushie_status_block_fractions: BTreeMap::new(),
        plushie_reflect_avg_pct: 0.0, disabled_abilities: vec![],
        compare_air_rule_cooldown_sec: 0.0, user_ability_ids: Vec::new(), identity: None,
    }
}

/// Opralegion: T5, has Cause Fear (applies 10-stack Fear to opp at t=0,
/// then 120 s cooldown). Spirit Glare breath omitted for simplicity.
fn opralegion() -> SimpleCombatantStats {
    let mut s = default_combatant_local();
    s.health = 10500.0;
    s.weight = 16500.0;
    s.damage = 175.0;
    s.bite_cooldown = 1.4;
    s.health_regen = 4.0;
    s
}

/// Gimon-Ogu: T5. Double-damage bite (damage + damage2). Miasma Breath
/// omitted for simplicity.
fn gimon_ogu() -> SimpleCombatantStats {
    let mut s = default_combatant_local();
    s.health = 9750.0;
    s.weight = 15250.0;
    s.damage = 185.0;
    s.bite_cooldown = 0.7;
    s.damage2 = 185.0;
    s.health_regen = 6.0;
    s
}

fn korathos() -> SimpleCombatantStats {
    let mut s = default_combatant_local();
    s.health = 10750.0;
    s.weight = 50000.0;
    s.damage = 450.0;
    s.bite_cooldown = 1.0;
    s.health_regen = 4.0;
    s
}

fn golgaroth() -> SimpleCombatantStats {
    let mut s = default_combatant_local();
    s.health = 16000.0;
    s.weight = 42500.0;
    s.damage = 180.0;
    s.bite_cooldown = 1.2;
    s.health_regen = 4.0;
    s
}

fn tank() -> SimpleCombatantStats {
    let mut s = default_combatant_local();
    s.health = 30000.0;
    s.weight = 60000.0;
    s.damage = 100.0;
    s.bite_cooldown = 1.5;
    s.health_regen = 2.0;
    s
}

fn glass_cannon() -> SimpleCombatantStats {
    let mut s = default_combatant_local();
    s.health = 3000.0;
    s.weight = 8000.0;
    s.damage = 800.0;
    s.bite_cooldown = 0.7;
    s.health_regen = 1.0;
    s
}

fn fear_instance(stacks: f64, remaining: f64) -> SimpleStatusInstance {
    SimpleStatusInstance {
        stacks,
        next_tick_at: None,
        next_decay_at: Some(3.0),
        remaining_sec: remaining,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    }
}

fn burn_instance(stacks: f64, remaining: f64) -> SimpleStatusInstance {
    SimpleStatusInstance {
        stacks,
        next_tick_at: Some(3.0),
        next_decay_at: Some(3.0),
        remaining_sec: remaining,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    }
}

fn build_scenarios() -> Vec<BenchmarkScenario> {
    vec![
        BenchmarkScenario {
            name: "1. Korathos vs Golgaroth, vanilla (no regen buff)",
            attacker: korathos(),
            defender: golgaroth(),
            attacker_breath: None,
            defender_breath: None,
            config_overrides: Box::new(|_c| {}),
            max_time_sec: 30.0,
            attacker_start_hp: None,
            defender_start_hp: None,
            attacker_initial_statuses: Vec::new(),
            self_is_attacker: true,
            regen_aware: true,
        },
        BenchmarkScenario {
            name: "2. Korathos +200% regen vs Golgaroth",
            attacker: korathos(),
            defender: golgaroth(),
            attacker_breath: None,
            defender_breath: None,
            config_overrides: Box::new(|c| {
                c.attacker_compare_regen_bonus_pct = 200.0;
            }),
            max_time_sec: 30.0,
            attacker_start_hp: None,
            defender_start_hp: None,
            attacker_initial_statuses: Vec::new(),
            self_is_attacker: true,
            regen_aware: true,
        },
        BenchmarkScenario {
            name: "3. Korathos +200% mirror, opp fixed standing",
            attacker: korathos(),
            defender: korathos(),
            attacker_breath: None,
            defender_breath: None,
            config_overrides: Box::new(|c| {
                c.attacker_compare_regen_bonus_pct = 200.0;
                c.defender_compare_regen_bonus_pct = 200.0;
            }),
            max_time_sec: 30.0,
            attacker_start_hp: None,
            defender_start_hp: None,
            attacker_initial_statuses: Vec::new(),
            self_is_attacker: true,
            regen_aware: true,
        },
        BenchmarkScenario {
            name: "4. Wounded low-HP near tick (regen build)",
            attacker: {
                let mut s = korathos();
                s.health_regen = 8.0;
                s
            },
            defender: {
                let mut s = golgaroth();
                s.damage = 60.0;
                s
            },
            attacker_breath: None,
            defender_breath: None,
            config_overrides: Box::new(|_c| {}),
            max_time_sec: 30.0,
            attacker_start_hp: Some(2500.0),
            defender_start_hp: None,
            attacker_initial_statuses: Vec::new(),
            self_is_attacker: true,
            regen_aware: true,
        },
        BenchmarkScenario {
            name: "5. Suicide test: low HP, high opp DPS, tick far",
            attacker: {
                let mut s = korathos();
                s.health = 8000.0;
                s
            },
            defender: {
                let mut s = glass_cannon();
                s.damage = 1200.0;
                s.bite_cooldown = 0.6;
                s
            },
            attacker_breath: None,
            defender_breath: None,
            config_overrides: Box::new(|_c| {}),
            max_time_sec: 20.0,
            attacker_start_hp: Some(1500.0),
            defender_start_hp: None,
            attacker_initial_statuses: Vec::new(),
            self_is_attacker: true,
            regen_aware: true,
        },
        BenchmarkScenario {
            name: "6. Tank vs glass cannon (high opp burst)",
            attacker: tank(),
            defender: {
                let mut s = glass_cannon();
                s.damage = 1500.0;
                s
            },
            attacker_breath: None,
            defender_breath: None,
            config_overrides: Box::new(|_c| {}),
            max_time_sec: 30.0,
            attacker_start_hp: None,
            defender_start_hp: None,
            attacker_initial_statuses: Vec::new(),
            self_is_attacker: true,
            regen_aware: true,
        },
        BenchmarkScenario {
            name: "7. Korathos with Fear (10 stacks, ~30 s)",
            attacker: korathos(),
            defender: golgaroth(),
            attacker_breath: None,
            defender_breath: None,
            config_overrides: Box::new(|_c| {}),
            max_time_sec: 30.0,
            attacker_start_hp: None,
            defender_start_hp: None,
            attacker_initial_statuses: vec![
                ("Fear_Status".to_string(), fear_instance(10.0, 30.0)),
            ],
            self_is_attacker: true,
            regen_aware: true,
        },
        BenchmarkScenario {
            name: "8. Korathos with Burn (5 stacks DoT)",
            attacker: {
                let mut s = korathos();
                s.health_regen = 6.0;
                s
            },
            defender: golgaroth(),
            attacker_breath: None,
            defender_breath: None,
            config_overrides: Box::new(|_c| {}),
            max_time_sec: 30.0,
            attacker_start_hp: None,
            defender_start_hp: None,
            attacker_initial_statuses: vec![
                ("Burn_Status".to_string(), burn_instance(5.0, 30.0)),
            ],
            self_is_attacker: true,
            regen_aware: true,
        },
        // User-requested: Opralegion (Cause Fear) vs Gimon-Ogu.
        // Attacker = Opralegion → applies Fear@t=0 to defender (Gimon-Ogu).
        // `self_is_attacker = false` so we measure the defender's policy:
        // does it lay down to accelerate Fear decay (×4 lay decay-mult)
        // and recover offensive output (Fear cuts outgoing damage 50%)?
        //
        // Regen-unaware mode: Module A's `schedule_next_posture_decision`
        // skips pre/post-tick decision points. Decisions only fire at
        // periodic 5 s. Module A's pre-tick lay window is narrow (±0.6 s
        // around tick − 2 s) — periodic decisions almost never land in
        // it, so Module A will essentially never lay in regen-unaware
        // mode. If the ideal trajectory shows lay-for-fear-clear is
        // beneficial, the policy gap → "Module B (status decay) needed".
        BenchmarkScenario {
            name: "9. Opralegion vs Gimon-Ogu, defender regen-unaware (Fear from Cause Fear)",
            attacker: opralegion(),
            defender: gimon_ogu(),
            attacker_breath: None,
            defender_breath: None,
            config_overrides: Box::new(|c| {
                c.attacker_cause_fear = true;
                // Defender does NOT have Cause Fear.
            }),
            max_time_sec: 30.0,
            attacker_start_hp: None,
            defender_start_hp: None,
            attacker_initial_statuses: Vec::new(),
            self_is_attacker: false,
            regen_aware: false,
        },
        // Variant: same matchup but regen-aware. Lets us compare what
        // changes when the policy CAN schedule pre/post-tick decisions —
        // does it pick up the Fear-cleanup opportunity too, or only the
        // regen-tick benefit?
        BenchmarkScenario {
            name: "10. Opralegion vs Gimon-Ogu, defender regen-aware (Fear from Cause Fear)",
            attacker: opralegion(),
            defender: gimon_ogu(),
            attacker_breath: None,
            defender_breath: None,
            config_overrides: Box::new(|c| {
                c.attacker_cause_fear = true;
            }),
            max_time_sec: 30.0,
            attacker_start_hp: None,
            defender_start_hp: None,
            attacker_initial_statuses: Vec::new(),
            self_is_attacker: false,
            regen_aware: true,
        },
        // 2026-05-21 user question: when REAL Compare path includes
        // creature breath profiles, is laying still mathematically
        // optimal for the defender (Gimon)? Brute-force says yes in
        // scenarios 9/10 (no breath), but with Spirit Glare hitting
        // Gimon for ~2% max-HP per tick PLUS Fear / Burn applications,
        // the cost calculus shifts. These scenarios load the actual
        // Spirit Glare + Miasma Breath profiles to find the true
        // mathematical optimum under realistic-Compare conditions.
        BenchmarkScenario {
            name: "11. Opra vs Gimon with breath, defender regen-unaware",
            attacker: opralegion(),
            defender: gimon_ogu(),
            attacker_breath: Some(spirit_glare_breath()),
            defender_breath: Some(miasma_breath()),
            config_overrides: Box::new(|c| {
                c.attacker_cause_fear = true;
            }),
            max_time_sec: 30.0,
            attacker_start_hp: None,
            defender_start_hp: None,
            attacker_initial_statuses: Vec::new(),
            self_is_attacker: false,
            regen_aware: false,
        },
        BenchmarkScenario {
            name: "12. Opra vs Gimon with breath, defender regen-aware",
            attacker: opralegion(),
            defender: gimon_ogu(),
            attacker_breath: Some(spirit_glare_breath()),
            defender_breath: Some(miasma_breath()),
            config_overrides: Box::new(|c| {
                c.attacker_cause_fear = true;
            }),
            max_time_sec: 30.0,
            attacker_start_hp: None,
            defender_start_hp: None,
            attacker_initial_statuses: Vec::new(),
            self_is_attacker: false,
            regen_aware: true,
        },
    ]
}

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
            crate::contracts::SimpleAppliedStatus {
                status_id: "Burn_Status".to_string(),
                stacks: 1.0,
                source_ability: None,
            },
            crate::contracts::SimpleAppliedStatus {
                status_id: "Fear_Status".to_string(),
                stacks: 1.0,
                source_ability: None,
            },
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

// =========================================================================
// Benchmark runner.
// =========================================================================
struct BenchmarkResult {
    name: &'static str,
    fitness_off: f64,
    fitness_policy: f64,
    fitness_ideal: f64,
    policy_events: Vec<(f64, &'static str)>,
    ideal_script: Vec<(f64, PostureAction)>,
}

fn run_one_benchmark(scenario: &BenchmarkScenario) -> BenchmarkResult {
    let mut base_config = ComposableAbilityConfig::default();
    (scenario.config_overrides)(&mut base_config);

    let fitness_off = simulate_off(scenario, &base_config);
    let (fitness_policy, policy_events) = simulate_policy_on(scenario, &base_config);
    let (fitness_ideal, ideal_script) = brute_force_best_script(scenario, &base_config);

    BenchmarkResult {
        name: scenario.name,
        fitness_off,
        fitness_policy,
        fitness_ideal,
        policy_events,
        ideal_script,
    }
}

fn print_report(results: &[BenchmarkResult]) {
    eprintln!();
    eprintln!("=== POSTURE POLICY BENCHMARK ===");
    eprintln!();
    eprintln!("Fitness model: alive → self.hp, dead → -opp.hp (higher = better).");
    eprintln!();
    for r in results {
        eprintln!("------------------------------------------------------------");
        eprintln!("{}", r.name);
        eprintln!("  off    : {:>10.1}", r.fitness_off);
        eprintln!("  policy : {:>10.1}   (delta vs off: {:+.1})",
                  r.fitness_policy, r.fitness_policy - r.fitness_off);
        eprintln!("  ideal  : {:>10.1}   (delta vs off: {:+.1})",
                  r.fitness_ideal, r.fitness_ideal - r.fitness_off);
        let gap = r.fitness_ideal - r.fitness_policy;
        eprintln!("  gap (ideal − policy) : {:>+8.1}", gap);
        let ideal_gain = r.fitness_ideal - r.fitness_off;
        let policy_gain = r.fitness_policy - r.fitness_off;
        let capture_pct = if ideal_gain.abs() > 1e-3 {
            (policy_gain / ideal_gain) * 100.0
        } else {
            100.0
        };
        eprintln!("  policy captures: {:>5.1}% of ideal's gain over off", capture_pct);
        eprintln!("  policy events ({}): {}", r.policy_events.len(), format_events(&r.policy_events));
        eprintln!("  ideal script  ({}): {}", r.ideal_script.len(), format_script(&r.ideal_script));
        eprintln!();
    }
    eprintln!("------------------------------------------------------------");
    eprintln!();
}

fn format_events(events: &[(f64, &'static str)]) -> String {
    if events.is_empty() {
        return "(none)".to_string();
    }
    events.iter()
        .map(|(t, kind)| format!("{}@{:.1}", kind, t))
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_script(script: &[(f64, PostureAction)]) -> String {
    let non_stay: Vec<String> = script.iter()
        .filter(|(_, a)| !matches!(a, PostureAction::Stay))
        .map(|(t, a)| {
            let kind = match a {
                PostureAction::StartSit => "Sit",
                PostureAction::StartLay => "Lay",
                PostureAction::StandUp => "Stand",
                PostureAction::Stay => "Stay",
            };
            format!("{}@{:.2}", kind, t)
        })
        .collect();
    if non_stay.is_empty() {
        "(all Stay)".to_string()
    } else {
        non_stay.join(" ")
    }
}

// =========================================================================
// Diagnostic: run identical action trajectory through both code paths
// (policy-driven and script-driven) to isolate why scenario 1 / 4 / 7 / 8
// show >100% capture. The two paths SHOULD produce identical final
// state given identical actions and identical action timing; if they
// don't, this test prints the per-field diffs.
// =========================================================================
#[test]
#[ignore]
fn diagnose_policy_vs_script_gap() {
    // Use scenario 1 setup.
    let attacker = korathos();
    let defender = golgaroth();
    let scenario = BenchmarkScenario {
        name: "diag",
        attacker: attacker.clone(),
        defender: defender.clone(),
        attacker_breath: None,
        defender_breath: None,
        config_overrides: Box::new(|_| {}),
        max_time_sec: 30.0,
        attacker_start_hp: None,
        defender_start_hp: None,
        attacker_initial_statuses: Vec::new(),
        self_is_attacker: true,
        regen_aware: true,
    };

    // 1) Run policy. Extract per-field final state + posture event log.
    let mut config = ComposableAbilityConfig::default();
    config.attacker_posture_policy_enabled = true;
    config.attacker_posture_policy_regen_aware = true;
    let event_phase_order = default_event_phase_order();
    let (mut policy_state, policy_flags) = build_initial_state(&scenario, &config);
    let policy_params = LoopParams {
        attacker: &scenario.attacker,
        defender: &scenario.defender,
        attacker_breath: scenario.attacker_breath.as_ref(),
        defender_breath: scenario.defender_breath.as_ref(),
        config: &config,
        flags: &policy_flags,
        ability_policy: SimpleAbilityTimingMode::Fast,
        event_phase_order: &event_phase_order,
        record_trace: true,
        max_time_sec: scenario.max_time_sec,
        bench_count: false,
        posture_policy_override: PosturePolicyMode::Normal,
        iter_hooks: IterHooks::default(),
        decide_override: None,
        decide_override_respects_schedule: false,
        decide_bite_variant_override: None,
    };
    while policy_state.time <= scenario.max_time_sec
        && (policy_state.a.death_time.is_none() || policy_state.b.death_time.is_none())
    {
        match run_one_event_loop_iter(&mut policy_state, &policy_params) {
            LoopOutcome::Break => break,
            LoopOutcome::Continue => continue,
            LoopOutcome::Advanced => {}
            LoopOutcome::BoundExceeded => break,
        }
    }
    // Extract policy's posture events as a script.
    let mut policy_script: Vec<(f64, PostureAction)> = Vec::new();
    for entry in &policy_state.combat_log {
        if entry.attacker != "A" {
            continue;
        }
        match entry.description.as_deref() {
            Some("Laying down") => policy_script.push((entry.time, PostureAction::StartLay)),
            Some("Sitting down") => policy_script.push((entry.time, PostureAction::StartSit)),
            Some("Stood up") => policy_script.push((entry.time, PostureAction::StandUp)),
            _ => {}
        }
    }
    eprintln!("[diag] policy_script extracted: {:?}", policy_script);

    // 2) Run scripted-with-ForcedOff using the EXACT policy events as script.
    //    Inline the simulation so we can inspect full final state, not
    //    just the fitness scalar.
    let event_phase_order_2 = default_event_phase_order();
    let (mut script_state, script_flags) = build_initial_state(&scenario, &config);
    let script_params = LoopParams {
        attacker: &scenario.attacker,
        defender: &scenario.defender,
        attacker_breath: scenario.attacker_breath.as_ref(),
        defender_breath: scenario.defender_breath.as_ref(),
        config: &config,
        flags: &script_flags,
        ability_policy: SimpleAbilityTimingMode::Fast,
        event_phase_order: &event_phase_order_2,
        record_trace: false,
        max_time_sec: scenario.max_time_sec,
        bench_count: false,
        posture_policy_override: PosturePolicyMode::ForcedOff,
        iter_hooks: IterHooks::default(),
        decide_override: None,
        decide_override_respects_schedule: false,
        decide_bite_variant_override: None,
    };
    // Per-iter trace of script run.
    let mut script_trace: Vec<(f64, f64, f64, f64)> = Vec::new();
    let mut script_idx = 0usize;
    while script_state.time <= scenario.max_time_sec
        && (script_state.a.death_time.is_none() || script_state.b.death_time.is_none())
    {
        while script_idx < policy_script.len()
            && script_state.time + 1e-9 >= policy_script[script_idx].0
        {
            let action = policy_script[script_idx].1;
            apply_posture_action(&mut script_state.a, action, script_state.time);
            script_idx += 1;
        }
        let pre_t = script_state.time;
        let pre_a = script_state.a.hp;
        let pre_b = script_state.b.hp;
        let pre_dealt_b = script_state.counters.dealt_b;
        match run_one_event_loop_iter(&mut script_state, &script_params) {
            LoopOutcome::Break => break,
            LoopOutcome::Continue => continue,
            LoopOutcome::Advanced => {}
            LoopOutcome::BoundExceeded => break,
        }
        script_trace.push((
            script_state.time,
            script_state.a.hp,
            script_state.counters.dealt_b - pre_dealt_b,
            script_state.time - pre_t,
        ));
        let _ = (pre_a, pre_b);
    }

    let policy_fitness = compute_fitness(&policy_state, scenario.self_is_attacker);
    let script_fitness = compute_fitness(&script_state, scenario.self_is_attacker);

    eprintln!("[diag] ============= POLICY =============");
    eprintln!("       time={:.4}", policy_state.time);
    eprintln!("       a.hp={:.4} b.hp={:.4}", policy_state.a.hp, policy_state.b.hp);
    eprintln!("       a.death={:?} b.death={:?}",
        policy_state.a.death_time, policy_state.b.death_time);
    eprintln!("       dealt_a={:.4} dealt_b={:.4}",
        policy_state.counters.dealt_a, policy_state.counters.dealt_b);
    eprintln!("       regen_healed_a={:.4} regen_ticks_a={}",
        policy_state.regen_healed_a, policy_state.regen_ticks_a);
    eprintln!("       a.posture: current={:?} pending={:?} trans_at={:.4}",
        policy_state.a.posture_current, policy_state.a.posture_pending,
        policy_state.a.posture_transition_complete_at);
    eprintln!("       a.next_hit={:.4} a.next_regen={:.4}",
        policy_state.a.next_hit, policy_state.a.next_regen);
    eprintln!("       b.next_hit={:.4} b.next_regen={:.4}",
        policy_state.b.next_hit, policy_state.b.next_regen);

    eprintln!("[diag] ============= SCRIPT =============");
    eprintln!("       time={:.4}", script_state.time);
    eprintln!("       a.hp={:.4} b.hp={:.4}", script_state.a.hp, script_state.b.hp);
    eprintln!("       a.death={:?} b.death={:?}",
        script_state.a.death_time, script_state.b.death_time);
    eprintln!("       dealt_a={:.4} dealt_b={:.4}",
        script_state.counters.dealt_a, script_state.counters.dealt_b);
    eprintln!("       regen_healed_a={:.4} regen_ticks_a={}",
        script_state.regen_healed_a, script_state.regen_ticks_a);
    eprintln!("       a.posture: current={:?} pending={:?} trans_at={:.4}",
        script_state.a.posture_current, script_state.a.posture_pending,
        script_state.a.posture_transition_complete_at);
    eprintln!("       a.next_hit={:.4} a.next_regen={:.4}",
        script_state.a.next_hit, script_state.a.next_regen);
    eprintln!("       b.next_hit={:.4} b.next_regen={:.4}",
        script_state.b.next_hit, script_state.b.next_regen);

    eprintln!("[diag] ============= DIFF =============");
    eprintln!("       Δ a.hp           = {:+.4}", policy_state.a.hp - script_state.a.hp);
    eprintln!("       Δ b.hp           = {:+.4}", policy_state.b.hp - script_state.b.hp);
    eprintln!("       Δ dealt_a        = {:+.4}", policy_state.counters.dealt_a - script_state.counters.dealt_a);
    eprintln!("       Δ dealt_b        = {:+.4}", policy_state.counters.dealt_b - script_state.counters.dealt_b);
    eprintln!("       Δ regen_healed_a = {:+.4}", policy_state.regen_healed_a - script_state.regen_healed_a);
    eprintln!("       Δ fitness        = {:+.2}", policy_fitness - script_fitness);

    // Print script trace iters where dealt_b > 0 (opp bites that landed)
    // to spot where the extra bite came from.
    eprintln!("[diag] ============= SCRIPT BITE TRACE =============");
    eprintln!("       (only iters with dealt_b > 0)");
    for (i, &(t, a_hp, db, dt)) in script_trace.iter().enumerate() {
        if db > 0.01 {
            eprintln!("       iter {:>3}: t={:.3} a.hp={:.2} dealt_b+={:.2} (∆t={:.3})",
                i, t, a_hp, db, dt);
        }
    }
}

#[test]
#[ignore]
fn diagnose_scenario_9_decisions() {
    // Print every posture-policy decision fire for scenario 9
    // (Opralegion vs Gimon-Ogu, defender regen-unaware). Helps trace
    // why policy fires Lay@28 when periodic schedule shouldn't reach it.
    let scenarios = build_scenarios();
    let target = std::env::var("DIAG_SCENARIO").unwrap_or_else(|_| "9.".to_string());
    let scenario = scenarios.iter().find(|s| s.name.starts_with(&target)).expect("scenario");
    let mut base_config = ComposableAbilityConfig::default();
    (scenario.config_overrides)(&mut base_config);
    let (_fitness, _events) = simulate_policy_on(scenario, &base_config);
}

#[test]
#[ignore]
fn run_policy_benchmark() {
    let scenarios = build_scenarios();
    eprintln!("Running {} scenarios (brute-force) …", scenarios.len());
    let mut results = Vec::new();
    for scenario in &scenarios {
        eprintln!("  > {}", scenario.name);
        let result = run_one_benchmark(scenario);
        results.push(result);
    }
    print_report(&results);
}

/// Real-Compare-conditions benchmark: max_time_sec = 900 s (matching
/// `COMPARE_MAX_TIME_SEC` in src/hooks/useCompareSimulation.ts), real
/// Opra+Gimon stats, full breath profiles + Cause Fear. Compares
/// off / current policy / beam-search ideal so we can see how much
/// the policy is leaving on the table in REAL UI conditions, not
/// the 30-s synthetic scenarios `run_policy_benchmark` uses.
///
/// Run: `cargo test --lib --release run_compare_realistic_benchmark
/// -- --ignored --nocapture`
#[test]
#[ignore]
fn run_compare_realistic_benchmark() {
    const COMPARE_MAX_TIME_SEC: f64 = 900.0;
    const BEAM_WIDTH: usize = 32;
    const BEAM_MAX_DECISIONS: usize = 60;  // first ~180 s of decisions; Stay after

    // Full Compare default matching the UI's wiring per
    // src/optimizer/rustCompareMatchupRuntime.ts (BOOL_CONFIG_GATES +
    // VALUE_CONFIG_GATES applied via `hasActivatedAbilityNamed` +
    // ability value resolution):
    //
    // - Opra's activated abilities: Cause Fear, Grab (unmodelled),
    //   Healing Hunter (passive, unmodelled in Rust config).
    // - Gimon-Ogu's: Grab, Lure (unmodelled), Cursed Sigil (value 10).
    //
    // The Cursed Sigil → Bad_Omen application from Gimon is the
    // dominant defensive factor in real Compare — without it, the
    // benchmark misrepresents who lives longer. Earlier 4-variant
    // factor-isolation (without Cursed Sigil) showed both sides
    // dying with A at 1 HP across every variant; that was a
    // benchmark-setup error, not engine truth.
    let scenarios = vec![
        // 1: Full Compare default (breaths + Cause Fear + Cursed Sigil).
        BenchmarkScenario {
            name: "Opra vs Gimon FULL Compare default",
            attacker: opralegion(),
            defender: gimon_ogu(),
            attacker_breath: Some(spirit_glare_breath()),
            defender_breath: Some(miasma_breath()),
            config_overrides: Box::new(|c| {
                c.attacker_cause_fear = true;
                c.defender_cursed_sigil_stacks = 10.0;
            }),
            max_time_sec: COMPARE_MAX_TIME_SEC,
            attacker_start_hp: None, defender_start_hp: None,
            attacker_initial_statuses: Vec::new(),
            self_is_attacker: false, regen_aware: true,
        },
        // 2: No Cursed Sigil for diff (isolates Gimon's Cursed Sigil's contribution).
        BenchmarkScenario {
            name: "Opra vs Gimon — without Cursed Sigil",
            attacker: opralegion(),
            defender: gimon_ogu(),
            attacker_breath: Some(spirit_glare_breath()),
            defender_breath: Some(miasma_breath()),
            config_overrides: Box::new(|c| { c.attacker_cause_fear = true; }),
            max_time_sec: COMPARE_MAX_TIME_SEC,
            attacker_start_hp: None, defender_start_hp: None,
            attacker_initial_statuses: Vec::new(),
            self_is_attacker: false, regen_aware: true,
        },
    ];

    for scenario in &scenarios {
        eprintln!();
        eprintln!("=== {} (max_time = {:.0} s) ===", scenario.name, scenario.max_time_sec);
        let mut base_config = ComposableAbilityConfig::default();
        (scenario.config_overrides)(&mut base_config);

        let off_fitness = simulate_off(scenario, &base_config);
        eprintln!("  off       fitness = {:.0}", off_fitness);

        let (policy_fitness, policy_events) = simulate_policy_on(scenario, &base_config);
        eprintln!(
            "  policy    fitness = {:.0}   (Δ vs off: {:+.0}, events: {})",
            policy_fitness,
            policy_fitness - off_fitness,
            if policy_events.is_empty() {
                "(none)".to_string()
            } else {
                policy_events.iter()
                    .map(|(t, a)| format!("{}@{:.1}", a, t))
                    .collect::<Vec<_>>().join(" ")
            },
        );

        eprintln!(
            "  beam (w={}, max_dec={}): searching …",
            BEAM_WIDTH, BEAM_MAX_DECISIONS,
        );
        let t0 = std::time::Instant::now();
        let (ideal_fitness, ideal_script) =
            beam_search_best_script(scenario, &base_config, BEAM_WIDTH, BEAM_MAX_DECISIONS);
        let beam_elapsed = t0.elapsed();
        let script_fmt = ideal_script.iter()
            .filter(|(_, a)| !matches!(a, PostureAction::Stay))
            .map(|(t, a)| format!("{:?}@{:.1}", a, t))
            .collect::<Vec<_>>().join(" ");
        eprintln!(
            "  beam-ideal fitness = {:.0}   (Δ vs off: {:+.0}, elapsed {:.1}s)",
            ideal_fitness,
            ideal_fitness - off_fitness,
            beam_elapsed.as_secs_f64(),
        );
        eprintln!("  beam-ideal non-Stay actions: {}",
            if script_fmt.is_empty() { "(none — Stay is mathematically optimal)".to_string() } else { script_fmt });

        let policy_gain = policy_fitness - off_fitness;
        let ideal_gain = ideal_fitness - off_fitness;
        let capture_pct = if ideal_gain.abs() > 1e-9 {
            100.0 * policy_gain / ideal_gain
        } else {
            100.0  // ideal == off → trivially captured
        };
        eprintln!(
            "  policy captures: {:.1}% of beam-ideal's gain over off (gap = {:+.0} HP)",
            capture_pct, ideal_fitness - policy_fitness,
        );
    }
}
