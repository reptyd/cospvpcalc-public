//! Oracle objective for the policy-effectiveness benchmark (vector B).
//!
//! The frozen game-truth a policy is graded against - deliberately
//! independent of the policy's own search proxy (the `compute_replay_fitness`
//! in `posture_policy`). The dominant term is the engine's OWN winner rule
//! (the `(a.death_time, b.death_time)` match in this module's parent summary
//! builder: the winner is the survivor / whoever died last; both-alive and
//! equal-death are draws, and HP never enters the verdict). A bounded
//! decisiveness margin orders only WITHIN a winner class, so it can never
//! outrank the game outcome.
//!
//! Independence is a standing invariant: the oracle is graded in this
//! objective, never the policy's proxy, so a future refactor cannot silently
//! re-merge the two fitnesses and re-introduce the measuring-the-engine-by-
//! the-engine circularity. The proxy can be a continuous blend that ranks a
//! high-HP loss above a low-HP draw; this objective never does - the draw is
//! a draw and outranks every loss.

use std::cell::RefCell;

use super::config::ComposableAbilityConfig;
use super::loop_iter::{
    run_one_event_loop_iter, AbilityPolicyMode, IterHooks, LoopOutcome, LoopParams, LoopState,
    PosturePolicyMode,
};
use super::posture_benchmark::{
    build_initial_state, build_scenarios, default_event_phase_order, BenchmarkScenario,
};
use super::posture::Posture;
use super::posture_policy::PostureAction;
use super::side::CombatSide;
use crate::contracts::SimpleAbilityTimingMode;

/// A decisive alive-result outranks any both-died trade margin: the trade
/// margin is a death-time delta bounded by the fight cap (a few hundred
/// seconds), so a base far above that keeps "I am the sole survivor" strictly
/// above "we both died but I died later".
const DECISIVE_BASE: f64 = 1.0e6;

// The engine-iteration count the cost probes read lives in `work_meter` (it is
// a shipped counter now, not a test fixture).
#[cfg(test)]
use super::work_meter::take_engine_iters;

/// Per-inner-replay cost breakdown, to separate the two suspected blow-up
/// terms when Healing Pulse is on: the bounded WINDOWED replays (project=true)
/// vs the unbounded death-race EXACT re-runs (project=false). Test-only.
#[cfg(test)]
#[derive(Default, Clone, Copy, Debug)]
pub(crate) struct ReplayStats {
    pub windowed_replays: u64,
    pub windowed_iters: u64,
    pub exact_replays: u64,
    pub exact_iters: u64,
    /// Replays that hit `REPLAY_MAX_ITERS` (ran to the iter cap, no resolution).
    pub capped_replays: u64,
    /// Sum of (end_time - decision_start) over capped replays - to tell a
    /// dense-but-bounded ~45s window (large elapsed) from a same-time event
    /// storm where time barely advances (tiny elapsed).
    pub capped_elapsed_sum: f64,
    /// Replays that terminated because BOTH sides died (the early-death exit).
    pub both_dead_exits: u64,
}

#[cfg(test)]
thread_local! {
    static REPLAY_STATS: std::cell::Cell<ReplayStats> = std::cell::Cell::new(ReplayStats::default());
}

/// Record one finished inner replay. `project=true` is a bounded windowed
/// replay; `project=false` is a death-race exact re-run.
#[cfg(test)]
pub(crate) fn note_replay(project: bool, both_dead: bool, capped: bool, iters: u64, elapsed: f64) {
    REPLAY_STATS.with(|c| {
        let mut s = c.get();
        if project {
            s.windowed_replays += 1;
            s.windowed_iters += iters;
        } else {
            s.exact_replays += 1;
            s.exact_iters += iters;
        }
        if capped {
            s.capped_replays += 1;
            s.capped_elapsed_sum += elapsed;
        }
        if both_dead {
            s.both_dead_exits += 1;
        }
        c.set(s);
    });
}

/// Reset and return the replay-cost breakdown.
#[cfg(test)]
pub(super) fn take_replay_stats() -> ReplayStats {
    REPLAY_STATS.with(|c| {
        let s = c.get();
        c.set(ReplayStats::default());
        s
    })
}

// Tally of which event phase the scheduler selected each iteration (outer
// fight + all inner replays), to find WHICH phase floods a capped replay.
// Index order: StatusTicks, StatusDecay, Regen, Bite, Breath, ActiveAbilities.
#[cfg(test)]
thread_local! {
    static PHASE_COUNTS: std::cell::Cell<[u64; 6]> = const { std::cell::Cell::new([0u64; 6]) };
}

#[cfg(test)]
pub(crate) fn note_phase(phase: crate::composable::OrderedEventPhase) {
    use crate::composable::OrderedEventPhase as P;
    let idx = match phase {
        P::StatusTicks => 0,
        P::StatusDecay => 1,
        P::Regen => 2,
        P::Bite => 3,
        P::Breath => 4,
        P::ActiveAbilities => 5,
    };
    PHASE_COUNTS.with(|c| {
        let mut a = c.get();
        a[idx] += 1;
        c.set(a);
    });
}

#[cfg(test)]
pub(super) fn take_phase_counts() -> [u64; 6] {
    PHASE_COUNTS.with(|c| {
        let a = c.get();
        c.set([0u64; 6]);
        a
    })
}

// One-shot dump of a capped inner replay's healing-related timers, to pin
// WHICH overdue active timer floods the ActiveAbilities phase.
#[cfg(test)]
thread_local! {
    static CAPPED_DUMPED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
pub(super) fn reset_capped_dump() {
    CAPPED_DUMPED.with(|c| c.set(false));
}

#[allow(clippy::too_many_arguments)]
#[cfg(test)]
pub(crate) fn dump_capped_once(
    start: f64,
    end: f64,
    a_nhp: f64,
    a_cd: f64,
    a_ail: Option<f64>,
    a_stk: f64,
    b_nhp: f64,
    b_cd: f64,
    b_ail: Option<f64>,
    b_stk: f64,
) {
    CAPPED_DUMPED.with(|c| {
        if c.get() {
            return;
        }
        c.set(true);
        eprintln!(
            "[CAPPED replay] start={start:.2}s end={end:.2}s | A next_hp={a_nhp:.2} cd_until={a_cd:.2} ail_tick={a_ail:?} stacks={a_stk} | B next_hp={b_nhp:.2} cd_until={b_cd:.2} ail_tick={b_ail:?} stacks={b_stk}"
        );
    });
}

// ---------------------------------------------------------------------------
// Per-iteration crawl-snapshot probe (measurement agent, vector B).
//
// `dump_capped_once` only photographs the END state of ONE capped replay and
// only the healing timers. To pin WHY simulated time fails to advance while a
// replay crawls to the iter cap, we need a per-iteration trace of the LAST few
// iters of the FIRST few capped replays, recording `time`, the real
// `next_time` the scheduler picked (measured empirically as the post-iter
// `state.time`), the delta, and every scheduler event-source's raw value at
// that instant. The buffer below is a ring of the last `SNAP_RING` iterations
// of the CURRENT in-flight replay; when that replay turns out to be capped, the
// ring is flushed (printed) for the first `SNAP_MAX_REPLAYS` capped replays.
//
// Liveness: `SNAP_RECORD_HITS` counts every iteration that actually wrote a
// snapshot row; `SNAP_FLUSHED_REPLAYS` counts every capped replay actually
// flushed. Both are printed by the test; a zero means the probe is dead.
// Compiled out of the shipped wasm via `#[cfg(test)]`.
#[cfg(test)]
pub(crate) const SNAP_RING: usize = 6;
#[cfg(test)]
const SNAP_MAX_REPLAYS: usize = 3;

/// One per-iteration snapshot row. All times are raw f64 seconds.
#[cfg(test)]
#[derive(Default, Clone, Copy)]
pub(crate) struct CrawlSnap {
    pub iter_index: u32,
    pub time_before: f64,
    pub next_time: f64,
    // Core scheduler sources (always mined into next_time), per side, raw.
    pub a_next_hit: f64,
    pub b_next_hit: f64,
    pub a_next_breath: f64,
    pub b_next_breath: f64,
    pub a_next_regen: f64,
    pub b_next_regen: f64,
    pub a_next_status_tick: f64,
    pub b_next_status_tick: f64,
    pub a_next_status_decay: f64,
    pub b_next_status_decay: f64,
    pub a_next_lance_aura: f64,
    pub b_next_lance_aura: f64,
    pub a_next_self_destruct: f64,
    pub b_next_self_destruct: f64,
    pub posture_next_a: f64,
    pub posture_next_b: f64,
    // Active-ability raw timer sources behind the private scheduling helpers.
    pub a_next_healing_pulse: f64,
    pub b_next_healing_pulse: f64,
    pub a_healing_ailment_tick: f64,
    pub b_healing_ailment_tick: f64,
    pub a_aura_tick: f64,
    pub b_aura_tick: f64,
    pub a_healing_step_tick: f64,
    pub b_healing_step_tick: f64,
    pub a_damage_trail_tick: f64,
    pub b_damage_trail_tick: f64,
    pub a_toxic_trap_tick: f64,
    pub b_toxic_trap_tick: f64,
    // Per-side life/state.
    pub a_death: Option<f64>,
    pub b_death: Option<f64>,
    pub a_hp: f64,
    pub b_hp: f64,
    pub a_heal_ail_stacks: f64,
    pub b_heal_ail_stacks: f64,
}

#[cfg(test)]
thread_local! {
    /// Ring buffer of the last `SNAP_RING` iterations of the in-flight replay.
    static SNAP_RING_BUF: RefCell<Vec<CrawlSnap>> = const { RefCell::new(Vec::new()) };
    /// How many capped replays have been flushed so far (cap: SNAP_MAX_REPLAYS).
    static SNAP_FLUSHED_REPLAYS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    /// How many snapshot rows were actually written (liveness counter).
    static SNAP_RECORD_HITS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// Reset the snapshot probe (ring + both liveness counters). Call before a run.
#[cfg(test)]
pub(super) fn reset_crawl_snap() {
    SNAP_RING_BUF.with(|b| b.borrow_mut().clear());
    SNAP_FLUSHED_REPLAYS.with(|c| c.set(0));
    SNAP_RECORD_HITS.with(|c| c.set(0));
}

/// Push one per-iteration snapshot row into the ring for the in-flight replay.
/// Only retains the last `SNAP_RING` rows. No-op once `SNAP_MAX_REPLAYS` capped
/// replays have already been flushed (saves work after we have our sample).
#[cfg(test)]
pub(crate) fn record_crawl_snap(s: CrawlSnap) {
    if SNAP_FLUSHED_REPLAYS.with(|c| c.get()) >= SNAP_MAX_REPLAYS {
        return;
    }
    SNAP_RECORD_HITS.with(|c| c.set(c.get() + 1));
    SNAP_RING_BUF.with(|b| {
        let mut buf = b.borrow_mut();
        buf.push(s);
        if buf.len() > SNAP_RING {
            let drop_n = buf.len() - SNAP_RING;
            buf.drain(0..drop_n);
        }
    });
}

/// Clear the in-flight ring without flushing (replay ended NOT capped).
#[cfg(test)]
pub(crate) fn discard_crawl_snap() {
    SNAP_RING_BUF.with(|b| b.borrow_mut().clear());
}

/// Flush the in-flight ring as a labelled snapshot block for ONE capped replay,
/// up to `SNAP_MAX_REPLAYS` times. `decision_start` / `replay_end` frame the
/// replay so a reviewer can confirm it is a real capped (not horizon/death)
/// replay. Returns whether it actually flushed (i.e. was under the cap).
#[cfg(test)]
pub(crate) fn flush_crawl_snap_if_capped(decision_start: f64, replay_end: f64, total_iters: u32) {
    let n = SNAP_FLUSHED_REPLAYS.with(|c| c.get());
    if n >= SNAP_MAX_REPLAYS {
        SNAP_RING_BUF.with(|b| b.borrow_mut().clear());
        return;
    }
    SNAP_FLUSHED_REPLAYS.with(|c| c.set(n + 1));
    SNAP_RING_BUF.with(|b| {
        let buf = b.borrow_mut();
        eprintln!(
            "\n######## CAPPED REPLAY #{} | decision_start={decision_start:.4}s replay_end={replay_end:.4}s total_iters={total_iters} | last {} iters before cap ########",
            n + 1,
            buf.len()
        );
        for s in buf.iter() {
            let dt = s.next_time - s.time_before;
            let vt = |v: f64| v - s.time_before;
            eprintln!(
                "  iter={} time={:.6} next_time={:.6} (next-time={:+.6})",
                s.iter_index, s.time_before, s.next_time, dt
            );
            eprintln!(
                "     loop-continues: A_alive={} B_alive={} | A death={:?} hp={:.3} | B death={:?} hp={:.3} | heal_ail_stacks A={} B={}",
                s.a_death.is_none(), s.b_death.is_none(),
                s.a_death, s.a_hp, s.b_death, s.b_hp, s.a_heal_ail_stacks, s.b_heal_ail_stacks
            );
            eprintln!(
                "     core (val, val-time):  next_hit A=({:.4},{:+.4}) B=({:.4},{:+.4}) | breath A=({:.4},{:+.4}) B=({:.4},{:+.4}) | regen A=({:.4},{:+.4}) B=({:.4},{:+.4})",
                s.a_next_hit, vt(s.a_next_hit), s.b_next_hit, vt(s.b_next_hit),
                s.a_next_breath, vt(s.a_next_breath), s.b_next_breath, vt(s.b_next_breath),
                s.a_next_regen, vt(s.a_next_regen), s.b_next_regen, vt(s.b_next_regen),
            );
            eprintln!(
                "     core (val, val-time):  stat_tick A=({:.4},{:+.4}) B=({:.4},{:+.4}) | stat_decay A=({:.4},{:+.4}) B=({:.4},{:+.4}) | lance_aura A=({:.4},{:+.4}) B=({:.4},{:+.4}) | self_destruct A=({:.4},{:+.4}) B=({:.4},{:+.4}) | posture A=({:.4},{:+.4}) B=({:.4},{:+.4})",
                s.a_next_status_tick, vt(s.a_next_status_tick), s.b_next_status_tick, vt(s.b_next_status_tick),
                s.a_next_status_decay, vt(s.a_next_status_decay), s.b_next_status_decay, vt(s.b_next_status_decay),
                s.a_next_lance_aura, vt(s.a_next_lance_aura), s.b_next_lance_aura, vt(s.b_next_lance_aura),
                s.a_next_self_destruct, vt(s.a_next_self_destruct), s.b_next_self_destruct, vt(s.b_next_self_destruct),
                s.posture_next_a, vt(s.posture_next_a), s.posture_next_b, vt(s.posture_next_b),
            );
            eprintln!(
                "     active (val, val-time): heal_pulse A=({:.4},{:+.4}) B=({:.4},{:+.4}) | heal_ail_tick A=({:.4},{:+.4}) B=({:.4},{:+.4}) | heal_step A=({:.4},{:+.4}) B=({:.4},{:+.4}) | aura A=({:.4},{:+.4}) B=({:.4},{:+.4}) | dmg_trail A=({:.4},{:+.4}) B=({:.4},{:+.4}) | toxic_trap A=({:.4},{:+.4}) B=({:.4},{:+.4})",
                s.a_next_healing_pulse, vt(s.a_next_healing_pulse), s.b_next_healing_pulse, vt(s.b_next_healing_pulse),
                s.a_healing_ailment_tick, vt(s.a_healing_ailment_tick), s.b_healing_ailment_tick, vt(s.b_healing_ailment_tick),
                s.a_healing_step_tick, vt(s.a_healing_step_tick), s.b_healing_step_tick, vt(s.b_healing_step_tick),
                s.a_aura_tick, vt(s.a_aura_tick), s.b_aura_tick, vt(s.b_aura_tick),
                s.a_damage_trail_tick, vt(s.a_damage_trail_tick), s.b_damage_trail_tick, vt(s.b_damage_trail_tick),
                s.a_toxic_trap_tick, vt(s.a_toxic_trap_tick), s.b_toxic_trap_tick, vt(s.b_toxic_trap_tick),
            );
        }
    });
    SNAP_RING_BUF.with(|b| b.borrow_mut().clear());
}

/// Read the two liveness counters: (snapshot rows written, capped replays flushed).
#[cfg(test)]
pub(super) fn take_crawl_snap_liveness() -> (u64, usize) {
    let hits = SNAP_RECORD_HITS.with(|c| c.get());
    let flushed = SNAP_FLUSHED_REPLAYS.with(|c| c.get());
    (hits, flushed)
}

/// Game-truth value of a finished (or horizon-capped) replay, from the
/// actor's frame. Compared lexicographically: `outcome` dominates,
/// `decisiveness` only breaks within-class ties.
/// Lexicographic by declaration order: `outcome` dominates, `decisiveness`
/// only breaks within-class ties.
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
pub(super) struct OracleValue {
    /// The engine's winner mapped to the actor's frame: `1` I win, `0` draw,
    /// `-1` I lose. The only term Compare actually decides.
    pub outcome: i8,
    /// Within-class decisiveness (higher = more decisive in my favour); never
    /// crosses an `outcome` boundary.
    pub decisiveness: f64,
}

/// Grade a replay end-state in game-truth terms, from the actor's frame
/// (`self_is_attacker` => "me" = side A). The `outcome` mirrors the engine's
/// winner determination; the decisiveness is an honest "how decisive"
/// refinement the search can climb, never itself a verdict.
pub(super) fn oracle_objective(
    a_hp: f64,
    b_hp: f64,
    a_death: Option<f64>,
    b_death: Option<f64>,
    self_is_attacker: bool,
) -> OracleValue {
    let (my_hp, my_death, opp_hp, opp_death) = if self_is_attacker {
        (a_hp, a_death, b_hp, b_death)
    } else {
        (b_hp, b_death, a_hp, a_death)
    };
    match (my_death, opp_death) {
        // Both alive at the cap -> the engine declares a draw. HP does not
        // decide it; the lead only orders draws for the search.
        (None, None) => OracleValue {
            outcome: 0,
            decisiveness: my_hp.max(0.0) - opp_hp.max(0.0),
        },
        // I survived, opp is dead -> a decisive win, above any trade win.
        (None, Some(_)) => OracleValue {
            outcome: 1,
            decisiveness: DECISIVE_BASE + my_hp.max(0.0),
        },
        // I am dead, opp survived -> a decisive loss, below any trade loss.
        (Some(_), None) => OracleValue {
            outcome: -1,
            decisiveness: -(DECISIVE_BASE + opp_hp.max(0.0)),
        },
        // Both dead -> the engine's winner is whoever died LATER.
        (Some(me_t), Some(op_t)) => {
            if me_t > op_t + 1e-9 {
                OracleValue { outcome: 1, decisiveness: me_t - op_t }
            } else if op_t > me_t + 1e-9 {
                OracleValue { outcome: -1, decisiveness: -(op_t - me_t) }
            } else {
                OracleValue { outcome: 0, decisiveness: 0.0 }
            }
        }
    }
}

const ORACLE_ACTIONS: [PostureAction; 4] = [
    PostureAction::Stay,
    PostureAction::StartSit,
    PostureAction::StartLay,
    PostureAction::StandUp,
];

/// The scenario config with MY side's posture policy enabled (so the oracle
/// override / live policy is consulted) and the opponent's left off, so it
/// holds standing - the passive opponent of this stage. The declared opponent
/// suite is injected in a later stage.
fn oracle_config(scenario: &BenchmarkScenario) -> ComposableAbilityConfig {
    let mut config = ComposableAbilityConfig::default();
    (scenario.config_overrides)(&mut config);
    if scenario.self_is_attacker {
        config.attacker_posture_policy_enabled = true;
    } else {
        config.defender_posture_policy_enabled = true;
    }
    config
}

fn run_to_end(state: &mut LoopState, params: &LoopParams<'_>, max_time: f64) {
    let mut iter_count = 0u32;
    while state.time <= max_time
        && (state.a.death_time.is_none() || state.b.death_time.is_none())
        && iter_count < 50_000
    {
        match run_one_event_loop_iter(state, params) {
            LoopOutcome::Break | LoopOutcome::BoundExceeded => break,
            LoopOutcome::Continue | LoopOutcome::Advanced => iter_count += 1,
        }
    }
}

/// Fixed opponent posture scripts for the delta-bracket - an affordable reach into
/// a two-sided (non-frozen) opponent, without a full second oracle (which would
/// be `(4^d)^2`). The opponent re-postures toward the scripted target on its own
/// decision grid; the live policy still projects against a frozen `Hold` model,
/// so the bracket measures whether that frozen assumption costs the policy a
/// decisive outcome class against a moving opponent.
#[derive(Clone, Copy)]
enum OpponentScript {
    /// Stand the whole fight (return to Standing whenever knocked off it).
    AlwaysStand,
    /// Lie down and stay laid.
    SustainedLay,
    /// Cycle laying / standing on a fixed period.
    LayPulse,
}

const OPPONENT_LAY_PULSE_SEC: f64 = 30.0;

impl OpponentScript {
    fn action_at(self, current: Posture, t: f64) -> PostureAction {
        let target = match self {
            OpponentScript::AlwaysStand => Posture::Standing,
            OpponentScript::SustainedLay => Posture::Laying,
            OpponentScript::LayPulse => {
                if ((t / OPPONENT_LAY_PULSE_SEC) as i64) % 2 == 0 {
                    Posture::Laying
                } else {
                    Posture::Standing
                }
            }
        };
        if current == target {
            return PostureAction::Stay;
        }
        match target {
            Posture::Standing => PostureAction::StandUp,
            Posture::Sitting => PostureAction::StartSit,
            Posture::Laying => PostureAction::StartLay,
        }
    }
}

thread_local! {
    /// The opponent's posture behaviour in the outer verification fight.
    /// `None` = the historical frozen passive opponent (Stay every decision);
    /// `Some(script)` drives a moving opponent. `run_script_raw`'s opponent
    /// branch reads it, so `oracle_best` / the script grid inherit it without
    /// threading an opponent argument through every signature.
    static FINDER_OPPONENT: std::cell::Cell<Option<OpponentScript>> =
        const { std::cell::Cell::new(None) };
}

fn set_finder_opponent(opp: Option<OpponentScript>) {
    FINDER_OPPONENT.with(|c| c.set(opp));
}

fn finder_opponent_action(side: &CombatSide, t: f64) -> PostureAction {
    match FINDER_OPPONENT.with(|c| c.get()) {
        Some(script) => script.action_at(side.posture_current, t),
        None => PostureAction::Stay,
    }
}

/// Run a full fight where MY side's posture is driven by `script` indexed by
/// DECISION ORDER (the i-th scheduled posture decision applies `script[i]`,
/// Stay beyond it). The override runs with `respects_schedule = true`, so MY
/// decisions fire at exactly the live policy's scheduled moments - the same
/// grid the policy is consulted on, NOT an every-iter firehose. Returns the
/// game-truth value of the end state plus whether a decision fired BEYOND the
/// script (so the search knows another branch point exists).
fn run_script_on_grid(
    scenario: &BenchmarkScenario,
    config: &ComposableAbilityConfig,
    max_time: f64,
    script: &[PostureAction],
) -> (OracleValue, bool) {
    let (end, saw_beyond, _decisions) = run_script_raw(scenario, config, max_time, script);
    let value = oracle_objective(
        end.a_hp,
        end.b_hp,
        end.a_death,
        end.b_death,
        scenario.self_is_attacker,
    );
    (value, saw_beyond)
}

/// Raw end-state of a finished/horizon-capped replay, in physical A/B slots
/// (not the actor frame). The death timestamps the finder's bisection margin
/// reads live here; `oracle_objective` collapses them to a verdict.
#[derive(Clone, Copy)]
struct RawEnd {
    a_hp: f64,
    b_hp: f64,
    a_death: Option<f64>,
    b_death: Option<f64>,
}

/// Engine core of [`run_script_on_grid`]: drive MY side's posture by `script`
/// (indexed by decision order, Stay beyond it) on the live policy's own
/// decision grid, run to the end, and return the raw end-state, whether a
/// decision fired beyond the script, and the number of MY-side decisions that
/// fired (the finder's cost guard for the exponential `oracle_best`).
fn run_script_raw(
    scenario: &BenchmarkScenario,
    config: &ComposableAbilityConfig,
    max_time: f64,
    script: &[PostureAction],
) -> (RawEnd, bool, usize) {
    let event_phase_order = default_event_phase_order();
    let (mut state, flags) = build_initial_state(scenario, config);
    let self_is_attacker = scenario.self_is_attacker;
    let cursor = RefCell::new(0usize);
    let saw_beyond = RefCell::new(false);
    {
        let closure = |ask_self: &CombatSide, _b: &CombatSide, t: f64, is_attacker: bool| -> Option<PostureAction> {
            if is_attacker != self_is_attacker {
                return Some(finder_opponent_action(ask_self, t));
            }
            let mut idx = cursor.borrow_mut();
            let action = if *idx < script.len() {
                script[*idx]
            } else {
                *saw_beyond.borrow_mut() = true;
                PostureAction::Stay
            };
            *idx += 1;
            Some(action)
        };
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
            max_time_sec: max_time,
            bench_count: false,
            posture_policy_override: PosturePolicyMode::Normal,
            iter_hooks: IterHooks::default(),
            decide_override: Some(&closure),
            decide_override_respects_schedule: true,
            decide_bite_variant_override: None,
            decide_toggle_override: None,
            ability_policy_mode: AbilityPolicyMode::Normal,
        };
        run_to_end(&mut state, &params, max_time);
    }
    let end = RawEnd {
        a_hp: state.a.hp,
        b_hp: state.b.hp,
        a_death: state.a.death_time,
        b_death: state.b.death_time,
    };
    (end, saw_beyond.into_inner(), cursor.into_inner())
}

/// Run the live posture policy (no override) and grade it in the SAME
/// game-truth objective the oracle uses, so the two are directly comparable.
fn policy_value(
    scenario: &BenchmarkScenario,
    config: &ComposableAbilityConfig,
    max_time: f64,
) -> OracleValue {
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
        max_time_sec: max_time,
        bench_count: false,
        posture_policy_override: PosturePolicyMode::Normal,
        iter_hooks: IterHooks::default(),
        decide_override: None,
        decide_override_respects_schedule: false,
        decide_bite_variant_override: None,
        decide_toggle_override: None,
        ability_policy_mode: AbilityPolicyMode::Normal,
    };
    run_to_end(&mut state, &params, max_time);
    oracle_objective(
        state.a.hp,
        state.b.hp,
        state.a.death_time,
        state.b.death_time,
        scenario.self_is_attacker,
    )
}

/// Like `policy_value` but the OPPONENT re-postures per `opponent` instead of
/// holding. The actor side runs its real live policy (the override returns
/// `None` for it); the opponent's posture policy must be enabled in `config`
/// so its scripted decisions fire on its own grid.
fn policy_value_vs(
    scenario: &BenchmarkScenario,
    config: &ComposableAbilityConfig,
    max_time: f64,
    opponent: Option<OpponentScript>,
) -> OracleValue {
    let event_phase_order = default_event_phase_order();
    let (mut state, flags) = build_initial_state(scenario, config);
    let self_is_attacker = scenario.self_is_attacker;
    let closure = move |ask_self: &CombatSide,
                        _opp: &CombatSide,
                        t: f64,
                        is_attacker: bool|
          -> Option<PostureAction> {
        if is_attacker == self_is_attacker {
            None // actor side: defer to the live policy
        } else {
            Some(match opponent {
                Some(script) => script.action_at(ask_self.posture_current, t),
                None => PostureAction::Stay,
            })
        }
    };
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
        max_time_sec: max_time,
        bench_count: false,
        posture_policy_override: PosturePolicyMode::Normal,
        iter_hooks: IterHooks::default(),
        decide_override: Some(&closure),
        decide_override_respects_schedule: true,
        decide_bite_variant_override: None,
        decide_toggle_override: None,
        ability_policy_mode: AbilityPolicyMode::Normal,
    };
    run_to_end(&mut state, &params, max_time);
    oracle_objective(
        state.a.hp,
        state.b.hp,
        state.a.death_time,
        state.b.death_time,
        scenario.self_is_attacker,
    )
}

/// Extract the live policy's realized posture script - the action it applies
/// at each scheduled decision, in firing order, for the actor side. Arms the
/// test-only decision recorder (`stance_bridge`), runs the live policy once,
/// and drains what it captured. The returned script, replayed through
/// [`run_script_on_grid`], reproduces the live policy's fight exactly (same
/// schedule, same actions) - the equivalence the tautological ceiling rests on.
fn policy_realized_script(
    scenario: &BenchmarkScenario,
    config: &ComposableAbilityConfig,
    max_time: f64,
) -> Vec<PostureAction> {
    super::stance_bridge::arm_decision_recorder();
    let _ = policy_value(scenario, config, max_time);
    super::stance_bridge::take_decision_recording()
        .into_iter()
        .filter(|(is_attacker, _)| *is_attacker == scenario.self_is_attacker)
        .map(|(_, action)| action)
        .collect()
}

/// Exhaustive depth-first oracle: enumerate every posture action-sequence on
/// the policy's own decision grid and return the best game-truth value. By
/// construction this is a true upper bound on any policy graded the same way -
/// the policy's realized action-sequence is one of the enumerated scripts, so
/// `oracle_best >= policy` always (the >100% artifact is impossible).
/// Exhaustive (no pruning / memo yet): admissible branch-and-bound is the next
/// stage, validated against this exact baseline.
fn oracle_best(
    scenario: &BenchmarkScenario,
    config: &ComposableAbilityConfig,
    max_time: f64,
) -> OracleValue {
    fn dfs(
        scenario: &BenchmarkScenario,
        config: &ComposableAbilityConfig,
        max_time: f64,
        prefix: &mut Vec<PostureAction>,
    ) -> OracleValue {
        let (value, saw_beyond) = run_script_on_grid(scenario, config, max_time, prefix);
        if !saw_beyond {
            return value;
        }
        let mut best: Option<OracleValue> = None;
        for &action in &ORACLE_ACTIONS {
            prefix.push(action);
            let v = dfs(scenario, config, max_time, prefix);
            prefix.pop();
            best = Some(match best {
                Some(b) if b >= v => b,
                _ => v,
            });
        }
        best.expect("at least one action is always explored")
    }
    dfs(scenario, config, max_time, &mut Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A benchmark builder paired with the label the report prints for it.
    type ScenarioCase = (fn(f64, f64) -> BenchmarkScenario, &'static str);

    /// Mirror of the engine winner determination in the parent summary
    /// builder, expressed from A's frame: `1` A wins, `-1` B wins, `0` draw.
    fn engine_winner_from_a(a_death: Option<f64>, b_death: Option<f64>) -> i8 {
        match (a_death, b_death) {
            (Some(da), Some(db)) => {
                if (da - db).abs() <= 1e-9 {
                    0
                } else if da < db {
                    -1 // A died first -> B survived longer -> B wins
                } else {
                    1
                }
            }
            (Some(_), None) => -1, // A dead, B alive -> B wins
            (None, Some(_)) => 1,  // B dead, A alive -> A wins
            (None, None) => 0,
        }
    }

    #[test]
    fn outcome_mirrors_engine_winner_from_both_frames() {
        let deaths = [
            (None, None),
            (None, Some(10.0)),
            (Some(10.0), None),
            (Some(10.0), Some(20.0)),
            (Some(20.0), Some(10.0)),
            (Some(15.0), Some(15.0)),
        ];
        for (a_death, b_death) in deaths {
            let engine_a = engine_winner_from_a(a_death, b_death);
            let from_a = oracle_objective(100.0, 200.0, a_death, b_death, true).outcome;
            let from_b = oracle_objective(100.0, 200.0, a_death, b_death, false).outcome;
            assert_eq!(
                from_a, engine_a,
                "attacker-frame outcome must match the engine winner for {a_death:?}/{b_death:?}"
            );
            assert_eq!(
                from_b, -engine_a,
                "defender-frame outcome must be the mirror for {a_death:?}/{b_death:?}"
            );
        }
    }

    #[test]
    fn outcome_dominates_decisiveness() {
        // A barely-won trade, a draw with a huge HP lead, a barely-lost trade.
        let win_tiny = oracle_objective(0.0, 0.0, Some(10.001), Some(10.0), true);
        let draw_huge_lead = oracle_objective(5000.0, 0.0, None, None, true);
        let loss_tiny = oracle_objective(0.0, 0.0, Some(10.0), Some(10.001), true);

        assert_eq!(win_tiny.outcome, 1);
        assert_eq!(draw_huge_lead.outcome, 0);
        assert_eq!(loss_tiny.outcome, -1);

        // The game outcome dominates: the tiny win beats the huge-lead draw,
        // and the draw beats the tiny loss - margins never cross the class.
        assert!(win_tiny > draw_huge_lead);
        assert!(draw_huge_lead > loss_tiny);
    }

    #[test]
    fn decisiveness_orders_within_a_class() {
        // Two wins: surviving with the opponent dead is strictly more
        // decisive than narrowly outliving the opponent in a mutual death.
        let alive_win = oracle_objective(500.0, 0.0, None, Some(8.0), true);
        let trade_win = oracle_objective(0.0, 0.0, Some(13.0), Some(8.0), true);
        assert_eq!(alive_win.outcome, 1);
        assert_eq!(trade_win.outcome, 1);
        assert!(alive_win > trade_win);
    }

    /// The exhaustive oracle is a true ceiling: the live policy's trajectory
    /// is one of the enumerated posture scripts on its own decision grid, so
    /// the oracle can never score below the policy. The property is made
    /// TAUTOLOGICAL (not horizon-dependent) by grading the policy through the
    /// SAME `run_script_on_grid` path the oracle enumerates: we extract the
    /// policy's realized script and replay it, so its value is by construction
    /// one of the action-sequences `oracle_best` maximises over. The earlier
    /// formulation graded the live policy directly and was only sound below
    /// the 45 s bounded-window (`POSTURE_REPLAY_WINDOW_SEC`): past it the
    /// policy decides via a surrogate projection, and "its trajectory is one
    /// of the scripts" was an unproven assertion rather than a tautology.
    ///
    /// The replay==live equivalence the tautology rests on is guarded
    /// separately and at a longer horizon by
    /// `policy_script_replay_matches_live_past_surrogate_window`. A short
    /// horizon here keeps the 4^decisions enumeration small.
    #[test]
    fn oracle_upper_bounds_the_live_policy() {
        let max_time = 10.0;
        for scenario in build_scenarios() {
            let config = oracle_config(&scenario);
            let script = policy_realized_script(&scenario, &config, max_time);
            let (scripted, _) = run_script_on_grid(&scenario, &config, max_time, &script);
            // The replayed script must reproduce the live policy end-state -
            // the equivalence that makes `scripted` the policy's true value.
            let direct = policy_value(&scenario, &config, max_time);
            assert_eq!(
                scripted, direct,
                "{}: replayed policy script must reproduce the live end-state",
                scenario.name
            );
            // Tautological ceiling: `script` is one of the DFS paths.
            let oracle = oracle_best(&scenario, &config, max_time);
            assert!(
                oracle >= scripted,
                "{}: oracle {oracle:?} must upper-bound policy {scripted:?}",
                scenario.name
            );
        }
    }

    /// The tautological ceiling rests on one fact: replaying the policy's
    /// realized script reproduces the live policy's exact fight. That holds
    /// trivially below the 45 s bounded-window, where the policy decides on
    /// the exact engine. Past it the policy decides via the bounded-window
    /// surrogate + terminal projection, so this is where the equivalence
    /// could break if it ever does. Enumerating `oracle_best` at this horizon
    /// is exponential, but the equivalence check is just two fights - cheap
    /// and horizon-robust. With it green, `oracle_best >= live policy`
    /// transitively at ANY horizon, even where the full enumeration is out of
    /// reach.
    ///
    /// `#[ignore]`: runs the inner-replay policy at a 90 s horizon over the
    /// whole corpus (~70 s in debug) - too heavy for the default CI suite.
    /// The cheap equivalence guard at the 10 s horizon in
    /// `oracle_upper_bounds_the_live_policy` covers the common path; this one
    /// is the on-demand past-surrogate check. Run with
    /// `cargo test --lib -- --ignored policy_script_replay`.
    #[test]
    #[ignore]
    fn policy_script_replay_matches_live_past_surrogate_window() {
        use crate::composable::posture_policy::POSTURE_REPLAY_WINDOW_SEC;
        let max_time = 2.0 * POSTURE_REPLAY_WINDOW_SEC;
        for scenario in build_scenarios() {
            let config = oracle_config(&scenario);
            let script = policy_realized_script(&scenario, &config, max_time);
            let (scripted, _) = run_script_on_grid(&scenario, &config, max_time, &script);
            let direct = policy_value(&scenario, &config, max_time);
            assert_eq!(
                scripted, direct,
                "{}: policy script must reproduce the live end-state past the surrogate window",
                scenario.name
            );
        }
    }

    // =====================================================================
    // Decisive-fight finder (vector B, stage 1b-ii).
    //
    // A fight is DECISIVE only when the posture choice flips the outcome
    // class - which happens only in a thin shell around a death-time tie. We
    // bisect `defender_start_hp` to land on that tie, then probe whether a
    // fixed posture script (stand / sustained-lay) reaches a better outcome
    // CLASS than the live policy. If it does, the policy lost a winnable
    // class at a concrete `(pair, start_hp)` - a real miss, surfaced WITHOUT
    // the oracle. `oracle_best` is only consulted as an affordable bonus, to
    // catch misses no two-script bracket can express.
    //
    // EVERY result is "vs a frozen-posture opponent": the opponent fights
    // (bites / breath / abilities) but never re-postures (`ReplayOpponent`
    // has only the `Hold` variant). That caveat rides every line below.
    //
    // `#[ignore]` (diagnostic, prints under `--nocapture`):
    //   cargo test --lib composable::oracle::tests::find_decisive_fights \
    //       -- --ignored --nocapture
    // =====================================================================

    use crate::composable::posture_benchmark::{
        finder_scenario_korathos_golgaroth, finder_scenario_opra_gimon,
    };

    /// Horizon for the finder. Short enough that `oracle_best`'s 4^decisions
    /// enumeration stays affordable at the near-tie; the bisection drives the
    /// deaths inside it.
    const FINDER_MAX_TIME: f64 = 20.0;

    /// Decision depth past which the exponential `oracle_best` is skipped.
    const FINDER_ORACLE_MAX_DECISIONS: usize = 9;

    struct PointVerdict {
        stand: OracleValue,
        lay: OracleValue,
        policy: OracleValue,
        depth: usize,
    }

    fn outcome_at(
        build: fn(f64, f64) -> BenchmarkScenario,
        hp: f64,
        self_is_attacker: bool,
    ) -> PointVerdict {
        let scenario = build(hp, FINDER_MAX_TIME);
        let config = oracle_config(&scenario);
        let (stand_end, _b1, stand_dec) = run_script_raw(&scenario, &config, FINDER_MAX_TIME, &[]);
        let (lay_end, _b2, lay_dec) =
            run_script_raw(&scenario, &config, FINDER_MAX_TIME, &[PostureAction::StartLay]);
        let to_value = |e: RawEnd| {
            oracle_objective(e.a_hp, e.b_hp, e.a_death, e.b_death, self_is_attacker)
        };
        PointVerdict {
            stand: to_value(stand_end),
            lay: to_value(lay_end),
            policy: policy_value(&scenario, &config, FINDER_MAX_TIME),
            depth: stand_dec.max(lay_dec),
        }
    }

    fn run_decisive_finder(build: fn(f64, f64) -> BenchmarkScenario) {
        let probe = build(1.0, FINDER_MAX_TIME);
        let self_is_attacker = probe.self_is_attacker;
        let base_hp = probe.defender.health;
        eprintln!(
            "\n=== {} | policy side = {} | base defender HP = {:.0} | horizon = {:.0}s ===",
            probe.name,
            if self_is_attacker { "attacker" } else { "defender" },
            base_hp,
            FINDER_MAX_TIME
        );
        eprintln!("(all results vs a frozen-posture opponent)");

        // Sweep `defender_start_hp` and, at each point, classify the fight
        // under three fixed posture scripts: stand (all-Stay), sustained-lay,
        // and the live policy. A point is DECISIVE when stand and lay land in
        // different outcome CLASSES - that is exactly where posture flips the
        // verdict. The near-tie shell the plan describes shows up as the band
        // of consecutive decisive points; bisection is unnecessary - a direct
        // class sweep finds it and is robust to the win/draw/loss boundaries a
        // single signed margin conflates.
        let lo = base_hp * 0.05;
        let hi = base_hp * 1.30;
        let steps = 40usize;

        let mut decisive: Vec<(f64, PointVerdict)> = Vec::new();
        let mut classes_seen: std::collections::BTreeSet<i8> = std::collections::BTreeSet::new();
        let mut first_miss: Option<(f64, i8, i8, &'static str)> = None;

        for i in 0..=steps {
            let hp = lo + (hi - lo) * (i as f64) / (steps as f64);
            let v = outcome_at(build, hp, self_is_attacker);
            classes_seen.insert(v.policy.outcome);
            if v.stand.outcome != v.lay.outcome {
                let best_simple = if v.stand >= v.lay { v.stand } else { v.lay };
                if v.policy.outcome < best_simple.outcome && first_miss.is_none() {
                    let which = if v.stand >= v.lay { "stand" } else { "sustained-lay" };
                    first_miss = Some((hp, best_simple.outcome, v.policy.outcome, which));
                }
                decisive.push((hp, v));
            }
        }

        if decisive.is_empty() {
            let cls: Vec<String> = classes_seen.iter().map(|c| format!("{c:+}")).collect();
            eprintln!(
                "  NO decisive fight in HP band [{:.0}, {:.0}] ({} pts): stand and lay never flip the \
                 class. Policy classes swept: {{{}}}.",
                lo, hi, steps + 1, cls.join(", ")
            );
        } else {
            let band_lo = decisive.first().unwrap().0;
            let band_hi = decisive.last().unwrap().0;
            eprintln!(
                "  {} decisive point(s) (posture flips the class), defender_start_hp in [{:.0}, {:.0}].",
                decisive.len(), band_lo, band_hi
            );
            let (hp, v) = &decisive[decisive.len() / 2];
            eprintln!(
                "  e.g. hp={:.0}: stand={:+} lay={:+} policy={:+} depth={}",
                hp, v.stand.outcome, v.lay.outcome, v.policy.outcome, v.depth
            );
            match first_miss {
                Some((hp, best, pol, which)) => {
                    eprintln!(
                        "  >>> POLICY MISS: a fixed {which} script reaches outcome {best:+}, policy \
                         only {pol:+} at ({}, defender_start_hp={hp:.0}).",
                        probe.name
                    );
                    // A win/draw flip at the cap can be a "didn't finish in
                    // time" artifact, not a real decisive miss: with a longer
                    // horizon the policy may still reach the same class, just
                    // slower. Re-check stand vs policy at 3x the horizon (cheap
                    // - no oracle) to separate the two.
                    let long = 3.0 * FINDER_MAX_TIME;
                    let s = build(hp, long);
                    let cfg = oracle_config(&s);
                    let (se, _, _) = run_script_raw(&s, &cfg, long, &[]);
                    let stand_long =
                        oracle_objective(se.a_hp, se.b_hp, se.a_death, se.b_death, self_is_attacker);
                    let policy_long = policy_value(&s, &cfg, long);
                    if policy_long.outcome >= stand_long.outcome {
                        eprintln!(
                            "      cap artifact: at {long:.0}s policy {:+} matches stand {:+} - the \
                             miss was finish-in-time only, not decisive.",
                            policy_long.outcome, stand_long.outcome
                        );
                    } else {
                        eprintln!(
                            "      CONFIRMED at {long:.0}s: policy {:+} still below stand {:+} - a real \
                             decisive miss.",
                            policy_long.outcome, stand_long.outcome
                        );
                    }
                }
                None => {
                    eprintln!("  policy holds the best class at every decisive point (no bracket miss).")
                }
            }
            // Affordable oracle bonus on the representative decisive point:
            // catch a miss no fixed stand/lay bracket can express.
            if v.depth <= FINDER_ORACLE_MAX_DECISIONS {
                let scenario = build(*hp, FINDER_MAX_TIME);
                let config = oracle_config(&scenario);
                let oracle = oracle_best(&scenario, &config, FINDER_MAX_TIME);
                if oracle.outcome > v.policy.outcome {
                    eprintln!(
                        "  >>> ORACLE MISS at hp={hp:.0}: oracle {:+} > policy {:+}.",
                        oracle.outcome, v.policy.outcome
                    );
                } else {
                    eprintln!("  oracle confirms policy holds the best class at hp={hp:.0}.");
                }
            }
        }

        // Resurrection / beta-soundness sample: at the band extremes the fight
        // is a blowout, so posture MUST be non-decisive. Confirm stand, lay
        // and policy share the class, and (when affordable) that the full
        // oracle cannot flip it either - the honesty check that the screen is
        // not skipping real decisive fights.
        for hp in [lo, hi] {
            let r = outcome_at(build, hp, self_is_attacker);
            let agree = r.stand.outcome == r.lay.outcome && r.lay.outcome == r.policy.outcome;
            eprint!(
                "  resurrect hp={:.0}: stand={:+} lay={:+} policy={:+} agree={}",
                hp, r.stand.outcome, r.lay.outcome, r.policy.outcome, agree
            );
            if r.depth <= FINDER_ORACLE_MAX_DECISIONS {
                let scenario = build(hp, FINDER_MAX_TIME);
                let config = oracle_config(&scenario);
                let oracle = oracle_best(&scenario, &config, FINDER_MAX_TIME);
                eprintln!(
                    " | oracle={:+} (posture {})",
                    oracle.outcome,
                    if oracle.outcome == r.stand.outcome { "inert" } else { "FLIPS - screen unsound!" }
                );
            } else {
                eprintln!(" | oracle skipped ({} decisions)", r.depth);
            }
        }
    }

    #[test]
    #[ignore]
    fn find_decisive_fights() {
        run_decisive_finder(finder_scenario_korathos_golgaroth);
        run_decisive_finder(finder_scenario_opra_gimon);
    }

    /// Best game-truth value reachable by a `<=2`-switch posture script:
    /// all-stand (`[]`), sustained-lay (`[StartLay]`), and every single
    /// lay-window (StartLay at coarse decision index `i`, StandUp at `j>i`)
    /// over a coarse grid derived from the fight's decision count `k`. This is
    /// the candidate cheap "switch-point oracle": O(grid^2) forced fights, no
    /// 4^k enumeration.
    /// Best game-truth value over lay-window scripts: all-stand, sustained-lay,
    /// and every choice of `windows` disjoint lay-windows whose start/stop
    /// decision indices come from a coarse grid of `segs+1` knobs across the
    /// fight's `k` decisions. `windows=1` is the single-lay-window oracle;
    /// higher `windows` / finer `segs` test whether a richer switch schedule
    /// reaches a better outcome CLASS (the convergence check at scale).
    /// O(knobs^(2*windows)) forced fights - no 4^k enumeration.
    fn best_lay_window_oracle(
        build: fn(f64, f64) -> BenchmarkScenario,
        hp: f64,
        h: f64,
        k: usize,
        self_is_attacker: bool,
        segs: usize,
        windows: usize,
    ) -> OracleValue {
        let s = build(hp, h);
        let cfg = oracle_config(&s);
        let eval = |script: &[PostureAction]| {
            let (e, _, _) = run_script_raw(&s, &cfg, h, script);
            oracle_objective(e.a_hp, e.b_hp, e.a_death, e.b_death, self_is_attacker)
        };
        let mut best = eval(&[]);
        let sustained = eval(&[PostureAction::StartLay]);
        if sustained > best {
            best = sustained;
        }
        let mut knobs: Vec<usize> = (0..=segs).map(|f| f * k / segs).collect();
        knobs.dedup();
        // Alternating StartLay / StandUp at the chosen ascending indices.
        let build_script = |idx: &[usize]| -> Vec<PostureAction> {
            let last = *idx.last().unwrap();
            let mut script = vec![PostureAction::Stay; last + 1];
            for (pos, &at) in idx.iter().enumerate() {
                script[at] = if pos % 2 == 0 {
                    PostureAction::StartLay
                } else {
                    PostureAction::StandUp
                };
            }
            script
        };
        let n = knobs.len();
        match windows {
            1 => {
                for a in 0..n {
                    for b in (a + 1)..n {
                        let v = eval(&build_script(&[knobs[a], knobs[b]]));
                        if v > best {
                            best = v;
                        }
                    }
                }
            }
            2 => {
                for a in 0..n {
                    for b in (a + 1)..n {
                        for c in (b + 1)..n {
                            for d in (c + 1)..n {
                                let v = eval(&build_script(&[knobs[a], knobs[b], knobs[c], knobs[d]]));
                                if v > best {
                                    best = v;
                                }
                            }
                        }
                    }
                }
            }
            _ => unreachable!("windows must be 1 or 2"),
        }
        best
    }

    /// The coarse single-lay-window oracle validated class-complete on short
    /// fights: `best_lay_window_oracle` with 7 knobs and one window.
    fn best_rare_switch(
        build: fn(f64, f64) -> BenchmarkScenario,
        hp: f64,
        h: f64,
        k: usize,
        self_is_attacker: bool,
    ) -> OracleValue {
        best_lay_window_oracle(build, hp, h, k, self_is_attacker, 6, 1)
    }

    /// SOUNDNESS test for the coarse switch-point oracle. On SHORT fights
    /// where the exhaustive `oracle_best` (4^k) is affordable (k <=
    /// FINDER_ORACLE_MAX_DECISIONS), is the best `<=2`-switch script's outcome
    /// CLASS equal to the true best class `oracle_best` finds? `oracle_best`
    /// enumerates ALL scripts, so `oracle >= rare` always; class-completeness
    /// of the cheap oracle is exactly `rare.outcome == oracle.outcome`
    /// everywhere on the decisive shell. Any point where `oracle.outcome >
    /// rare.outcome` is a counterexample: fine per-tick precision reaches a
    /// CLASS no coarse lay-window can, so the cheap oracle is unsound and the
    /// decisive-shell verifier needs more than coarse switch points.
    ///
    /// `#[ignore]`: run with
    /// `cargo test --lib composable::oracle::tests::validate_coarse_switch_oracle -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn validate_coarse_switch_oracle() {
        let pairs: [ScenarioCase; 2] = [
            (finder_scenario_korathos_golgaroth, "Korathos/Golgaroth"),
            (finder_scenario_opra_gimon, "Opra/Gimon"),
        ];
        // Short horizon: keep decisive-shell k within the exhaustive oracle's
        // affordable regime (k <= 9).
        let h = 25.0;
        let sweep = 80usize;
        for (build, name) in pairs {
            let probe = build(1.0, h);
            let self_is_attacker = probe.self_is_attacker;
            let base = probe.defender.health;
            let lo = base * 0.05;
            let hi = base * 1.30;
            let mut checked = 0usize;
            let mut class_match = 0usize;
            let mut skipped_deep = 0usize;
            let mut mismatches: Vec<String> = Vec::new();
            for i in 0..=sweep {
                let hp = lo + (hi - lo) * (i as f64) / (sweep as f64);
                let s = build(hp, h);
                let cfg = oracle_config(&s);
                let (se, _, k_s) = run_script_raw(&s, &cfg, h, &[]);
                let (le, _, k_l) = run_script_raw(&s, &cfg, h, &[PostureAction::StartLay]);
                let so = oracle_objective(se.a_hp, se.b_hp, se.a_death, se.b_death, self_is_attacker);
                let lv = oracle_objective(le.a_hp, le.b_hp, le.a_death, le.b_death, self_is_attacker);
                if so.outcome == lv.outcome {
                    continue; // not decisive
                }
                let k = k_s.max(k_l);
                if k > FINDER_ORACLE_MAX_DECISIONS {
                    skipped_deep += 1;
                    continue;
                }
                let oracle = oracle_best(&s, &cfg, h);
                let rare = best_rare_switch(build, hp, h, k, self_is_attacker);
                checked += 1;
                if rare.outcome == oracle.outcome {
                    class_match += 1;
                } else {
                    mismatches.push(format!(
                        "hp={hp:.0} k={k}: oracle class {:+} > coarse-switch {:+}",
                        oracle.outcome, rare.outcome
                    ));
                }
            }
            eprintln!(
                "\n=== coarse switch-point oracle soundness: {name} (H={h:.0}s) ===\n  decisive+affordable checked={checked}, class-complete={class_match}/{checked}, deep-skipped={skipped_deep}"
            );
            if mismatches.is_empty() {
                eprintln!("  no counterexample: coarse switch-point oracle is class-complete vs oracle_best here.");
            } else {
                eprintln!("  COUNTEREXAMPLES (cheap oracle unsound):");
                for m in &mismatches {
                    eprintln!("    {m}");
                }
            }
        }
    }

    /// SHORE-UP for the long-fight residual + the cost-reduction lever. On
    /// LONG fights the exhaustive oracle is dead, so we cannot compare the
    /// coarse switch-point oracle to it directly. Instead ask: does REFINING
    /// the switch schedule ever improve the outcome CLASS? Compare the coarse
    /// single-lay-window oracle (segs=6, windows=1 - validated class-complete
    /// on short fights) against a finer single-window (segs=12) and a
    /// two-window (segs=6, windows=2, toward the cyclic policy). Two payoffs if
    /// "richer never beats coarse in class":
    ///   - the coarse oracle has CONVERGED at scale (verifier long-fight
    ///     residual closed empirically), and
    ///   - the expensive cyclic per-tick policy is OVER-ENGINEERED for class
    ///     (its many switches buy HP-margin, not class) -> a cheap single-window
    ///     policy is class-equivalent, the Pass-E cost-reduction lever.
    ///
    /// `#[ignore]`: run with
    /// `cargo test --lib composable::oracle::tests::validate_switch_grid_convergence_long -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn validate_switch_grid_convergence_long() {
        let pairs: [ScenarioCase; 2] = [
            (finder_scenario_korathos_golgaroth, "Korathos/Golgaroth"),
            (finder_scenario_opra_gimon, "Opra/Gimon"),
        ];
        let horizons = [120.0, 300.0];
        let sweep = 30usize;
        for (build, name) in pairs {
            let probe = build(1.0, 120.0);
            let self_is_attacker = probe.self_is_attacker;
            let base = probe.defender.health;
            for &h in &horizons {
                let lo = base * 0.05;
                let hi = base * 1.30;
                let mut checked = 0usize;
                let mut exceed = 0usize;
                let mut examples: Vec<String> = Vec::new();
                for i in 0..=sweep {
                    let hp = lo + (hi - lo) * (i as f64) / (sweep as f64);
                    let s = build(hp, h);
                    let cfg = oracle_config(&s);
                    let (se, _, k_s) = run_script_raw(&s, &cfg, h, &[]);
                    let (le, _, k_l) = run_script_raw(&s, &cfg, h, &[PostureAction::StartLay]);
                    let so = oracle_objective(se.a_hp, se.b_hp, se.a_death, se.b_death, self_is_attacker);
                    let lv = oracle_objective(le.a_hp, le.b_hp, le.a_death, le.b_death, self_is_attacker);
                    if so.outcome == lv.outcome {
                        continue;
                    }
                    let k = k_s.max(k_l);
                    let coarse = best_lay_window_oracle(build, hp, h, k, self_is_attacker, 6, 1);
                    let fine = best_lay_window_oracle(build, hp, h, k, self_is_attacker, 12, 1);
                    let two = best_lay_window_oracle(build, hp, h, k, self_is_attacker, 6, 2);
                    let richer = if fine >= two { fine } else { two };
                    checked += 1;
                    if richer.outcome > coarse.outcome {
                        exceed += 1;
                        examples.push(format!(
                            "hp={hp:.0} k={k}: coarse class {:+} < richer {:+}",
                            coarse.outcome, richer.outcome
                        ));
                    }
                }
                eprintln!(
                    "\n=== switch-grid convergence (long): {name} H={h:.0}s ===\n  decisive checked={checked}, richer-beats-coarse-in-class={exceed}"
                );
                if exceed == 0 {
                    eprintln!("  CONVERGED: finer/multi-window never improves the class (coarse oracle sound at scale; cyclic policy over-engineered for class).");
                } else {
                    eprintln!("  richer schedule reaches a class the coarse single-window cannot:");
                    for e in &examples {
                        eprintln!("    {e}");
                    }
                }
            }
        }
    }

    /// Measure `k_effective` - the number of MY-side posture decisions that
    /// fire before a fight resolves - on the DECISIVE shell, across growing
    /// horizons. This settles the Pass-B binding question the tournament could
    /// only guess at: is the exact `4^k` oracle affordable on the shell that
    /// matters (k ~ 4-9, the synthesis's hope), or is it dominated by
    /// k > 12 / cap-bound fights (the refuter's claim that "laying trades
    /// early offense for late survival, so decisive divergence is late")?
    ///
    /// Cheap by construction: only the two forced scripts (stand = all-Stay,
    /// sustained-lay) per point - NO policy search, NO oracle enumeration. So
    /// it runs at 300s horizons in seconds. `k = max(k_stand, k_lay)` is a
    /// sound lower bound on the oracle's DFS depth (the deepest enumerated
    /// path is at least as long as the longest-surviving fixed script); if it
    /// already exceeds 12 the exhaustive oracle is intractable there.
    ///
    /// `#[ignore]`: run with
    /// `cargo test --lib composable::oracle::tests::measure_decisive_shell_k -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn measure_decisive_shell_k() {
        let pairs: [ScenarioCase; 2] = [
            (finder_scenario_korathos_golgaroth, "Korathos/Golgaroth (policy=attacker)"),
            (finder_scenario_opra_gimon, "Opra/Gimon (policy=defender)"),
        ];
        let horizons = [30.0, 60.0, 120.0, 300.0];
        let steps = 60usize;
        for (build, name) in pairs {
            let probe = build(1.0, 30.0);
            let self_is_attacker = probe.self_is_attacker;
            let base = probe.defender.health;
            eprintln!("\n=== k_effective on the decisive shell: {name} | base def HP {base:.0} ===");
            eprintln!("(decisive = stand and sustained-lay land in different outcome classes; vs frozen opponent)");
            for &h in &horizons {
                let lo = base * 0.05;
                let hi = base * 1.30;
                let mut ks: Vec<usize> = Vec::new();
                let mut lay_resolved = 0usize;
                let mut cap_draw = 0usize;
                for i in 0..=steps {
                    let hp = lo + (hi - lo) * (i as f64) / (steps as f64);
                    let s = build(hp, h);
                    let cfg = oracle_config(&s);
                    let (se, _, k_s) = run_script_raw(&s, &cfg, h, &[]);
                    let (le, _, k_l) = run_script_raw(&s, &cfg, h, &[PostureAction::StartLay]);
                    let so = oracle_objective(se.a_hp, se.b_hp, se.a_death, se.b_death, self_is_attacker);
                    let lo_v = oracle_objective(le.a_hp, le.b_hp, le.a_death, le.b_death, self_is_attacker);
                    if so.outcome != lo_v.outcome {
                        ks.push(k_s.max(k_l));
                        if le.a_death.is_some() || le.b_death.is_some() {
                            lay_resolved += 1;
                        } else {
                            cap_draw += 1;
                        }
                    }
                }
                if ks.is_empty() {
                    eprintln!("  H={h:>5.0}s: no decisive points in band");
                    continue;
                }
                ks.sort_unstable();
                let (min, med, max) = (ks[0], ks[ks.len() / 2], ks[ks.len() - 1]);
                let over12 = ks.iter().filter(|&&k| k > 12).count();
                eprintln!(
                    "  H={h:>5.0}s: {} decisive pts | k(min/med/max)={min}/{med}/{max} | k>12: {over12}/{} | lay-resolved {lay_resolved}, cap-draw {cap_draw}",
                    ks.len(), ks.len()
                );
            }
        }
    }

    /// Probe the "rare-regime" hypothesis behind the Pass-B re-open: the
    /// k-explosion (k=22-117 on the decisive shell) comes from the per-tick
    /// 5 s decision grid, but does the decision actually CARRY that
    /// complexity? Two cheap measurements on the decisive shell:
    ///
    /// (a) SWITCHES - how many non-Stay actions the live per-tick policy
    ///     actually issues in its realized trajectory. If this stays small
    ///     (~2-4) while k grows with horizon, the 4^k enumeration is mostly
    ///     Stay/Stay/Stay overhead, NOT genuine decision complexity - so an
    ///     oracle re-cast over SWITCH points (when to start/stop laying) is
    ///     tractable, and the decision can be a rare regime choice.
    /// (b) SUFFICIENCY - does the best <=2-switch script (a single lay-window
    ///     over a coarse grid, plus all-stand / sustained-lay) reach the live
    ///     policy's outcome CLASS? If yes, few switches suffice - the
    ///     rare-regime recast loses nothing on the shell.
    ///
    /// `#[ignore]`: run with
    /// `cargo test --lib composable::oracle::tests::probe_regime_hypothesis -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn probe_regime_hypothesis() {
        let pairs: [ScenarioCase; 2] = [
            (finder_scenario_korathos_golgaroth, "Korathos/Golgaroth (policy=attacker)"),
            (finder_scenario_opra_gimon, "Opra/Gimon (policy=defender)"),
        ];
        let horizons = [60.0, 120.0];
        let sweep = 40usize;

        for (build, name) in pairs {
            let probe = build(1.0, 60.0);
            let self_is_attacker = probe.self_is_attacker;
            let base = probe.defender.health;
            eprintln!("\n=== regime hypothesis: {name} | base def HP {base:.0} ===");
            for &h in &horizons {
                let lo = base * 0.05;
                let hi = base * 1.30;
                // Collect decisive HPs (cheap stand/lay screen).
                let mut decisive_hps: Vec<f64> = Vec::new();
                for i in 0..=sweep {
                    let hp = lo + (hi - lo) * (i as f64) / (sweep as f64);
                    let s = build(hp, h);
                    let cfg = oracle_config(&s);
                    let (se, _, _) = run_script_raw(&s, &cfg, h, &[]);
                    let (le, _, _) = run_script_raw(&s, &cfg, h, &[PostureAction::StartLay]);
                    let so = oracle_objective(se.a_hp, se.b_hp, se.a_death, se.b_death, self_is_attacker);
                    let lv = oracle_objective(le.a_hp, le.b_hp, le.a_death, le.b_death, self_is_attacker);
                    if so.outcome != lv.outcome {
                        decisive_hps.push(hp);
                    }
                }
                if decisive_hps.is_empty() {
                    eprintln!("  H={h:>5.0}s: no decisive points");
                    continue;
                }
                // Sample up to 3 evenly across the decisive band (policy runs
                // are the expensive part: ~260 inner replays per decision).
                let n = decisive_hps.len();
                let picks: Vec<f64> = [0, n / 2, n - 1]
                    .iter()
                    .map(|&idx| decisive_hps[idx])
                    .collect();
                for hp in picks {
                    let s = build(hp, h);
                    let cfg = oracle_config(&s);
                    let script = policy_realized_script(&s, &cfg, h);
                    let k = script.len();
                    let switches = script
                        .iter()
                        .filter(|a| !matches!(a, PostureAction::Stay))
                        .count();
                    let policy = policy_value(&s, &cfg, h);
                    let rare = best_rare_switch(build, hp, h, k, self_is_attacker);
                    let suffices = rare.outcome >= policy.outcome;
                    eprintln!(
                        "  H={h:>5.0}s hp={hp:>7.0}: k={k:>3} switches={switches} | policy={:+} best<=2-switch={:+} | rare suffices: {}",
                        policy.outcome,
                        rare.outcome,
                        if suffices { "YES" } else { "NO" }
                    );
                }
            }
        }
    }

    /// Measure the live posture policy's COMPUTE COST at real scale - the
    /// owner's #1 concern and the named prerequisite for the Pass-E cost
    /// recast. Cost unit = engine iterations (deterministic, per pillars section 10),
    /// counted by the `#[cfg(test)]` probe in `run_one_event_loop_iter` which
    /// - unlike the `bench_count` counter - also counts the iterations inside
    /// the policy's inner replays. Reports, at a long-running near-tie point,
    /// the ratio of (live policy on) to (no policy) iterations: the policy's
    /// compute multiplier.
    ///
    /// `#[ignore]` (slow: the live policy at 300s runs ~260 inner replays per
    /// decision x ~100+ decisions). Run with
    /// `cargo test --lib composable::oracle::tests::measure_live_policy_cost -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn measure_live_policy_cost() {
        let pairs: [ScenarioCase; 2] = [
            (finder_scenario_korathos_golgaroth, "Korathos/Golgaroth"),
            (finder_scenario_opra_gimon, "Opra/Gimon"),
        ];
        for (build, name) in pairs {
            let probe = build(1.0, 60.0);
            let base = probe.defender.health;
            eprintln!("\n=== live posture-policy compute cost: {name} (cost unit = engine iterations) ===");
            for &h in &[60.0, 120.0, 300.0] {
                // A mid-band point so the fight runs long (worst-case cost).
                let hp = base * 0.5;
                let s = build(hp, h);
                let on_cfg = oracle_config(&s);
                let mut off_cfg = ComposableAbilityConfig::default();
                (s.config_overrides)(&mut off_cfg);
                let _ = take_engine_iters();
                let _ = policy_value(&s, &off_cfg, h);
                let off = take_engine_iters();
                let _ = policy_value(&s, &on_cfg, h);
                let on = take_engine_iters();
                let ratio = on as f64 / (off.max(1)) as f64;
                eprintln!(
                    "  H={h:>5.0}s: baseline(no policy)={off} iters | live policy={on} iters | {ratio:.0}x",
                );
            }
        }
    }

    /// The Task-2 (cost-optimization) safety invariant: the live policy's full
    /// realized decision sequence - every `(side, PostureAction)` it commits, in
    /// firing order. An optimization is RESULT-PRESERVING iff it reproduces this
    /// exact sequence: same decisions in -> same engine output -> the
    /// frozen-opponent verification question (Task 1) cannot affect the outcome,
    /// so the optimization is decoupled from that blocker. Pinned to the action
    /// sequence, NOT outcome class or fitness-within-margin - class/fitness gates
    /// leak behavior on float-fragile near-ties (`POLICY_FITNESS_MARGIN`).
    fn full_decision_sequence(
        scenario: &BenchmarkScenario,
        config: &ComposableAbilityConfig,
        max_time: f64,
    ) -> Vec<(bool, PostureAction)> {
        crate::composable::stance_bridge::arm_decision_recorder();
        let _ = policy_value(scenario, config, max_time);
        crate::composable::stance_bridge::take_decision_recording()
    }

    /// Decision-identity regression GATE for Task 2. Captures the shipped
    /// policy's decision sequence across the corpus at real-scale horizons and
    /// confirms the capture is stable (deterministic re-run). Once a cost
    /// optimization lands behind a flag, the comparison test asserts the
    /// flag-on sequence EQUALS this flag-off baseline - that is the
    /// result-preserving proof. Also reports the decision count (the cost scale
    /// the optimization must cut).
    ///
    /// `#[ignore]`: run with
    /// `cargo test --lib composable::oracle::tests::decision_identity_gate -- --ignored --nocapture`.
    /// Capture the full decision sequence with the tree-checkpoint flag forced
    /// to `on` (DFS) or `off` (nested loops) via the test-only override.
    fn decision_sequence_with_checkpoint(
        scenario: &BenchmarkScenario,
        config: &ComposableAbilityConfig,
        max_time: f64,
        on: bool,
    ) -> Vec<(bool, PostureAction)> {
        crate::composable::stance_bridge::set_tree_checkpoint_override(Some(on));
        let seq = full_decision_sequence(scenario, config, max_time);
        crate::composable::stance_bridge::set_tree_checkpoint_override(None);
        seq
    }

    #[test]
    #[ignore]
    fn decision_identity_gate() {
        for max_time in [50.0, 500.0] {
            eprintln!("\n=== decision-identity: flag-off vs flag-on @ {max_time:.0}s ===");
            for scenario in build_scenarios() {
                let config = oracle_config(&scenario);
                let off = decision_sequence_with_checkpoint(&scenario, &config, max_time, false);
                let on = decision_sequence_with_checkpoint(&scenario, &config, max_time, true);
                assert_eq!(
                    off, on,
                    "{} @ {max_time}s: checkpoint DFS (on) must emit the IDENTICAL decision sequence as the nested loops (off)",
                    scenario.name
                );
                eprintln!("  {:<55} {} decisions — identical", scenario.name, off.len());
            }
        }
    }

    /// Measure the checkpoint DFS speedup: engine iterations with the
    /// tree-checkpoint flag OFF (nested loops) vs ON (shared-prefix DFS) on the
    /// same decisive fight. Decision-identity is already proven by
    /// `decision_identity_gate`; this is the honest speedup number.
    ///
    /// `#[ignore]`: run with
    /// `cargo test --lib composable::oracle::tests::measure_checkpoint_speedup -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn measure_checkpoint_speedup() {
        let pairs: [ScenarioCase; 2] = [
            (finder_scenario_korathos_golgaroth, "Korathos/Golgaroth"),
            (finder_scenario_opra_gimon, "Opra/Gimon"),
        ];
        for (build, name) in pairs {
            let probe = build(1.0, 60.0);
            let base = probe.defender.health;
            eprintln!("\n=== checkpoint DFS speedup: {name} (engine iterations, off vs on) ===");
            for &h in &[60.0, 120.0, 300.0] {
                let s = build(base * 0.5, h);
                let cfg = oracle_config(&s);
                crate::composable::stance_bridge::set_tree_checkpoint_override(Some(false));
                let _ = take_engine_iters();
                let _ = policy_value(&s, &cfg, h);
                let off = take_engine_iters();
                crate::composable::stance_bridge::set_tree_checkpoint_override(Some(true));
                let _ = take_engine_iters();
                let _ = policy_value(&s, &cfg, h);
                let on = take_engine_iters();
                crate::composable::stance_bridge::set_tree_checkpoint_override(None);
                let speedup = off as f64 / on.max(1) as f64;
                eprintln!("  H={h:>5.0}s: off={off} iters | on={on} iters | {speedup:.2}x");
            }
        }
    }

    /// Reproduce the Healing-Pulse policy-cost blow-up and split it into its
    /// two suspected terms: bounded WINDOWED replays vs unbounded death-race
    /// EXACT re-runs. Posture policy ON (the driver); Healing Pulse toggled on
    /// the same balanced fight. Confirms which term dominates (the convergence
    /// said exact re-run; the adversarial verifier said windowed) and by what
    /// factor, on a death-race-adjacent matchup like the owner's.
    ///
    /// `#[ignore]`: run with
    /// `cargo test --lib composable::oracle::tests::measure_healing_pulse_cost -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn measure_healing_pulse_cost() {
        let pairs: [ScenarioCase; 2] = [
            (finder_scenario_korathos_golgaroth, "Korathos/Golgaroth"),
            (finder_scenario_opra_gimon, "Opra/Gimon"),
        ];
        let h = 300.0;
        for (build, name) in pairs {
            let probe = build(1.0, h);
            let base = probe.defender.health;
            eprintln!("\n=== Healing Pulse cost: {name} (posture ON, H={h:.0}s) ===");
            for hp_frac in [0.5_f64, 0.85_f64] {
                let s = build(base * hp_frac, h);
                let measure = |healing: bool| {
                    let mut cfg = oracle_config(&s);
                    cfg.attacker_healing_pulse = healing; // normal mode (once=false) heals both sides
                    // Force the nested-loop path so EVERY inner replay goes
                    // through run_replay (the instrumented path) - the DFS tree
                    // bypasses note_replay, which would undercount windowed iters.
                    crate::composable::stance_bridge::set_tree_checkpoint_override(Some(false));
                    let _ = take_engine_iters();
                    let _ = take_replay_stats();
                    let _ = take_phase_counts();
                    reset_capped_dump();
                    reset_crawl_snap();
                    let _ = policy_value(&s, &cfg, h);
                    let r = (take_engine_iters(), take_replay_stats(), take_phase_counts());
                    crate::composable::stance_bridge::set_tree_checkpoint_override(None);
                    r
                };
                let (off_it, off, off_ph) = measure(false);
                let (on_it, on, on_ph) = measure(true);
                // Proof-of-live: snapshot rows written + capped replays flushed
                // by the ON run, cross-checked against the ON capped_replays
                // tally from take_replay_stats (`on.capped_replays`).
                let (snap_hits, snap_flushed) = take_crawl_snap_liveness();
                eprintln!(
                    "    [crawl-probe liveness] snapshot_rows_written={snap_hits} capped_replays_flushed={snap_flushed} (cross-check on.capped_replays={})",
                    on.capped_replays
                );
                eprintln!("  defender_start_hp={:.0}", base * hp_frac);
                eprintln!(
                    "    OFF total={off_it:>9} | windowed {:>5}r/{:>9}it | exact {:>4}r/{:>9}it | capped={} bothDeadExit={}",
                    off.windowed_replays, off.windowed_iters, off.exact_replays, off.exact_iters, off.capped_replays, off.both_dead_exits
                );
                eprintln!(
                    "    ON  total={on_it:>9} | windowed {:>5}r/{:>9}it | exact {:>4}r/{:>9}it | capped={} bothDeadExit={}",
                    on.windowed_replays, on.windowed_iters, on.exact_replays, on.exact_iters, on.capped_replays, on.both_dead_exits
                );
                let avg = |it: u64, r: u64| it as f64 / r.max(1) as f64;
                eprintln!(
                    "    avg iters/windowed-replay: OFF {:.0} -> ON {:.0} ({:.1}x) | avg/exact: OFF {:.0} -> ON {:.0}",
                    avg(off.windowed_iters, off.windowed_replays), avg(on.windowed_iters, on.windowed_replays),
                    avg(on.windowed_iters, on.windowed_replays) / avg(off.windowed_iters, off.windowed_replays).max(1.0),
                    avg(off.exact_iters, off.exact_replays), avg(on.exact_iters, on.exact_replays),
                );
                eprintln!(
                    "    ON capped replays={} | avg sim-time advanced per capped replay = {:.2}s (5000 iters) -> {}",
                    on.capped_replays,
                    on.capped_elapsed_sum / (on.capped_replays.max(1) as f64),
                    if on.capped_replays > 0 && on.capped_elapsed_sum / (on.capped_replays.max(1) as f64) < 5.0 { "SAME-TIME EVENT STORM (time barely advances)" } else { "dense-but-bounded window" }
                );
                eprintln!(
                    "    => total {:.2}x | windowed-iters {:.2}x | exact-iters {:.2}x | exact share of ON total: {:.0}%",
                    on_it as f64 / off_it.max(1) as f64,
                    on.windowed_iters as f64 / off.windowed_iters.max(1) as f64,
                    on.exact_iters as f64 / off.exact_iters.max(1) as f64,
                    100.0 * on.exact_iters as f64 / on_it.max(1) as f64,
                );
                let labels = ["StatusTicks", "StatusDecay", "Regen", "Bite", "Breath", "ActiveAbil"];
                let phase_line = |tag: &str, p: [u64; 6]| {
                    let tot: u64 = p.iter().sum();
                    let parts: Vec<String> = (0..6)
                        .map(|i| format!("{}={} ({:.0}%)", labels[i], p[i], 100.0 * p[i] as f64 / tot.max(1) as f64))
                        .collect();
                    eprintln!("    phases {tag}: {}", parts.join("  "));
                };
                phase_line("OFF", off_ph);
                phase_line("ON ", on_ph);
            }
        }
    }

    /// Regression gate for the stale-timer crawl. With the intake forward-
    /// filter in place, no inner replay may hit `REPLAY_MAX_ITERS` on the
    /// Healing-Pulse death-race matchup that used to storm (Opra/Gimon, ~4100
    /// capped replays before the fix). A capped replay hands the posture
    /// fitness a truncated end-state, so `capped == 0` is what guarantees
    /// every stance is scored from a fully-resolved replay.
    #[test]
    fn healing_pulse_replays_never_cap() {
        let h = 300.0;
        let base = finder_scenario_opra_gimon(1.0, h).defender.health;
        let s = finder_scenario_opra_gimon(base * 0.85, h);
        let mut cfg = oracle_config(&s);
        cfg.attacker_healing_pulse = true;
        // Force the nested-loop replay path so every inner replay flows
        // through the instrumented run_replay (the DFS tree bypasses it).
        crate::composable::stance_bridge::set_tree_checkpoint_override(Some(false));
        let _ = take_replay_stats();
        let _ = policy_value(&s, &cfg, h);
        let stats = take_replay_stats();
        crate::composable::stance_bridge::set_tree_checkpoint_override(None);
        assert_eq!(
            stats.capped_replays, 0,
            "Healing Pulse inner replay hit the iter cap ({} capped) - a stale \
             timer is pinning the scheduler and truncating the scored end-state",
            stats.capped_replays
        );
    }

    /// delta-bracket: does the posture policy keep the right OUTCOME CLASS when the
    /// opponent RE-POSTURES (not frozen)? For each moving opponent script,
    /// compare the live policy's game-truth value to the exhaustive oracle-best,
    /// both with the opponent following the script; `policy.outcome <
    /// oracle.outcome` is a decisive class miss vs a moving opponent - the
    /// residual the frozen-`Hold` finder could not see. `#[ignore]`: heavy
    /// (exhaustive 4^k oracle); run with `--ignored --nocapture`.
    #[test]
    #[ignore]
    fn scripted_opponent_bracket() {
        let pairs: [ScenarioCase; 2] = [
            (finder_scenario_korathos_golgaroth, "Korathos/Golgaroth"),
            (finder_scenario_opra_gimon, "Opra/Gimon"),
        ];
        // Short horizon keeps the exhaustive 4^k oracle tractable (k ~ H/5).
        let h = 25.0;
        let scripts = [
            (OpponentScript::AlwaysStand, "AlwaysStand"),
            (OpponentScript::SustainedLay, "SustainedLay"),
            (OpponentScript::LayPulse, "LayPulse"),
        ];
        let mut misses = 0u32;
        for (build, name) in pairs {
            let base = build(1.0, h).defender.health;
            for hp_frac in [0.5_f64, 0.85_f64] {
                let s = build(base * hp_frac, h);
                let mut cfg = oracle_config(&s);
                // Enable the OPPONENT's posture policy so its scripted
                // decisions fire on its own grid.
                if s.self_is_attacker {
                    cfg.defender_posture_policy_enabled = true;
                } else {
                    cfg.attacker_posture_policy_enabled = true;
                }
                eprintln!("\n=== {name} (defender_hp={:.0}, H={h:.0}s) ===", base * hp_frac);
                for (script, sname) in scripts {
                    set_finder_opponent(Some(script));
                    let oracle = oracle_best(&s, &cfg, h);
                    set_finder_opponent(None);
                    let policy = policy_value_vs(&s, &cfg, h, Some(script));
                    let class_miss = policy.outcome < oracle.outcome;
                    if class_miss {
                        misses += 1;
                    }
                    eprintln!(
                        "    vs {sname:<12}: oracle={oracle:?} policy={policy:?} {}",
                        if class_miss { "<-- DECISIVE MISS" } else { "ok" }
                    );
                }
            }
        }
        eprintln!("\n  total decisive class-misses vs moving opponents: {misses}");
    }

    /// Replay-family cost-discipline guard (pillars section 10 carve-out, made explicit
    /// and regression-guarded). The posture decision is engine-replay (clones the
    /// state across ~260 candidate plans), so it is structurally far costlier than
    /// the <=1 ms timed/toggle decisions in `policy/tests/cost_budget.rs` and is
    /// deliberately EXEMPT from that budget. Pin a replay-family ceiling in
    /// DETERMINISTIC engine iterations (no wall-clock -> no CI flake), so a
    /// structural regression (an unbounded replay window, or re-running the full
    /// fight per candidate) trips a test instead of silently slowing Compare.
    #[test]
    fn posture_decision_iteration_budget() {
        let h = 120.0;
        let base = finder_scenario_korathos_golgaroth(1.0, h).defender.health;
        let scenario = finder_scenario_korathos_golgaroth(base * 0.5, h);
        let config = oracle_config(&scenario);
        let event_phase_order = default_event_phase_order();
        let (mut state, flags) = build_initial_state(&scenario, &config);
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
            max_time_sec: h,
            bench_count: false,
            posture_policy_override: PosturePolicyMode::Normal,
            iter_hooks: IterHooks::default(),
            decide_override: None,
            decide_override_respects_schedule: false,
            decide_bite_variant_override: None,
            decide_toggle_override: None,
            ability_policy_mode: AbilityPolicyMode::Normal,
        };
        let _ = take_engine_iters(); // reset the global counter
        let _ = crate::composable::stance_bridge::decide_stance_now(&mut state, &params, scenario.self_is_attacker);
        let iters = take_engine_iters();
        eprintln!("posture decide_stance_now: {iters} engine iters");
        // Measured ~9.5k iters (Korathos/Golgaroth mid-band @120s). Ceiling ~ 3x
        // - a structural-regression guard, not a tight SLA (the replay family is
        // exempt from the 1 ms timed budget by design; a real regression is
        // orders of magnitude, e.g. an unbounded window or a per-candidate full
        // fight). Re-derive if the replay window / candidate count changes.
        const POSTURE_DECISION_ITER_BUDGET: u64 = 30_000;
        assert!(
            iters < POSTURE_DECISION_ITER_BUDGET,
            "posture decide_stance_now ran {iters} engine iters, over the \
             replay-family budget {POSTURE_DECISION_ITER_BUDGET} - a structural \
             cost regression (unbounded window / per-candidate full fight?)"
        );
    }
}
