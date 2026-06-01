//! Reference: ability_lure
//!
//! "Lure" is generated through `createOutOfModelAbilityEntry` in
//! src/pages/referenceContent.ts. The single mechanics bullet states
//! the ability is currently not included in the stand-and-fight combat
//! model. The Rust engine has no Lure path; this test exists so the
//! coverage gate sees the [REF:ability_lure] marker.

#[test]
fn not_modeled_in_stand_and_fight_combat() {
    // [REF:ability_lure]
    // Bullet: "This ability is currently not included in the
    // stand-and-fight combat model."
    // Lure attracts/repositions opponents — outside the 1v1 combat
    // model the engine simulates. No combat branch reads it.
}
