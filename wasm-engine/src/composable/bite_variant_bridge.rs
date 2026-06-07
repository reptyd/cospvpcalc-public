//! Bridge between the composable engine and the
//! [`BiteVariantReplayDecision`](crate::policy::traits::BiteVariantReplayDecision)
//! trait family in `policy::`.
//!
//! Same pattern as `stance_bridge.rs` for posture: the engine
//! implements the trait surface ([`BiteVariantSideView`],
//! [`BiteVariantReplayer`]) over its private `LoopState` /
//! `LoopParams` / `CombatSide` types so the decision itself stays
//! engine-agnostic and lives entirely in
//! `policy/decisions/bite_variant.rs`.
//!
//! ## Entry point
//!
//! [`resolve_via_engine_replay`] is called from
//! `composable/loop_iter.rs::run_one_event_loop_iter` BEFORE
//! `process_phase_10_11_melee` for any side that:
//!   - is about to bite this iteration (`next_hit ≈ state.time`),
//!   - has `bite_variant_mode == Dynamic`,
//!   - has `damage2 > 0` (a real secondary attack),
//!   - and the caller didn't already install a
//!     `decide_bite_variant_override` (inner replays / benchmarks
//!     skip the engine-replay and consult the override directly).
//!
//! The pre-resolved variant is passed into the phase as
//! `Option<&'static str>`. The phase honors it iff the bite
//! actually fires (cocoon Phase 2 reschedules, posture
//! lay-gates, etc. may push `next_hit` past the iter - in those
//! cases the pre-resolved variant is dropped without effect, only
//! the projection cost is wasted).
//!
//! ## Recursion guard
//!
//! The inner replay runs with
//! `decide_bite_variant_override = Some(plan_closure)`, which
//! short-circuits `resolve_bite_variant_*` BEFORE this bridge is
//! called recursively. Posture decisions inside the inner replay
//! are disabled via `posture_policy_override: ForcedOff` so they
//! don't kick off their own (expensive) engine-replay.

use std::cell::Cell;

use crate::policy::decisions::bite_variant::{
    BuiltinBiteVariantReplayDecision, PRIMARY_VARIANT, SECONDARY_VARIANT,
};
use crate::policy::traits::{
    BiteVariant, BiteVariantReplayDecision, BiteVariantReplayer, BiteVariantSideView,
};

use super::loop_iter::{
    run_one_event_loop_iter, BiteVariantOverrideFn, IterHooks, LoopOutcome, LoopParams, LoopState,
    PosturePolicyMode,
};
use super::posture_policy::{compute_replay_fitness, REPLAY_MAX_ITERS};

/// Resolve the bite variant for `self_is_attacker`'s side via
/// engine-replay. Returns one of `PRIMARY_VARIANT` /
/// `SECONDARY_VARIANT`.
pub(super) fn resolve_via_engine_replay(
    state: &LoopState,
    params: &LoopParams<'_>,
    self_is_attacker: bool,
) -> &'static str {
    let actor_stats = if self_is_attacker {
        params.attacker
    } else {
        params.defender
    };
    if actor_stats.damage2 <= 0.0 {
        return PRIMARY_VARIANT;
    }

    let view = StaticBiteVariantView {
        has_secondary: true,
    };
    let mut replayer = LoopStateBiteVariantReplayer {
        state,
        params,
        self_is_attacker,
    };
    let decision = BuiltinBiteVariantReplayDecision::new();
    match decision.decide(&view, state.time, &mut replayer) {
        BiteVariant::Primary => PRIMARY_VARIANT,
        BiteVariant::Secondary => SECONDARY_VARIANT,
    }
}

/// Trivial view that reports a fixed `has_secondary` - the decision
/// itself only needs this one bit. The bridge knows
/// `damage2 > 0` before constructing the view, so we don't dive
/// into PolicyState / PolicySide for this.
struct StaticBiteVariantView {
    has_secondary: bool,
}

impl BiteVariantSideView for StaticBiteVariantView {
    fn has_secondary(&self) -> bool {
        self.has_secondary
    }
}

/// Engine-replay primitive: clones the engine state, installs the
/// candidate `plan` as the bite-variant override for the target
/// side, runs forward through `params.max_time_sec` (or until first
/// side death), then scores via [`compute_replay_fitness`].
struct LoopStateBiteVariantReplayer<'a> {
    state: &'a LoopState,
    params: &'a LoopParams<'a>,
    self_is_attacker: bool,
}

impl BiteVariantReplayer for LoopStateBiteVariantReplayer<'_> {
    fn replay_with_plan(
        &mut self,
        plan: &dyn Fn(u32, &dyn BiteVariantSideView) -> BiteVariant,
    ) -> f64 {
        let bite_idx = Cell::new(0u32);
        let self_is_attacker = self.self_is_attacker;
        let has_secondary_actor = if self_is_attacker {
            self.params.attacker.damage2 > 0.0
        } else {
            self.params.defender.damage2 > 0.0
        };

        let override_fn: Box<BiteVariantOverrideFn> =
            Box::new(move |_self_side, _opp_side, _time, is_attacker| {
                if is_attacker != self_is_attacker {
                    // Opp's bites use primary in the inner replay - a
                    // simplifying assumption matching `stance_bridge`'s
                    // passive-opp pattern. The trade we're scoring is
                    // for THIS side's variant choice; opp's bite stream
                    // stays consistent across both candidate plans.
                    return PRIMARY_VARIANT;
                }
                let view = StaticBiteVariantView {
                    has_secondary: has_secondary_actor,
                };
                let n = bite_idx.get();
                bite_idx.set(n + 1);
                match plan(n, &view) {
                    BiteVariant::Primary => PRIMARY_VARIANT,
                    BiteVariant::Secondary => SECONDARY_VARIANT,
                }
            });

        // Disable posture engine-replay inside the bite-variant inner
        // replay. Posture-replay would itself clone state and run an
        // inner-inner replay at every scheduled posture decision -
        // bounded by its own recursion guard but expensive (256 plans
        // × ~12 decisions × ~5 ms ≈ 15 s per posture call). Running
        // that under EVERY bite-variant replay (×120 per fight) is
        // unusable. ForcedOff freezes posture at its current pending
        // posture for the inner replay's duration; the bite-variant
        // trade is still scored correctly because both candidate
        // plans see the same frozen posture and only their bite
        // variant differs.
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
            max_time_sec: self.params.max_time_sec,
            bench_count: false,
            posture_policy_override: PosturePolicyMode::ForcedOff,
            iter_hooks: IterHooks::default(),
            decide_override: None,
            decide_override_respects_schedule: false,
            decide_bite_variant_override: Some(&override_fn),
        };

        let mut cloned = self.state.clone();
        cloned.same_time_processed_phases = 0;

        let mut iter_count: u32 = 0;
        while cloned.time + 1e-9 < self.params.max_time_sec
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
