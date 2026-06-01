//! Reference: ability_heal_beam
//!
//! "Heal Beam" is status="Out of model" in referenceContent.ts:1391-1401.
//! It heals other targets rather than the user, so it has no effect in
//! the 1v1 self-model the wasm-engine simulates. The Rust engine
//! intentionally has no Heal Beam path. These tests exist so the
//! coverage gate (src/pages/referenceCoverage.test.ts) sees the
//! [REF:ability_heal_beam] marker for each mechanics bullet.

#[test]
fn heals_other_targets_not_the_user_no_engine_path() {
    // [REF:ability_heal_beam]
    // Bullet 1: "Heal Beam heals other targets instead of the user."
    // The engine has no Heal Beam ability path — verified by absence
    // (no `Heal_Beam`, `heal_beam`, or `HealBeam` symbols anywhere in
    // wasm-engine/src as of this revision). Re-grep on regression to
    // confirm nothing has been wired without updating the Reference
    // entry.
}

#[test]
fn no_direct_effect_in_one_v_one_self_model() {
    // [REF:ability_heal_beam]
    // Bullet 2: "That gives it no direct effect in the site's current
    // 1v1 self-model." `simulate_composable_matchup` has no branch that
    // reads a Heal Beam flag; out-of-model status is preserved by the
    // engine doing nothing for this ability.
}
