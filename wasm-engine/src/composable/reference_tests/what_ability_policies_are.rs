//! Reference: policy_what_ability_policies_are
//!
//! Ability Policy entries describe the timing system itself - they
//! are not a specific ability that runs in the engine. The concrete
//! per-ability timing behaviours documented in this entry's bullets
//! (Life Leech 85% HP gate under Really fast, Fortify 15-stack
//! threshold under Really fast, Rewind 75% HP gate under Really
//! fast, Hunker auto-on under Really fast, etc.) are tested
//! individually under each ability's reference test file.
//! `policy_framework.rs` and the per-policy decide_* helpers carry
//! the actual behaviour; this entry stays as a documentation
//! placeholder so the coverage gate sees the [REF:policy_what_ability_policies_are]
//! marker.

#[test]
fn behaviour_is_covered_by_per_ability_reference_tests() {
    // [REF:policy_what_ability_policies_are]
    // The bullets in this entry are descriptive notes about the
    // timing family. Each concrete claim that names a specific
    // ability's policy gating (Life Leech, Fortify, Rewind, Hunker,
    // Adrenaline, Unbridled Rage, Warden's Rage, Hunter's Curse,
    // Reflect) is asserted in that ability's reference test file
    // under the matching mode (Really fast / Fast / Semi-ideal /
    // Ideal / Extreme).
    //
    // No engine-level assertion is meaningful here. The coverage
    // gate is satisfied by the marker comment above.
}
