//! Engine-replay toggle decisions (Hunker, Warden's Rage).
//!
//! Behind the `TOGGLE_ROLLOUT` flag these replace the precision-mode
//! analytic `ToggleDecision::on_off_delta` (deleted - it measured a
//! degenerate delta of ~0 for both toggles) with a held-plan ablation scored
//! by the real engine, mirroring `stance.rs` / `bite_variant.rs`.
//!
//! Why held-plan ablation defeats the delta-of-zero collapse
//!
//! A single-tick counterfactual ("would flipping the toggle THIS tick
//! help?") collapses to zero for a no-cooldown toggle: pi-zero flips it
//! straight back the next tick, so the marginal difference vanishes.
//! Each plan here instead forces the toggle to one value at EVERY
//! consultation across the bounded window (`hold_on` / `hold_off`),
//! so the counterfactual persists and the engine can price the full
//! held effect (Hunker's x0.5 outgoing vs blocked incoming; Warden's
//! damage climb vs disabled regen).
//!
//! Warden's Rage harvest
//!
//! Warden's third plan, [`ToggleCommit::Harvest`], holds ON but
//! releases in the pre-regen-tick window so the engine's buffered
//! regen tick FLUSHES (both the damage buff and the anti-regen debuff
//! drop; the passive re-arms next bite). The old analytic delta was
//! blind to this harvest - it only compared instantaneous damage-gain
//! vs regen-loss. `value = max(hold, harvest) - off`.

use crate::policy::traits::{
    toggle_commit_answer, ToggleCommit, ToggleReplayDecision, ToggleReplaySideView,
    ToggleReplayer,
};

/// Stable ids under which the replay decisions register.
pub const HUNKER_REPLAY_DECISION_ID: &str = "builtin.hunker.replay";
pub const WARDEN_RAGE_REPLAY_DECISION_ID: &str = "builtin.wardens_rage.replay";

/// Resolve a toggle-decision id string back to its canonical `&'static str`.
///
/// A captured defensive schedule round-trips through a `String`-keyed DTO across
/// the JS bridge; re-installing it on the `&'static str`-keyed
/// `PinnedDefensiveSchedule` needs the interned id back. Returns `None` for an
/// id no registered toggle owns.
pub fn canonical_toggle_id(id: &str) -> Option<&'static str> {
    if id == HUNKER_REPLAY_DECISION_ID {
        Some(HUNKER_REPLAY_DECISION_ID)
    } else if id == WARDEN_RAGE_REPLAY_DECISION_ID {
        Some(WARDEN_RAGE_REPLAY_DECISION_ID)
    } else {
        None
    }
}

/// Anti-jitter margin: a held plan must beat the OFF baseline by this
/// much fitness to be committed for the epoch. Mirrors the stance
/// decision's `POLICY_FITNESS_MARGIN` - guards against numeric noise
/// flipping the toggle across consecutive epochs.
pub const POLICY_FITNESS_MARGIN: f64 = 1.0;

/// Engine-replay toggle decision. Parameterised by its non-OFF
/// candidate plans: Hunker scores `[On]`, Warden's Rage scores
/// `[On, Harvest]`. Both share the "beat the OFF baseline by margin"
/// commit rule.
pub struct BuiltinToggleReplayDecision {
    id: &'static str,
    held_candidates: &'static [ToggleCommit],
}

impl BuiltinToggleReplayDecision {
    /// Hunker: hold-on vs hold-off (no harvest - Hunker has no
    /// buffered-regen interaction).
    pub fn hunker() -> Self {
        Self {
            id: HUNKER_REPLAY_DECISION_ID,
            held_candidates: &[ToggleCommit::On],
        }
    }

    /// Warden's Rage: hold vs harvest vs off-always.
    pub fn wardens_rage() -> Self {
        Self {
            id: WARDEN_RAGE_REPLAY_DECISION_ID,
            held_candidates: &[ToggleCommit::On, ToggleCommit::Harvest],
        }
    }
}

impl ToggleReplayDecision for BuiltinToggleReplayDecision {
    fn id(&self) -> &str {
        self.id
    }

    fn decide(
        &self,
        _actor_view: &dyn ToggleReplaySideView,
        _decision_time: f64,
        replayer: &mut dyn ToggleReplayer,
    ) -> ToggleCommit {
        // OFF baseline: the toggle held off across the window (the
        // passive Warden controller still arms on damage inside the
        // real replay - only the MANUAL intent is driven here).
        let off_fitness =
            replayer.replay_with_plan(&|v, t| toggle_commit_answer(ToggleCommit::Off, v, t));

        let mut best: Option<(ToggleCommit, f64)> = None;
        for &cand in self.held_candidates {
            let fitness =
                replayer.replay_with_plan(&|v, t| toggle_commit_answer(cand, v, t));
            match best {
                None => best = Some((cand, fitness)),
                Some((_, bf)) if fitness > bf => best = Some((cand, fitness)),
                _ => {}
            }
        }

        match best {
            Some((cand, fitness)) if fitness > off_fitness + POLICY_FITNESS_MARGIN => cand,
            _ => ToggleCommit::Off,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct View;
    impl ToggleReplaySideView for View {
        fn next_regen_at(&self) -> f64 {
            f64::INFINITY
        }
    }

    /// Replayer that returns a scripted fitness per call in order
    /// (`decide` probes OFF first, then each held candidate).
    struct SeqReplayer {
        seq: Vec<f64>,
        idx: RefCell<usize>,
    }
    impl ToggleReplayer for SeqReplayer {
        fn replay_with_plan(
            &mut self,
            _plan: &dyn Fn(&dyn ToggleReplaySideView, f64) -> bool,
        ) -> f64 {
            let mut i = self.idx.borrow_mut();
            let v = self.seq.get(*i).copied().unwrap_or(0.0);
            *i += 1;
            v
        }
    }

    #[test]
    fn ids_are_namespaced() {
        assert_eq!(BuiltinToggleReplayDecision::hunker().id(), "builtin.hunker.replay");
        assert_eq!(
            BuiltinToggleReplayDecision::wardens_rage().id(),
            "builtin.wardens_rage.replay"
        );
    }

    #[test]
    fn commits_off_when_no_plan_beats_baseline() {
        // OFF=100, ON=100 -> ON does not clear OFF + margin -> Off.
        let d = BuiltinToggleReplayDecision::hunker();
        let mut r = SeqReplayer { seq: vec![100.0, 100.0], idx: 0.into() };
        assert_eq!(d.decide(&View, 0.0, &mut r), ToggleCommit::Off);
    }

    #[test]
    fn commits_on_when_hold_beats_baseline_by_margin() {
        // OFF=100, ON=500 -> On.
        let d = BuiltinToggleReplayDecision::hunker();
        let mut r = SeqReplayer { seq: vec![100.0, 500.0], idx: 0.into() };
        assert_eq!(d.decide(&View, 0.0, &mut r), ToggleCommit::On);
    }

    #[test]
    fn wardens_rage_commits_harvest_when_it_beats_hold_and_off() {
        // OFF=100, ON(hold)=200, HARVEST=500 -> Harvest (max, beats OFF).
        let d = BuiltinToggleReplayDecision::wardens_rage();
        let mut r = SeqReplayer { seq: vec![100.0, 200.0, 500.0], idx: 0.into() };
        assert_eq!(d.decide(&View, 0.0, &mut r), ToggleCommit::Harvest);
    }
}
