//! Per-bite primary-vs-secondary attack selection.
//!
//! Variants:
//!
//! - **`primary`** — base bite damage (`stats.damage`) AND apply
//!   on-hit offensive ailments (`stats.on_hit_statuses`).
//! - **`secondary`** — secondary attack damage (`stats.damage2`),
//!   NO on-hit statuses.
//!
//! Under the user-facing 3-way chip the engine only consults this
//! decision in `Dynamic` mode; `Primary only` / `Secondary only`
//! short-circuit to the chosen variant without invoking the policy.
//! Dynamic-mode picking happens per-bite via
//! [`BuiltinBiteVariantReplayDecision`] + `composable/bite_variant_bridge.rs`.
//! The bite cadence itself is unchanged — the same `next_hit`
//! schedule applies to both variants and there is no "switch cost".

/// Decision id under the policy registry. Built-in namespace.
pub const BITE_VARIANT_DECISION_ID: &str = "builtin.bite_variant";

/// Variant id: primary bite (base damage + on-hit offensive
/// ailments). Listed first so that on a utility tie
/// [`MaxUtilityVariantPolicy`] picks primary — preserving today's
/// behavior under degenerate inputs.
///
/// [`MaxUtilityVariantPolicy`]: crate::policy::timing_mode
pub const PRIMARY_VARIANT: &str = "primary";

/// Variant id: secondary bite (`stats.damage2`, no on-hit statuses).
pub const SECONDARY_VARIANT: &str = "secondary";

/// Engine-replay bite-variant decision. At each bite event, clones
/// the live engine and scores a set of candidate SCHEDULES to
/// fight-end:
///   - **all-primary** and **all-secondary** (the pure modes),
///   - **`Primary->Secondary@k`** / **`Secondary->Primary@k`** phase
///     switches over a bite-index grid (stack-then-burst and reverse),
///   - the legacy **secondary-now-then-primary** marginal.
///
/// The schedule with the higher `crate::composable::posture_policy::compute_replay_fitness`
/// wins; the implementation returns its *immediate* (idx=0) variant and
/// re-decides at the next bite (rolling commit). Including the pure
/// all-secondary schedule makes the search provably no worse than the
/// better pure mode — fixing the mirror-death-race bias where scoring
/// every choice against an all-primary-only tail simulated an
/// artificially long fight, over-valued one primary bite's DOT, and
/// starved secondary even when all-secondary wins the race outright.
///
/// Replaces the analytic `BiteVariantDecision` for the composable
/// engine path. Architectural rationale (per
/// `docs/policy_engine_pillars.md` pillar 2 — "no two paths for the
/// same decision"): the analytic accumulated 6+ hand-rolled
/// adjustment terms (spite_multiplier, fortify_cleanse_factor,
/// expunge_synergy, status_block, decay, …) that each approximated
/// what the engine would actually do. Engine-replay collapses all
/// of those into "run the engine and read the outcome", so adding a
/// new on-hit ability never requires touching the bite-variant
/// decision.
///
/// Measured fix (`posturePolicyRealCompareBeam.test.ts` —
/// "Bite-variant analytic vs greedy ideal"): for Elarickkeir vs
/// Goreganthus the analytic returns secondaryOnly (-6832) when
/// primaryOnly (-6296) is strictly better; greedy with the same
/// 2-path-per-bite search finds a mixed sequence (98 % primary +
/// 2 secondary bites at the 18–19 s window) at -6294, beating
/// both pure modes. The engine-replay decision converges to the
/// greedy optimum because both use the same primitive.
pub struct BuiltinBiteVariantReplayDecision;

impl BuiltinBiteVariantReplayDecision {
    pub fn new() -> Self {
        Self
    }
}

impl Default for BuiltinBiteVariantReplayDecision {
    fn default() -> Self {
        Self::new()
    }
}

impl crate::policy::traits::BiteVariantReplayDecision for BuiltinBiteVariantReplayDecision {
    fn id(&self) -> &str {
        BITE_VARIANT_DECISION_ID
    }

    fn decide(
        &self,
        actor: &dyn crate::policy::traits::BiteVariantSideView,
        _decision_time: f64,
        replayer: &mut dyn crate::policy::traits::BiteVariantReplayer,
    ) -> crate::policy::traits::BiteVariant {
        use crate::policy::traits::{BiteVariant, BiteVariantSideView};
        // Creature without a wiki-listed secondary — nothing to pick.
        if !actor.has_secondary() {
            return BiteVariant::Primary;
        }
        // Schedule search. Each candidate is a full plan governing THIS
        // bite (idx=0) and every future inner-replay bite; the engine-replay
        // scores it to fight-end. We commit the immediate (idx=0) variant of
        // the best-scoring plan and re-decide at the next bite (rolling
        // commit). The candidate set spans both pure modes AND phase
        // switches, so the search can never do worse than the better pure
        // mode — fixing the mirror-death-race bias where scoring every
        // choice against an ALL-PRIMARY self tail simulated an artificially
        // long fight, over-valued one primary bite's DOT, and starved
        // secondary even when all-secondary wins the race outright.
        //
        // Switch grid is in bite index from now: a `Primary->Secondary@k`
        // plan stacks on-hit DOT for k bites then bursts; the reverse
        // bursts first. K=1 (single switch); ties go to primary.
        const SWITCH_GRID: [u32; 7] = [1, 2, 3, 5, 8, 13, 21];
        type Plan = Box<dyn Fn(u32, &dyn BiteVariantSideView) -> BiteVariant>;
        // (immediate variant at idx=0, plan). all-primary is first so it is
        // the tie-break baseline: a schedule wins only if STRICTLY better.
        let mut candidates: Vec<(BiteVariant, Plan)> = vec![
            (BiteVariant::Primary, Box::new(|_, _| BiteVariant::Primary)),
            (
                BiteVariant::Secondary,
                Box::new(|_, _| BiteVariant::Secondary),
            ),
            (
                BiteVariant::Secondary,
                Box::new(|idx, _| {
                    if idx == 0 {
                        BiteVariant::Secondary
                    } else {
                        BiteVariant::Primary
                    }
                }),
            ),
        ];
        for k in SWITCH_GRID {
            candidates.push((
                BiteVariant::Primary,
                Box::new(move |idx, _| {
                    if idx < k {
                        BiteVariant::Primary
                    } else {
                        BiteVariant::Secondary
                    }
                }),
            ));
        }
        for k in SWITCH_GRID {
            candidates.push((
                BiteVariant::Secondary,
                Box::new(move |idx, _| {
                    if idx < k {
                        BiteVariant::Secondary
                    } else {
                        BiteVariant::Primary
                    }
                }),
            ));
        }

        let mut best_fit = replayer.replay_with_plan(candidates[0].1.as_ref());
        let mut best_immediate = candidates[0].0;
        for (immediate, plan) in &candidates[1..] {
            let fit = replayer.replay_with_plan(plan.as_ref());
            if fit > best_fit + 1e-9 {
                best_fit = fit;
                best_immediate = *immediate;
            }
        }
        best_immediate
    }
}

