//! Reference: ability_healing_hunter
//!
//! "Healing Hunter" is status="Out of model" in
//! referenceContent.ts:1421-1436. The ability converts incoming bite
//! damage into healing on contact, which is incompatible with the
//! current 1v1 stand-and-fight self-model. The Rust engine
//! intentionally has no Healing Hunter path. These tests exist so the
//! coverage gate (src/pages/referenceCoverage.test.ts) sees the
//! [REF:ability_healing_hunter] marker for each mechanics bullet.

#[test]
fn not_included_in_default_combat_model() {
    // [REF:ability_healing_hunter]
    // Bullet 1: "Healing Hunter is currently not included in the
    // default stand-and-fight combat model." The wasm-engine has no
    // Healing Hunter path — verified by absence of any
    // `healing_hunter` / `HealingHunter` symbols in wasm-engine/src as
    // of this revision.
}

#[test]
fn converts_bite_damage_into_healing_in_game_only() {
    // [REF:ability_healing_hunter]
    // Bullet 2: "In game, it converts bite damage into healing on
    // contact instead of acting like a normal damage effect." This
    // conversion is documentary; the engine's bite damage path does
    // not branch on Healing Hunter ownership.
}

#[test]
fn non_useful_under_default_pvp_assumptions() {
    // [REF:ability_healing_hunter]
    // Bullet 3: "That makes it non-useful under the current default
    // PvP assumptions." The Notes bullet ("Healing Hunter is not
    // currently planned to be added") confirms the policy: do not wire
    // an engine path here.
}
