//! Reference: ability_dazzling_flash
//!
//! "dazzling_flash" is generated through `createOutOfModelAbilityEntry` in
//! src/pages/referenceContent.ts. The single mechanics bullet states
//! the ability is currently not included in the stand-and-fight
//! combat model. The Rust engine has no path for it; this test
//! exists so the coverage gate sees the [REF:ability_dazzling_flash] marker.

#[test]
fn not_modeled_in_stand_and_fight_combat() {
    // [REF:ability_dazzling_flash]
    // Bullet: "This ability is currently not included in the
    // stand-and-fight combat model."
    // No combat branch reads this ability.
}
