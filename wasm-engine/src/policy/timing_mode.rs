//! Timing modes — the five built-in policies plus their candidate
//! schedules.
//!
//! A timing mode is a [`Policy`] impl: it answers "when, if at all,
//! to fire this decision?" by enumerating candidate delays and
//! comparing utility at each projected state.
//!
//! The built-ins:
//!
//! | Mode | Candidates | Horizon | Strategy |
//! |------|-----------|---------|----------|
//! | ReallyFast | gate-only | 0 | Honor `decision.really_fast_gate`; otherwise skip. |
//! | Fast | {0, 1, 3} | 15 s | Pick best of 3 candidates if it beats skipping. |
//! | SemiIdeal | {0, 0.5, 1, 2, 4, 8} | 24 s | 6 candidates. |
//! | Ideal | {0, 0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12} | 45 s | 11 candidates. |
//! | Extreme | dense grid 0–12 s @ 0.1, 12–30 @ 0.5, 30–120 @ 2 | 120 s | ~150 candidates. |
//!
//! Pillar 3 (plugin-friendly): users register additional modes by
//! implementing `Policy` and adding it to `PolicyRegistry`. The
//! engine treats them identically.

use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::traits::{
    Policy, StateProjection, TimedChoice, TimedDecision, ToggleDecision, TogglePolicy,
    VariantDecision, VariantPolicy, POLICY_SEARCH_DELAY_KEY,
};

const SCORE_EPS: f64 = 1e-6;

/// Identifies one of the five built-in timing modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TimingMode {
    ReallyFast,
    Fast,
    SemiIdeal,
    Ideal,
    Extreme,
}

impl TimingMode {
    /// Stable id matching the policy registry namespace.
    pub fn policy_id(self) -> &'static str {
        match self {
            TimingMode::ReallyFast => "builtin.really_fast",
            TimingMode::Fast => "builtin.fast",
            TimingMode::SemiIdeal => "builtin.semi_ideal",
            TimingMode::Ideal => "builtin.ideal",
            TimingMode::Extreme => "builtin.extreme",
        }
    }

    /// Stable id of the toggle policy for this mode.
    pub fn toggle_policy_id(self) -> &'static str {
        match self {
            TimingMode::ReallyFast => "builtin.really_fast.toggle",
            TimingMode::Fast => "builtin.fast.toggle",
            TimingMode::SemiIdeal => "builtin.semi_ideal.toggle",
            TimingMode::Ideal => "builtin.ideal.toggle",
            TimingMode::Extreme => "builtin.extreme.toggle",
        }
    }

    /// Stable id of the variant policy for this mode.
    pub fn variant_policy_id(self) -> &'static str {
        match self {
            TimingMode::ReallyFast => "builtin.really_fast.variant",
            TimingMode::Fast => "builtin.fast.variant",
            TimingMode::SemiIdeal => "builtin.semi_ideal.variant",
            TimingMode::Ideal => "builtin.ideal.variant",
            TimingMode::Extreme => "builtin.extreme.variant",
        }
    }

    /// Boxed default policy impl for this mode. The engine ships
    /// these in `PolicyRegistry::with_builtins`; a user may replace
    /// any of them with their own impl by registering under the
    /// same id.
    pub fn default_policy(self) -> Box<dyn Policy> {
        match self {
            TimingMode::ReallyFast => Box::new(ReallyFastPolicy),
            TimingMode::Fast => Box::new(CandidateSearchPolicy::new(
                "builtin.fast",
                fast_candidates(),
            )),
            TimingMode::SemiIdeal => Box::new(CandidateSearchPolicy::new(
                "builtin.semi_ideal",
                semi_ideal_candidates(),
            )),
            TimingMode::Ideal => Box::new(CandidateSearchPolicy::new(
                "builtin.ideal",
                ideal_candidates(),
            )),
            TimingMode::Extreme => Box::new(CandidateSearchPolicy::new(
                "builtin.extreme",
                extreme_candidates(),
            )),
        }
    }

    /// Boxed default toggle-policy impl for this mode.
    ///
    /// ReallyFast and Fast both default to "always on if eligible"
    /// — Reference text for Hunker (the canonical toggle ability)
    /// explicitly mandates this. Precision modes use the
    /// delta-driven policy.
    pub fn default_toggle_policy(self) -> Box<dyn TogglePolicy> {
        match self {
            TimingMode::ReallyFast | TimingMode::Fast => Box::new(
                AlwaysOnIfEligibleTogglePolicy::new(self.toggle_policy_id()),
            ),
            TimingMode::SemiIdeal | TimingMode::Ideal | TimingMode::Extreme => {
                Box::new(DeltaTogglePolicy::new(self.toggle_policy_id()))
            }
        }
    }

    /// Boxed default variant-policy impl for this mode.
    ///
    /// All five built-in modes ship the same policy shape:
    /// `MaxUtilityVariantPolicy` — pick the variant with highest
    /// `decision.utility(state, variant)`. The horizon and
    /// look-ahead complexity live **inside the decision**'s utility
    /// formula, not in the policy — same one-code-path discipline
    /// the timed/toggle decisions follow. A future mode that wants
    /// e.g. multi-horizon averaging registers its own
    /// [`VariantPolicy`] under the same id; built-ins are
    /// drop-in replaceable.
    pub fn default_variant_policy(self) -> Box<dyn VariantPolicy> {
        Box::new(MaxUtilityVariantPolicy::new(self.variant_policy_id()))
    }
}

fn fast_candidates() -> Vec<f64> {
    vec![0.0, 1.0, 3.0]
}

fn semi_ideal_candidates() -> Vec<f64> {
    vec![0.0, 0.5, 1.0, 2.0, 4.0, 8.0]
}

fn ideal_candidates() -> Vec<f64> {
    vec![0.0, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0]
}

fn extreme_candidates() -> Vec<f64> {
    let mut out = Vec::with_capacity(160);
    let mut t: f64 = 0.0;
    while t <= 12.0 + 1e-9 {
        out.push((t * 1e6).round() / 1e6);
        t += 0.1;
    }
    let mut t = 12.5;
    while t <= 30.0 + 1e-9 {
        out.push(t);
        t += 0.5;
    }
    let mut t = 32.0;
    while t <= 120.0 + 1e-9 {
        out.push(t);
        t += 2.0;
    }
    out
}

/// Built-in `ReallyFast` policy: gate-only, no projection.
///
/// - If `decision.really_fast_gate(state)` returns `Some(true)`
///   → `Now`.
/// - If it returns `Some(false)` → `Skip`.
/// - If it returns `None` (decision opted into utility-based
///   evaluation) — falls back to checking utility at the current
///   state and firing only if positive. This case is rare: the
///   trait's default is `Some(false)`.
struct ReallyFastPolicy;

impl Policy for ReallyFastPolicy {
    fn id(&self) -> &str {
        "builtin.really_fast"
    }

    fn decide(
        &self,
        decision: &dyn TimedDecision,
        state: &PolicyState,
        _projector: &dyn StateProjection,
    ) -> TimedChoice {
        if !decision.is_available(state) {
            return TimedChoice::Skip;
        }
        match decision.really_fast_gate(state) {
            Some(true) => TimedChoice::Now,
            Some(false) => TimedChoice::Skip,
            None => {
                if decision.utility(state) > SCORE_EPS {
                    TimedChoice::Now
                } else {
                    TimedChoice::Skip
                }
            }
        }
    }
}

/// Generic "enumerate candidates, pick best, fire now or wait" policy.
/// The four search-style built-ins (`Fast`, `SemiIdeal`, `Ideal`,
/// `Extreme`) are instances of this with different candidate vectors.
///
/// Strategy:
/// 1. For each candidate `delay`, project state forward and evaluate
///    `decision.utility(projected)`.
/// 2. Skip candidates where `is_available(projected)` is false.
/// 3. Pick the candidate with the highest utility.
/// 4. If best utility > 0 and the best candidate is `delay = 0`,
///    fire `Now`. Otherwise emit `Wait { best_delay }`.
/// 5. If no candidate produces positive utility — `Skip`.
struct CandidateSearchPolicy {
    id: &'static str,
    candidates: Vec<f64>,
}

impl CandidateSearchPolicy {
    fn new(id: &'static str, candidates: Vec<f64>) -> Self {
        Self { id, candidates }
    }
}

impl Policy for CandidateSearchPolicy {
    fn id(&self) -> &str {
        self.id
    }

    fn decide(
        &self,
        decision: &dyn TimedDecision,
        state: &PolicyState,
        projector: &dyn StateProjection,
    ) -> TimedChoice {
        if !decision.is_available(state) {
            return TimedChoice::Skip;
        }

        let mut best: Option<(f64, f64)> = None;
        for &delay in &self.candidates {
            let mut projected = if delay <= SCORE_EPS {
                state.clone()
            } else {
                projector.project(state, delay)
            };
            // Expose the candidate delay to the decision so it can
            // compensate for projection blind-spots that scale with
            // delay (e.g. Fortify accounting for opp's continued
            // status applies during the wait — light projection only
            // decays existing statuses, it doesn't add new ones).
            // Decisions that don't read [`POLICY_SEARCH_DELAY_KEY`]
            // see the same behavior as before this change.
            projected
                .extras
                .insert(POLICY_SEARCH_DELAY_KEY.to_string(), PolicyValue::Number(delay));
            if !decision.is_available(&projected) {
                continue;
            }
            let u = decision.utility(&projected);
            match best {
                None => best = Some((delay, u)),
                Some((_, best_u)) if u > best_u + SCORE_EPS => {
                    best = Some((delay, u));
                }
                _ => {}
            }
        }

        match best {
            Some((delay, u)) if u > SCORE_EPS => {
                if delay <= SCORE_EPS {
                    TimedChoice::Now
                } else {
                    TimedChoice::Wait { delay_sec: delay }
                }
            }
            _ => TimedChoice::Skip,
        }
    }
}

/// Built-in toggle policy used by both `ReallyFast` and `Fast`.
/// Reads the decision's `really_fast_default` (typically "always
/// on" for the toggles in scope — Hunker auto-on, etc.) when
/// eligible; OFF when not. The decision's declared default is the
/// single source of truth — both modes consult the same hook so a
/// future toggle that wants different ReallyFast vs Fast behavior
/// can be expressed via a custom `Policy` registered under the
/// matching id.
struct AlwaysOnIfEligibleTogglePolicy {
    id: &'static str,
}

impl AlwaysOnIfEligibleTogglePolicy {
    fn new(id: &'static str) -> Self {
        Self { id }
    }
}

impl TogglePolicy for AlwaysOnIfEligibleTogglePolicy {
    fn id(&self) -> &str {
        self.id
    }

    fn decide(
        &self,
        decision: &dyn ToggleDecision,
        state: &PolicyState,
        _projector: &dyn StateProjection,
    ) -> bool {
        if !decision.is_eligible(state) {
            return false;
        }
        decision.really_fast_default(state).unwrap_or(false)
    }
}

/// Built-in toggle policy for the search-style modes (Fast,
/// SemiIdeal, Ideal, Extreme). Reads the decision's net on/off
/// delta at the current state and flips the toggle accordingly.
///
/// Future enhancement: precision modes can project state forward
/// at multiple horizons and average the delta — for now the
/// instantaneous reading is sufficient for the toggles in scope
/// (Hunker, Warden's Rage hold). Same plugin path: a user can
/// replace this policy at the matching id with a deeper-search
/// implementation.
struct DeltaTogglePolicy {
    id: &'static str,
}

impl DeltaTogglePolicy {
    fn new(id: &'static str) -> Self {
        Self { id }
    }
}

impl TogglePolicy for DeltaTogglePolicy {
    fn id(&self) -> &str {
        self.id
    }

    fn decide(
        &self,
        decision: &dyn ToggleDecision,
        state: &PolicyState,
        _projector: &dyn StateProjection,
    ) -> bool {
        if !decision.is_eligible(state) {
            return false;
        }
        decision.on_off_delta(state) > SCORE_EPS
    }
}

/// Built-in variant policy used by all five timing modes — picks
/// the variant with the highest `decision.utility(state, variant)`.
///
/// The variant decision encapsulates **both** the analytic formula
/// AND the look-ahead horizon (the same one-code-path discipline
/// timed/toggle decisions follow — see pillar 6 of
/// `docs/policy_engine_pillars.md`). The policy itself is dumb on
/// purpose: it iterates `decision.variants()`, calls `utility` on
/// each, and returns the argmax.
///
/// Ties are broken in **iteration order** of `decision.variants()`
/// — i.e. the *first* variant listed wins on a tie. Decisions
/// should order their variants so the conservative / no-regression
/// default sits first (e.g. `["primary", "secondary"]` for bites,
/// matching the "Primary only" chip default that mirrors today's
/// behavior).
///
/// If `decision.variants()` is empty (mis-registration), returns
/// an empty string — engine code that looks up the picked variant
/// will then fall through to `decision.default_variant()`.
struct MaxUtilityVariantPolicy {
    id: &'static str,
}

impl MaxUtilityVariantPolicy {
    fn new(id: &'static str) -> Self {
        Self { id }
    }
}

impl VariantPolicy for MaxUtilityVariantPolicy {
    fn id(&self) -> &str {
        self.id
    }

    fn decide<'a>(
        &self,
        decision: &'a dyn VariantDecision,
        state: &PolicyState,
        _projector: &dyn StateProjection,
    ) -> &'a str {
        let variants = decision.variants();
        let mut best: Option<(&str, f64)> = None;
        for &variant in variants {
            let u = decision.utility(state, variant);
            match best {
                None => best = Some((variant, u)),
                Some((_, best_u)) if u > best_u + SCORE_EPS => {
                    best = Some((variant, u));
                }
                _ => {}
            }
        }
        match best {
            Some((variant, _)) => variant,
            None => decision.default_variant(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::light_projection::CombatStateProjection;

    /// Fixture variant decision used by the policy tests below.
    /// Returns utility = `variant_index + 1.0`, so the LAST variant
    /// always wins under MaxUtility regardless of input state.
    struct OrderingVariantDecision;
    impl VariantDecision for OrderingVariantDecision {
        fn id(&self) -> &str {
            "test.ordering_variant"
        }
        fn variants(&self) -> &[&str] {
            &["first", "second", "third"]
        }
        fn utility(&self, _: &PolicyState, variant: &str) -> f64 {
            match variant {
                "first" => 1.0,
                "second" => 2.0,
                "third" => 3.0,
                _ => f64::NEG_INFINITY,
            }
        }
        fn is_available(&self, _: &PolicyState) -> bool {
            true
        }
    }

    /// Variant decision where two variants tie. Asserts the
    /// iteration-order tie-break rule documented on
    /// [`MaxUtilityVariantPolicy`].
    struct TiedVariantDecision;
    impl VariantDecision for TiedVariantDecision {
        fn id(&self) -> &str {
            "test.tied_variant"
        }
        fn variants(&self) -> &[&str] {
            // Order matters: tie-break must pick the first listed.
            &["primary", "secondary"]
        }
        fn utility(&self, _: &PolicyState, _variant: &str) -> f64 {
            42.0
        }
        fn is_available(&self, _: &PolicyState) -> bool {
            true
        }
    }

    #[test]
    fn max_utility_variant_policy_picks_highest_utility() {
        let policy = MaxUtilityVariantPolicy::new("test.max");
        let state = crate::policy::testing::default_state();
        let projector = CombatStateProjection;
        let picked = policy.decide(&OrderingVariantDecision, &state, &projector);
        assert_eq!(picked, "third");
    }

    #[test]
    fn max_utility_variant_policy_breaks_ties_by_iteration_order() {
        let policy = MaxUtilityVariantPolicy::new("test.max");
        let state = crate::policy::testing::default_state();
        let projector = CombatStateProjection;
        let picked = policy.decide(&TiedVariantDecision, &state, &projector);
        assert_eq!(
            picked, "primary",
            "tie-break must pick the first-listed variant"
        );
    }

    #[test]
    fn extreme_candidates_have_dense_low_band_and_sparse_long_tail() {
        let cs = extreme_candidates();
        // Low band: 0..=12 at 0.1 step → 121 points.
        let low = cs.iter().filter(|&&t| t <= 12.0 + 1e-9).count();
        assert_eq!(low, 121, "expected 121 points in [0, 12]: got {low}");
        // 12.5..=30 at 0.5 step → 36 points.
        let mid = cs
            .iter()
            .filter(|&&t| t > 12.0 && t <= 30.0 + 1e-9)
            .count();
        assert_eq!(mid, 36, "expected 36 points in (12, 30]: got {mid}");
        // 32..=120 at 2 step → 45 points.
        let hi = cs.iter().filter(|&&t| t > 30.0).count();
        assert_eq!(hi, 45, "expected 45 points in (30, 120]: got {hi}");
        // Total monotonically increasing.
        for w in cs.windows(2) {
            assert!(
                w[0] < w[1],
                "candidates must be strictly increasing, got {} >= {}",
                w[0],
                w[1]
            );
        }
    }
}
