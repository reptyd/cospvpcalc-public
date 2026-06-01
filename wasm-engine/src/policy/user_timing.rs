//! User-defined timing policy spec — engine-level building blocks.
//!
//! A "custom timing" is a user-registered alternative to the five
//! built-in [`TimingMode`](crate::policy::timing_mode::TimingMode)
//! policies. It lives in `PolicyRegistry` alongside the built-ins
//! and can be selected for any decision (built-in or user-defined)
//! through the existing `abilityPolicyOverrides` mechanism — once
//! registered it's a 6th+ available mode.
//!
//! Like [`UserAbilitySpec`](super::user_ability::UserAbilitySpec),
//! the spec is data: a candidate-delay vector + horizon + threshold
//! + an optional gate expression. Reusing the [`Expr`] DSL means
//!   one parser/evaluator covers both halves of the custom-ability
//!   feature.
//!
//! ## Why separate from `UserAbilitySpec`?
//!
//! Decisions and policies are orthogonal: a policy says **when**
//! to evaluate utility (which candidate delays to try, which
//! horizon to bound it by); a decision says **what** the utility
//! is. The five built-in modes prove this — `Fast`, `SemiIdeal`,
//! `Ideal`, `Extreme` are all instances of `CandidateSearchPolicy`
//! with different candidate vectors; only the candidate set
//! changes between them. `UserPolicy` is the user-data
//! counterpart: same shape, different candidates / horizon /
//! threshold / gate.
//!
//! ## Spec semantics
//!
//! - `candidates: Vec<f64>` — list of delay values (seconds) the
//!   policy projects state to before evaluating utility. Must
//!   contain at least one entry. `0.0` means "right now" (no
//!   projection); larger values are evaluated after light forward-
//!   projection through `StateProjection::project`.
//! - `horizon_sec` — informational cap surfaced to the engine
//!   (decisions can read `state.time + horizon_sec` to bound
//!   their utility integrals). Built-ins use `15s` for Fast,
//!   `45s` for Ideal, `120s` for Extreme.
//! - `threshold` — utility floor below which the policy emits
//!   `Skip` rather than `Now` / `Wait`. Built-ins use `1e-6`
//!   (numerical epsilon). Setting a higher threshold makes the
//!   policy more conservative.
//! - `force_skip` (optional) — Expr evaluated against the current
//!   state. Non-zero ⇒ policy returns `Skip` regardless of utility.
//!   Mirrors the way `ReallyFast` consults `really_fast_gate` for
//!   gate-only behavior.
//! - `force_fire` (optional) — Expr evaluated against the current
//!   state. Non-zero ⇒ policy returns `Now` regardless of utility.
//!   Use this for "always fire when this condition holds" semantics.
//!
//! `force_skip` is checked before `force_fire`; if both fire the
//! skip wins (safer default).

use serde::{Deserialize, Serialize};

use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::traits::{Policy, StateProjection, TimedChoice, TimedDecision, POLICY_SEARCH_DELAY_KEY};
use crate::policy::user_ability::Expr;

/// Numerical epsilon below which the policy treats utility as
/// effectively zero. Mirrors the `SCORE_EPS` constant the built-in
/// search policies use.
const DEFAULT_THRESHOLD: f64 = 1e-6;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserTimingSpec {
    /// Stable id under which the policy registers. Must start with
    /// `user.` for the same id-namespace reasons as
    /// [`crate::policy::user_ability::UserAbilitySpec`].
    pub id: String,
    /// Display name (UI / combat-log surfacing).
    pub display_name: String,
    /// Candidate delays (seconds) the policy enumerates. Order is
    /// not important — the policy iterates over the whole list and
    /// picks the candidate with the highest utility. Must contain
    /// at least one entry.
    pub candidates: Vec<f64>,
    /// Time horizon (seconds) the decision can use to bound its
    /// utility integral. The policy doesn't enforce this at search
    /// time (no candidate is dropped because it overshoots horizon),
    /// but it is exposed so decisions reading `state.extra.<key>`
    /// can self-bound. Must be non-negative.
    pub horizon_sec: f64,
    /// Utility floor for the chosen candidate. The policy emits
    /// `Skip` when the best candidate's utility is below this
    /// threshold. Built-ins use `1e-6`; setting higher values makes
    /// the policy more conservative.
    #[serde(default = "default_threshold")]
    pub threshold: f64,
    /// Optional "skip if non-zero" expression. Evaluated against
    /// the *current* state (no projection). When non-zero the
    /// policy emits `Skip` immediately, before candidate search.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force_skip: Option<Expr>,
    /// Optional "fire now if non-zero" expression. Evaluated
    /// against the current state. When non-zero (and `force_skip`
    /// is zero / absent) the policy emits `Now` immediately.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force_fire: Option<Expr>,
}

fn default_threshold() -> f64 {
    DEFAULT_THRESHOLD
}

/// Adapter: turns a [`UserTimingSpec`] into a concrete
/// [`Policy`] the existing `PolicyRegistry` accepts. Stateless
/// beyond the spec it wraps; cheap to clone.
#[derive(Debug, Clone)]
pub struct UserPolicy {
    spec: UserTimingSpec,
}

impl UserPolicy {
    pub fn new(spec: UserTimingSpec) -> Self {
        Self { spec }
    }

    pub fn spec(&self) -> &UserTimingSpec {
        &self.spec
    }
}

impl Policy for UserPolicy {
    fn id(&self) -> &str {
        &self.spec.id
    }

    fn decide(
        &self,
        decision: &dyn TimedDecision,
        state: &PolicyState,
        projector: &dyn StateProjection,
    ) -> TimedChoice {
        // Hard gates first — same shape as ReallyFast's
        // really_fast_gate handling but expressed as data.
        if let Some(expr) = &self.spec.force_skip {
            if expr.eval_bool(state) {
                return TimedChoice::Skip;
            }
        }
        if let Some(expr) = &self.spec.force_fire {
            if expr.eval_bool(state) && decision.is_available(state) {
                return TimedChoice::Now;
            }
        }

        if !decision.is_available(state) {
            return TimedChoice::Skip;
        }

        // Candidate search. Identical strategy to
        // `CandidateSearchPolicy`: project to each delay, evaluate
        // utility, pick the winner.
        let threshold = self.spec.threshold;
        let mut best: Option<(f64, f64)> = None;
        for &delay in &self.spec.candidates {
            let mut projected = if delay <= threshold {
                state.clone()
            } else {
                projector.project(state, delay)
            };
            // Mirror CandidateSearchPolicy: expose the candidate delay
            // so decisions (e.g. FortifyDecision) can compensate for
            // projection blind-spots that scale with delay.
            // Decisions that don't read POLICY_SEARCH_DELAY_KEY see
            // the same behaviour as before this insertion.
            projected
                .extras
                .insert(POLICY_SEARCH_DELAY_KEY.to_string(), PolicyValue::Number(delay));
            if !decision.is_available(&projected) {
                continue;
            }
            let u = decision.utility(&projected);
            match best {
                None => best = Some((delay, u)),
                Some((_, best_u)) if u > best_u + threshold => {
                    best = Some((delay, u));
                }
                _ => {}
            }
        }

        match best {
            Some((delay, u)) if u > threshold => {
                if delay <= threshold {
                    TimedChoice::Now
                } else {
                    TimedChoice::Wait { delay_sec: delay }
                }
            }
            _ => TimedChoice::Skip,
        }
    }
}

/// Registration-time validation. Distinct from runtime evaluation
/// behaviour — at runtime, missing candidates simply skip; here we
/// reject the spec early with a clear error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimingSpecError {
    IdEmpty,
    IdNotUserNamespaced { id: String },
    DisplayNameEmpty,
    NoCandidates,
    NegativeCandidate { value_sec: i64 },
    NegativeHorizon,
}

impl std::fmt::Display for TimingSpecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TimingSpecError::IdEmpty => write!(f, "timing id must not be empty"),
            TimingSpecError::IdNotUserNamespaced { id } => write!(
                f,
                "timing id `{id}` must start with `user.` to register as a custom timing"
            ),
            TimingSpecError::DisplayNameEmpty => write!(f, "display_name must not be empty"),
            TimingSpecError::NoCandidates => {
                write!(f, "candidates must contain at least one delay")
            }
            TimingSpecError::NegativeCandidate { value_sec } => write!(
                f,
                "candidate delay must be non-negative; got {value_sec}"
            ),
            TimingSpecError::NegativeHorizon => write!(f, "horizon_sec must be non-negative"),
        }
    }
}

impl std::error::Error for TimingSpecError {}

impl UserTimingSpec {
    pub fn validate(&self) -> Result<(), TimingSpecError> {
        if self.id.is_empty() {
            return Err(TimingSpecError::IdEmpty);
        }
        if !self.id.starts_with("user.") {
            return Err(TimingSpecError::IdNotUserNamespaced {
                id: self.id.clone(),
            });
        }
        if self.display_name.trim().is_empty() {
            return Err(TimingSpecError::DisplayNameEmpty);
        }
        if self.candidates.is_empty() {
            return Err(TimingSpecError::NoCandidates);
        }
        for &c in &self.candidates {
            if c < 0.0 || !c.is_finite() {
                return Err(TimingSpecError::NegativeCandidate {
                    value_sec: c.round() as i64,
                });
            }
        }
        if self.horizon_sec < 0.0 || !self.horizon_sec.is_finite() {
            return Err(TimingSpecError::NegativeHorizon);
        }
        Ok(())
    }
}

#[derive(Debug)]
pub enum ParseError {
    Json(serde_json::Error),
    Validation(TimingSpecError),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::Json(e) => write!(f, "invalid JSON: {e}"),
            ParseError::Validation(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ParseError {}

/// Parse + validate. The bridge layer (`wasm_api.rs`) calls this
/// to convert a JSON spec from JS into a registry-ready
/// `UserTimingSpec`.
pub fn parse_user_timing_spec(json: &str) -> Result<UserTimingSpec, ParseError> {
    let spec: UserTimingSpec = serde_json::from_str(json).map_err(ParseError::Json)?;
    spec.validate().map_err(ParseError::Validation)?;
    Ok(spec)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::decisions::FortifyDecision;
    use crate::policy::light_projection::CombatStateProjection;
    use crate::policy::registry::{DecisionRegistry, PolicyRegistry};
    use crate::policy::testing::default_state;
    use crate::policy::user_ability::{BinOp, UnaryOp, UserDecision};

    fn const_(value: f64) -> Box<Expr> {
        Box::new(Expr::Const { value })
    }
    fn var(path: &str) -> Box<Expr> {
        Box::new(Expr::Var {
            path: path.into(),
        })
    }

    fn sample_spec() -> UserTimingSpec {
        UserTimingSpec {
            id: "user.aggressive_search".into(),
            display_name: "Aggressive Search".into(),
            candidates: vec![0.0, 1.0, 3.0, 6.0],
            horizon_sec: 24.0,
            threshold: DEFAULT_THRESHOLD,
            force_skip: None,
            force_fire: None,
        }
    }

    #[test]
    fn validate_rejects_bad_inputs() {
        let mut spec = sample_spec();
        spec.id = "".into();
        assert!(matches!(spec.validate(), Err(TimingSpecError::IdEmpty)));

        spec.id = "builtin.cheating".into();
        assert!(matches!(
            spec.validate(),
            Err(TimingSpecError::IdNotUserNamespaced { .. })
        ));

        spec.id = "user.test".into();
        spec.display_name = "  ".into();
        assert!(matches!(
            spec.validate(),
            Err(TimingSpecError::DisplayNameEmpty)
        ));

        spec.display_name = "Test".into();
        spec.candidates.clear();
        assert!(matches!(
            spec.validate(),
            Err(TimingSpecError::NoCandidates)
        ));

        spec.candidates = vec![-1.0];
        assert!(matches!(
            spec.validate(),
            Err(TimingSpecError::NegativeCandidate { .. })
        ));

        spec.candidates = vec![0.0];
        spec.horizon_sec = -10.0;
        assert!(matches!(
            spec.validate(),
            Err(TimingSpecError::NegativeHorizon)
        ));
    }

    #[test]
    fn parse_round_trips() {
        let spec = sample_spec();
        let json = serde_json::to_string(&spec).expect("ser");
        let parsed = parse_user_timing_spec(&json).expect("parse");
        assert_eq!(parsed, spec);
    }

    /// UserPolicy registered alongside built-ins must dispatch a
    /// real Fortify decision the same way `Fast` / `Ideal` do.
    /// This is the proof the new code path doesn't special-case
    /// user vs built-in policy.
    #[test]
    fn user_policy_dispatches_fortify_through_registry() {
        use crate::contracts::SimpleStatusInstance;

        let spec = sample_spec();
        let mut decisions = DecisionRegistry::new();
        decisions.register(Box::new(FortifyDecision::new()));

        let mut policies = PolicyRegistry::with_builtins();
        policies.register(Box::new(UserPolicy::new(spec)));

        let projector = CombatStateProjection;

        let mut state = default_state();
        // Give Fortify something to cleanse so utility > 0.
        state.self_side.statuses.insert(
            "Bleed_Status".to_string(),
            SimpleStatusInstance {
                stacks: 8.0,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 24.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );

        let decision = decisions.get("builtin.fortify").expect("fortify present");
        let user_policy = policies
            .get("user.aggressive_search")
            .expect("user policy registered");

        match user_policy.decide(decision, &state, &projector) {
            TimedChoice::Now | TimedChoice::Wait { .. } => {} // either is fine
            TimedChoice::Skip => panic!("user policy should not skip when Fortify has 8 Bleed stacks"),
        }
    }

    /// User policy + user decision = end-to-end "user authored both
    /// halves" path. Round-trips a JSON pair through the registries
    /// and asserts the engine fires correctly.
    #[test]
    fn user_policy_dispatches_user_decision() {
        use crate::contracts::SimpleAppliedStatus;
        use crate::effects::{EffectBatch, EffectKind, EffectTarget};
        use crate::policy::user_ability::UserAbilitySpec;

        let ability_spec = UserAbilitySpec {
            version: 1,
            id: "user.pyro_strike".into(),
            display_name: "Pyro Strike".into(),
            utility: Expr::Bin {
                op: BinOp::Mul,
                left: var("self.bite_dps"),
                right: const_(8.0),
            },
            is_available: Expr::Const { value: 1.0 },
            really_fast_gate: None,
            timing_mode_override: None,
            timing_user_override: None,
            on_fire: Some(EffectBatch {
                name: "Pyro Strike".into(),
                effects: vec![EffectKind::ApplyStatusToTarget {
                    target: EffectTarget::Opponent,
                    status: SimpleAppliedStatus {
                        status_id: "Burn_Status".into(),
                        stacks: 2.0,
                        source_ability: None,
                    },
                }],
                ..Default::default()
            }),
            triggers: crate::policy::user_ability::TriggerHooks::default(),
            ..Default::default()
        };
        let timing_spec = sample_spec();

        let mut decisions = DecisionRegistry::new();
        decisions.register(Box::new(UserDecision::new(ability_spec)));

        let mut policies = PolicyRegistry::with_builtins();
        policies.register(Box::new(UserPolicy::new(timing_spec)));

        let state = default_state();
        let decision = decisions.get("user.pyro_strike").expect("ability registered");
        let policy = policies
            .get("user.aggressive_search")
            .expect("timing registered");
        let projector = CombatStateProjection;

        match policy.decide(decision, &state, &projector) {
            TimedChoice::Now => {} // expected — utility positive, delay 0 wins
            TimedChoice::Wait { delay_sec } => {
                assert!(delay_sec > 0.0);
            }
            TimedChoice::Skip => {
                panic!("user-policy + user-ability should not skip on a positive-utility setup")
            }
        }
    }

    #[test]
    fn force_skip_short_circuits_decision() {
        let mut spec = sample_spec();
        // force_skip = 1 (always true) → policy should skip immediately.
        spec.force_skip = Some(Expr::Const { value: 1.0 });

        let mut decisions = DecisionRegistry::new();
        decisions.register(Box::new(FortifyDecision::new()));
        let mut policies = PolicyRegistry::with_builtins();
        policies.register(Box::new(UserPolicy::new(spec)));

        let state = default_state();
        let decision = decisions.get("builtin.fortify").expect("fortify");
        let policy = policies.get("user.aggressive_search").expect("policy");
        let projector = CombatStateProjection;
        assert_eq!(
            policy.decide(decision, &state, &projector),
            TimedChoice::Skip
        );
    }

    #[test]
    fn force_fire_short_circuits_when_decision_available() {
        let mut spec = sample_spec();
        spec.force_fire = Some(Expr::Const { value: 1.0 });

        let mut decisions = DecisionRegistry::new();
        decisions.register(Box::new(FortifyDecision::new()));
        let mut policies = PolicyRegistry::with_builtins();
        policies.register(Box::new(UserPolicy::new(spec)));

        // Fortify is_available = (cooldown elapsed) AND (any removable stacks).
        // We need both — give it bleed stacks so is_available is true.
        let mut state = default_state();
        state.self_side.statuses.insert(
            "Bleed_Status".to_string(),
            crate::contracts::SimpleStatusInstance {
                stacks: 1.0,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 24.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );

        let decision = decisions.get("builtin.fortify").expect("fortify");
        let policy = policies.get("user.aggressive_search").expect("policy");
        let projector = CombatStateProjection;
        assert_eq!(
            policy.decide(decision, &state, &projector),
            TimedChoice::Now
        );
    }

    /// Parity test: `UserPolicy` with the same candidate set as
    /// `builtin.ideal` must produce the **same** `TimedChoice` as
    /// `CandidateSearchPolicy` (accessed via the registry) for
    /// `FortifyDecision` in a state where `POLICY_SEARCH_DELAY_KEY`
    /// actually changes the outcome.
    ///
    /// The state has minimal starting stacks (1 stack) plus high
    /// future opp pressure — Fortify should wait, not fire at t=0.
    /// Before the fix `UserPolicy` would see delay=0 in all projected
    /// states (missing key → 0.0), so utility at delay=0 beat every
    /// delayed candidate and it emitted `Now`. After the fix it agrees
    /// with `Ideal` (also `Wait`).
    #[test]
    fn user_policy_delay_key_parity_with_candidate_search_policy() {
        use crate::contracts::SimpleAppliedStatus;
        use crate::policy::timing_mode::TimingMode;

        // UserPolicy with the same candidates as builtin.ideal.
        let user_spec = UserTimingSpec {
            id: "user.ideal_mirror".into(),
            display_name: "Ideal Mirror".into(),
            candidates: vec![0.0, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0],
            horizon_sec: 45.0,
            threshold: DEFAULT_THRESHOLD,
            force_skip: None,
            force_fire: None,
        };

        let mut decisions = DecisionRegistry::new();
        decisions.register(Box::new(FortifyDecision::new()));

        let mut user_policies = PolicyRegistry::with_builtins();
        user_policies.register(Box::new(UserPolicy::new(user_spec)));

        let builtin_policies = PolicyRegistry::with_builtins();

        let projector = CombatStateProjection;

        // State: 1 Poison stack (makes is_available = true) + opp will
        // apply many more during a wait (every 1.5 s, 1 stack/bite).
        let mut state = default_state();
        state.self_side.statuses.insert(
            "Poison_Status".to_string(),
            crate::contracts::SimpleStatusInstance {
                stacks: 1.0,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 100.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
        state.opponent.stats.bite_cooldown = 1.5;
        state.opponent.stats.on_hit_statuses.push(SimpleAppliedStatus {
            status_id: "Poison_Status".to_string(),
            stacks: 1.0,
            source_ability: None,
        });

        let fortify = decisions.get("builtin.fortify").expect("fortify");

        let builtin_choice = builtin_policies
            .for_mode(TimingMode::Ideal)
            .expect("ideal")
            .decide(fortify, &state, &projector);

        let user_choice = user_policies
            .get("user.ideal_mirror")
            .expect("user policy registered")
            .decide(fortify, &state, &projector);

        // Both must agree: either both Wait (delay > 0) or both Now.
        // The key invariant is that UserPolicy no longer collapses to
        // Now when the delay-key-aware path says Wait.
        match (&builtin_choice, &user_choice) {
            (TimedChoice::Wait { .. }, TimedChoice::Wait { .. }) => {}
            (TimedChoice::Now, TimedChoice::Now) => {}
            (TimedChoice::Skip, TimedChoice::Skip) => {}
            _ => panic!(
                "UserPolicy and CandidateSearchPolicy (Ideal) disagree: \
                 builtin={builtin_choice:?}  user={user_choice:?}\n\
                 This indicates UserPolicy is missing POLICY_SEARCH_DELAY_KEY insertion."
            ),
        }
        // Additionally assert: neither policy fires at t=0 given the
        // opp-pressure setup — that would indicate the delay key is
        // still missing (pre-fix behavior).
        assert_ne!(
            user_choice,
            TimedChoice::Now,
            "UserPolicy must not fire Fortify immediately when opp will \
             apply much more pressure during a short wait (delay key missing → \
             pre-fix regression)"
        );
    }

    #[test]
    fn unary_not_in_force_skip_works() {
        // Sanity-check that the Expr DSL UnaryOp::Not branch is
        // exercised somewhere — keeps coverage of the operator
        // honest.
        let expr = Expr::Una {
            op: UnaryOp::Not,
            operand: const_(0.0),
        };
        let state = default_state();
        assert_eq!(expr.eval(&state), 1.0);
    }
}
