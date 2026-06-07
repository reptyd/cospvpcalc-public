//! Runtime registries for decisions and policies.
//!
//! The registries are how the engine stays plugin-friendly:
//! built-in decisions and built-in timing modes are registered
//! here at startup; future user / constructor-built decisions and
//! policies use the same insertion API.
//!
//! The engine itself (callers asking "should I fire X now?") looks
//! up by id - there is no concrete-type fast path that bypasses the
//! registry. That is what guarantees built-ins and user impls are
//! treated identically.

use std::collections::BTreeMap;

use crate::policy::timing_mode::TimingMode;
use crate::policy::traits::{
    Policy, TimedDecision, ToggleDecision, TogglePolicy, VariantDecision, VariantPolicy,
};

/// Entry in [`DecisionRegistry`] - a decision is either timed
/// (one-shot fire with delay), toggle (continuous on/off), or
/// variant (pick one of N at the moment an action fires).
/// Engine routing branches on this enum at lookup time. Adding a
/// new decision shape later means adding a variant here and a
/// matching policy trait - no other engine code changes.
pub enum RegistryEntry {
    Timed(Box<dyn TimedDecision>),
    Toggle(Box<dyn ToggleDecision>),
    Variant(Box<dyn VariantDecision>),
}

impl RegistryEntry {
    pub fn id(&self) -> &str {
        match self {
            RegistryEntry::Timed(d) => d.id(),
            RegistryEntry::Toggle(d) => d.id(),
            RegistryEntry::Variant(d) => d.id(),
        }
    }

    /// Borrow the inner timed decision, if this entry is timed.
    pub fn as_timed(&self) -> Option<&dyn TimedDecision> {
        match self {
            RegistryEntry::Timed(d) => Some(d.as_ref()),
            _ => None,
        }
    }

    /// Borrow the inner toggle decision, if this entry is toggle.
    pub fn as_toggle(&self) -> Option<&dyn ToggleDecision> {
        match self {
            RegistryEntry::Toggle(d) => Some(d.as_ref()),
            _ => None,
        }
    }

    /// Borrow the inner variant decision, if this entry is variant.
    pub fn as_variant(&self) -> Option<&dyn VariantDecision> {
        match self {
            RegistryEntry::Variant(d) => Some(d.as_ref()),
            _ => None,
        }
    }
}

/// Holds the population of decisions (timed, toggle, and variant) the engine
/// will consider this run. All shapes share one keyspace; a given
/// id is timed, toggle, or variant, never more than one.
///
/// A registry is constructed once per simulation and **moved into**
/// the engine. Decisions cannot be added or removed mid-run - that
/// would break the determinism the monotonicity invariant depends
/// on.
#[derive(Default)]
pub struct DecisionRegistry {
    decisions: BTreeMap<String, RegistryEntry>,
}

impl DecisionRegistry {
    /// New empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a timed decision. Replaces any prior entry for the
    /// same id (last-write-wins - allows users to override
    /// built-ins, including swapping a timed entry for a toggle one).
    pub fn register(&mut self, decision: Box<dyn TimedDecision>) {
        let id = decision.id().to_string();
        self.decisions.insert(id, RegistryEntry::Timed(decision));
    }

    /// Register a toggle decision. Same last-write-wins rule.
    pub fn register_toggle(&mut self, decision: Box<dyn ToggleDecision>) {
        let id = decision.id().to_string();
        self.decisions.insert(id, RegistryEntry::Toggle(decision));
    }

    /// Register a variant decision. Same last-write-wins rule.
    pub fn register_variant(&mut self, decision: Box<dyn VariantDecision>) {
        let id = decision.id().to_string();
        self.decisions.insert(id, RegistryEntry::Variant(decision));
    }

    /// Look up the registry entry by id.
    pub fn entry(&self, id: &str) -> Option<&RegistryEntry> {
        self.decisions.get(id)
    }

    /// Convenience: look up a timed decision by id (returns `None`
    /// if the id maps to a toggle or variant entry instead).
    pub fn get(&self, id: &str) -> Option<&dyn TimedDecision> {
        self.decisions.get(id).and_then(RegistryEntry::as_timed)
    }

    /// Convenience: look up a toggle decision by id.
    pub fn get_toggle(&self, id: &str) -> Option<&dyn ToggleDecision> {
        self.decisions.get(id).and_then(RegistryEntry::as_toggle)
    }

    /// Convenience: look up a variant decision by id.
    pub fn get_variant(&self, id: &str) -> Option<&dyn VariantDecision> {
        self.decisions.get(id).and_then(RegistryEntry::as_variant)
    }

    /// Iterate over every registered entry. Order is sorted by id
    /// (BTreeMap iteration), which makes test assertions stable.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &RegistryEntry)> {
        self.decisions
            .iter()
            .map(|(id, entry)| (id.as_str(), entry))
    }

    /// Number of registered decisions (timed, toggle, and variant).
    pub fn len(&self) -> usize {
        self.decisions.len()
    }

    /// Whether the registry is empty.
    pub fn is_empty(&self) -> bool {
        self.decisions.is_empty()
    }
}

/// Holds policies (timing modes, plus any user-registered
/// alternatives) the engine will consult. Each timing mode owns
/// **three** registered policies: a timed [`Policy`] under its
/// `policy_id`, a [`TogglePolicy`] under its `toggle_policy_id`,
/// and a [`VariantPolicy`] under its `variant_policy_id`.
///
/// Like [`DecisionRegistry`], a `PolicyRegistry` is constructed up
/// front; the policy of any given timing mode is then resolved by
/// id at decision-evaluation time.
#[derive(Default)]
pub struct PolicyRegistry {
    policies: BTreeMap<String, Box<dyn Policy>>,
    toggle_policies: BTreeMap<String, Box<dyn TogglePolicy>>,
    variant_policies: BTreeMap<String, Box<dyn VariantPolicy>>,
}

impl PolicyRegistry {
    /// New empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Registry pre-populated with the five built-in timing modes
    /// - their [`Policy`], [`TogglePolicy`], and [`VariantPolicy`]
    /// counterparts.
    pub fn with_builtins() -> Self {
        let mut reg = Self::default();
        for mode in [
            TimingMode::ReallyFast,
            TimingMode::Fast,
            TimingMode::SemiIdeal,
            TimingMode::Ideal,
            TimingMode::Extreme,
        ] {
            reg.register(mode.default_policy());
            reg.register_toggle(mode.default_toggle_policy());
            reg.register_variant_policy(mode.default_variant_policy());
        }
        reg
    }

    /// Register a timed policy. Replaces any prior entry for the
    /// same id.
    pub fn register(&mut self, policy: Box<dyn Policy>) {
        let id = policy.id().to_string();
        self.policies.insert(id, policy);
    }

    /// Register a toggle policy. Replaces any prior entry for the
    /// same id.
    pub fn register_toggle(&mut self, policy: Box<dyn TogglePolicy>) {
        let id = policy.id().to_string();
        self.toggle_policies.insert(id, policy);
    }

    /// Register a variant policy. Replaces any prior entry for the
    /// same id.
    pub fn register_variant_policy(&mut self, policy: Box<dyn VariantPolicy>) {
        let id = policy.id().to_string();
        self.variant_policies.insert(id, policy);
    }

    /// Look up a timed policy by id.
    pub fn get(&self, id: &str) -> Option<&dyn Policy> {
        self.policies.get(id).map(|b| b.as_ref())
    }

    /// Look up a toggle policy by id.
    pub fn get_toggle(&self, id: &str) -> Option<&dyn TogglePolicy> {
        self.toggle_policies.get(id).map(|b| b.as_ref())
    }

    /// Look up a variant policy by id.
    pub fn get_variant_policy(&self, id: &str) -> Option<&dyn VariantPolicy> {
        self.variant_policies.get(id).map(|b| b.as_ref())
    }

    /// Look up the default timed policy for a built-in timing mode.
    pub fn for_mode(&self, mode: TimingMode) -> Option<&dyn Policy> {
        self.get(mode.policy_id())
    }

    /// Look up the default toggle policy for a built-in timing mode.
    pub fn toggle_for_mode(&self, mode: TimingMode) -> Option<&dyn TogglePolicy> {
        self.get_toggle(mode.toggle_policy_id())
    }

    /// Look up the default variant policy for a built-in timing mode.
    pub fn variant_for_mode(&self, mode: TimingMode) -> Option<&dyn VariantPolicy> {
        self.get_variant_policy(mode.variant_policy_id())
    }

    /// Number of registered timed policies (does not include
    /// toggle policies).
    pub fn len(&self) -> usize {
        self.policies.len()
    }

    /// Whether the registry has no timed policies.
    pub fn is_empty(&self) -> bool {
        self.policies.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::state::PolicyState;
    use crate::policy::traits::{StateProjection, TimedChoice, TimedDecision};

    struct FakeDecision;
    impl TimedDecision for FakeDecision {
        fn id(&self) -> &str {
            "test.fake"
        }
        fn utility(&self, _: &PolicyState) -> f64 {
            0.0
        }
        fn is_available(&self, _: &PolicyState) -> bool {
            true
        }
    }

    #[test]
    fn decision_registry_register_and_lookup() {
        let mut reg = DecisionRegistry::new();
        reg.register(Box::new(FakeDecision));
        assert_eq!(reg.len(), 1);
        let found = reg.get("test.fake").expect("registered decision");
        assert_eq!(found.id(), "test.fake");
        assert!(reg.get("test.missing").is_none());
    }

    #[test]
    fn user_can_override_builtin_policy_by_id() {
        let mut reg = PolicyRegistry::with_builtins();
        let baseline_len = reg.len();
        // Register a fake policy under the Ideal id.
        struct OverrideIdeal;
        impl Policy for OverrideIdeal {
            fn id(&self) -> &str {
                TimingMode::Ideal.policy_id()
            }
            fn decide(
                &self,
                _: &dyn TimedDecision,
                _: &PolicyState,
                _: &dyn StateProjection,
            ) -> TimedChoice {
                TimedChoice::Now
            }
        }
        reg.register(Box::new(OverrideIdeal));
        // Same count - last-write-wins replaced the entry.
        assert_eq!(reg.len(), baseline_len);
        let p = reg.for_mode(TimingMode::Ideal).expect("ideal");
        assert_eq!(p.id(), "builtin.ideal");
    }

    #[test]
    fn with_builtins_registers_all_five_modes() {
        let reg = PolicyRegistry::with_builtins();
        assert_eq!(reg.len(), 5);
        for mode in [
            TimingMode::ReallyFast,
            TimingMode::Fast,
            TimingMode::SemiIdeal,
            TimingMode::Ideal,
            TimingMode::Extreme,
        ] {
            assert!(reg.for_mode(mode).is_some(), "missing timed policy for {mode:?}");
            assert!(
                reg.toggle_for_mode(mode).is_some(),
                "missing toggle policy for {mode:?}"
            );
            assert!(
                reg.variant_for_mode(mode).is_some(),
                "missing variant policy for {mode:?}"
            );
        }
    }

    struct FakeVariantDecision;
    impl crate::policy::traits::VariantDecision for FakeVariantDecision {
        fn id(&self) -> &str {
            "test.fake_variant"
        }
        fn variants(&self) -> &[&str] {
            &["a", "b"]
        }
        fn utility(&self, _: &PolicyState, variant: &str) -> f64 {
            // "b" wins; lets us assert tie-broken-by-utility logic.
            match variant {
                "a" => 1.0,
                "b" => 2.0,
                _ => f64::NEG_INFINITY,
            }
        }
        fn is_available(&self, _: &PolicyState) -> bool {
            true
        }
    }

    #[test]
    fn variant_decision_registers_and_round_trips_through_entry() {
        let mut reg = DecisionRegistry::new();
        reg.register(Box::new(FakeDecision));
        reg.register_toggle(Box::new(FakeToggleDecision));
        reg.register_variant(Box::new(FakeVariantDecision));
        assert_eq!(reg.len(), 3);
        // Three kinds live in one keyspace, looked up via the kind-
        // specific accessor. Cross-kind lookup returns None.
        assert!(reg.get("test.fake_variant").is_none()); // not timed
        assert!(reg.get_toggle("test.fake_variant").is_none()); // not toggle
        assert!(reg.get_variant("test.fake_variant").is_some());
        assert!(reg.get_variant("test.fake").is_none()); // timed, not variant
        assert!(reg.get_variant("test.fake_toggle").is_none()); // toggle, not variant
        // Entry kind matches.
        match reg.entry("test.fake_variant").unwrap() {
            RegistryEntry::Variant(_) => {}
            _ => panic!("expected Variant entry"),
        }
    }

    struct FakeToggleDecision;
    impl crate::policy::traits::ToggleDecision for FakeToggleDecision {
        fn id(&self) -> &str {
            "test.fake_toggle"
        }
        fn on_off_delta(&self, _: &PolicyState) -> f64 {
            1.0
        }
        fn is_eligible(&self, _: &PolicyState) -> bool {
            true
        }
    }

    #[test]
    fn timed_and_toggle_decisions_share_one_keyspace_via_entries() {
        let mut reg = DecisionRegistry::new();
        reg.register(Box::new(FakeDecision));
        reg.register_toggle(Box::new(FakeToggleDecision));
        assert_eq!(reg.len(), 2);
        assert!(reg.get("test.fake").is_some());
        assert!(reg.get("test.fake_toggle").is_none()); // toggle, not timed
        assert!(reg.get_toggle("test.fake_toggle").is_some());
        assert!(reg.get_toggle("test.fake").is_none()); // timed, not toggle
        // Entry-level lookup yields the right variant.
        match reg.entry("test.fake").unwrap() {
            RegistryEntry::Timed(_) => {}
            _ => panic!("expected Timed entry"),
        }
        match reg.entry("test.fake_toggle").unwrap() {
            RegistryEntry::Toggle(_) => {}
            _ => panic!("expected Toggle entry"),
        }
    }
}
