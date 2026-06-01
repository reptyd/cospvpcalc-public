//! Bridge between the composable engine and the
//! [`StanceDecision`](crate::policy::traits::StanceDecision) trait
//! family in `policy::`.
//!
//! Same pattern as `policy_bridge.rs` for the rest of the policy
//! framework: the engine implements the trait surface
//! ([`StanceSideView`], [`StanceReplayer`]) over its private
//! `LoopState` / `LoopParams` / `CombatSide` types so the decision
//! itself stays engine-agnostic and lives entirely in
//! `policy/decisions/stance.rs`.
//!
//! ## Entry point
//!
//! [`decide_stance_now`] is called from
//! `composable/loop_iter.rs::run_one_event_loop_iter` whenever the
//! posture-policy block fires for a side. It consults the
//! registered stance decision (today: the built-in
//! [`BuiltinStanceReplayDecision`]) and returns the engine-internal
//! `PostureAction` the state machine then applies.
//!
//! ## Recursion guard
//!
//! Each inner engine-replay inside a stance decision runs the loop
//! with `posture_policy_override: ForcedOff`, so
//! `run_one_event_loop_iter` does NOT call back into
//! `decide_stance_now` from the inner replay. Without this guard the
//! replay would explode exponentially (each candidate plan calling
//! `decide_stance_now` calling `replay_with_plan` calling
//! `decide_stance_now` …).

use std::sync::OnceLock;

use crate::policy::decisions::stance::BuiltinStanceReplayDecision;
use crate::policy::traits::{
    StanceAction, StanceDecision, StancePosture, StanceReplayer, StanceSideView,
};

use super::loop_iter::{
    run_one_event_loop_iter, DecideOverrideFn, IterHooks, LoopOutcome, LoopParams, LoopState,
    PosturePolicyMode,
};
use super::posture::Posture;
use super::posture_policy::{
    compute_replay_fitness, PostureAction, REPLAY_HORIZON_SEC, REPLAY_MAX_ITERS,
};
use super::side::CombatSide;

/// Singleton stance decision. Today the only registered stance
/// decision; future user/constructor-built stance decisions would
/// be wired through a `DecisionRegistry`-aware lookup the same way
/// the rest of the policy framework already does.
fn stance_decision() -> &'static dyn StanceDecision {
    static D: OnceLock<BuiltinStanceReplayDecision> = OnceLock::new();
    D.get_or_init(BuiltinStanceReplayDecision::new)
}

/// Decide the posture action for `self_is_attacker`'s side at the
/// current `state.time`. Calls the registered stance decision with
/// engine-side adapters; translates the trait's [`StanceAction`]
/// back into the engine-internal [`PostureAction`] expected by
/// `apply_policy_action`.
pub(super) fn decide_stance_now(
    state: &LoopState,
    params: &LoopParams<'_>,
    self_is_attacker: bool,
) -> PostureAction {
    let actor_side = if self_is_attacker { &state.a } else { &state.b };
    let view = CombatSideStanceView { side: actor_side };
    let replay_horizon = (state.time + REPLAY_HORIZON_SEC).min(params.max_time_sec);
    let mut replayer = LoopStateReplayer {
        state,
        params,
        self_is_attacker,
        replay_horizon,
    };
    let action = stance_decision().decide(&view, state.time, &mut replayer);
    stance_to_posture_action(action)
}

/// Adapter exposing posture-relevant fields of a [`CombatSide`] to
/// the [`StanceSideView`] trait. Zero-cost — fields are read on
/// demand.
struct CombatSideStanceView<'a> {
    side: &'a CombatSide,
}

impl StanceSideView for CombatSideStanceView<'_> {
    fn pending_posture(&self) -> StancePosture {
        posture_to_stance(self.side.posture_pending)
    }
    fn next_regen_at(&self) -> f64 {
        self.side.next_regen
    }
    fn total_status_stacks(&self) -> f64 {
        self.side.statuses.values().map(|s| s.stacks).sum()
    }
}

/// Engine-replay primitive: clones the engine state, installs the
/// candidate `plan` as the posture-policy override, runs the real
/// engine forward with `posture_policy_override: ForcedOff` so the
/// inner replay never re-enters `decide_stance_now`, then scores
/// the outcome via [`compute_replay_fitness`].
struct LoopStateReplayer<'a> {
    state: &'a LoopState,
    params: &'a LoopParams<'a>,
    self_is_attacker: bool,
    replay_horizon: f64,
}

impl StanceReplayer for LoopStateReplayer<'_> {
    fn replay_with_plan(
        &mut self,
        plan: &dyn Fn(&dyn StanceSideView, f64) -> StanceAction,
    ) -> f64 {
        let self_is_attacker = self.self_is_attacker;
        // The override is consulted at each scheduled posture
        // decision moment inside the inner replay. Re-build the
        // StanceSideView on the live CombatSide at that moment so
        // dynamic plans (cyclic-*, status-decay, alternating-*) see
        // up-to-date next_regen / status stacks / pending posture.
        let override_fn: Box<DecideOverrideFn> = Box::new(
            move |ask_self: &CombatSide,
                  _opp: &CombatSide,
                  t: f64,
                  is_attacker: bool|
                  -> PostureAction {
                if is_attacker != self_is_attacker {
                    // Passive opponent during inner projection — same
                    // simplifying assumption as before the refactor.
                    return PostureAction::Stay;
                }
                let live_view = CombatSideStanceView { side: ask_self };
                stance_to_posture_action(plan(&live_view, t))
            },
        );

        let inner_params = LoopParams {
            attacker: self.params.attacker,
            defender: self.params.defender,
            attacker_breath: self.params.attacker_breath,
            defender_breath: self.params.defender_breath,
            config: self.params.config,
            flags: self.params.flags,
            ability_policy: self.params.ability_policy,
            event_phase_order: self.params.event_phase_order,
            record_trace: false,
            max_time_sec: self.replay_horizon,
            bench_count: false,
            posture_policy_override: PosturePolicyMode::Normal,
            iter_hooks: IterHooks::default(),
            decide_override: Some(&override_fn),
            decide_override_respects_schedule: true,
            decide_bite_variant_override: self.params.decide_bite_variant_override,
        };

        let mut cloned = self.state.clone();
        cloned.same_time_processed_phases = 0;

        let mut iter_count: u32 = 0;
        while cloned.time + 1e-9 < self.replay_horizon
            && (cloned.a.death_time.is_none() || cloned.b.death_time.is_none())
            && iter_count < REPLAY_MAX_ITERS
        {
            match run_one_event_loop_iter(&mut cloned, &inner_params) {
                LoopOutcome::Break | LoopOutcome::BoundExceeded => break,
                LoopOutcome::Continue | LoopOutcome::Advanced => {}
            }
            iter_count += 1;
        }

        compute_replay_fitness(
            cloned.a.hp.max(0.0),
            cloned.b.hp.max(0.0),
            cloned.a.death_time,
            cloned.b.death_time,
            cloned.hp_a_at_b_death,
            cloned.hp_b_at_a_death,
            self_is_attacker,
        )
    }
}

fn posture_to_stance(p: Posture) -> StancePosture {
    match p {
        Posture::Standing => StancePosture::Standing,
        Posture::Sitting => StancePosture::Sitting,
        Posture::Laying => StancePosture::Laying,
    }
}

fn stance_to_posture_action(a: StanceAction) -> PostureAction {
    match a {
        StanceAction::Stay => PostureAction::Stay,
        StanceAction::StartSit => PostureAction::StartSit,
        StanceAction::StartLay => PostureAction::StartLay,
        StanceAction::StandUp => PostureAction::StandUp,
    }
}
