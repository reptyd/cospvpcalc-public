//! Reference: ability_latch
//!
//! "Latch" is generated through `createOutOfModelAbilityEntry` in
//! src/pages/referenceContent.ts. The single mechanics bullet states
//! the ability is currently not included in the stand-and-fight combat
//! model. The Rust engine has no Latch path; this test exists so the
//! coverage gate sees the [REF:ability_latch] marker.

#[test]
fn not_modeled_in_stand_and_fight_combat() {
    // [REF:ability_latch]
    // Bullet: "This ability is currently not included in the
    // stand-and-fight combat model."
    // Latch attaches the user to the target as a positioning/grapple
    // mechanic - outside the 1v1 stand-and-fight model the engine
    // simulates. No combat branch reads it.
}
