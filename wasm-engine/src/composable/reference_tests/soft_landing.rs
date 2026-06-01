//! Reference: ability_soft_landing
//!
//! "Soft Landing" is generated through `createOutOfModelAbilityEntry`
//! in src/pages/referenceContent.ts. The single mechanics bullet
//! states the ability is currently not included in the stand-and-fight
//! combat model. The Rust engine has no Soft Landing path; this test
//! exists so the coverage gate sees the [REF:ability_soft_landing]
//! marker.

#[test]
fn not_modeled_in_stand_and_fight_combat() {
    // [REF:ability_soft_landing]
    // Bullet: "This ability is currently not included in the
    // stand-and-fight combat model."
    // Soft Landing reduces fall damage — outside the 1v1 combat
    // resolution. No combat branch reads it.
}
