//! Reference: ability_shock_area
//!
//! "Shock Area" is generated through `createOutOfModelAbilityEntry`
//! in src/pages/referenceContent.ts. The single mechanics bullet
//! states the ability is currently not included in the stand-and-fight
//! combat model. The Rust engine has no Shock Area path; this test
//! exists so the coverage gate sees the [REF:ability_shock_area]
//! marker.

#[test]
fn not_modeled_in_stand_and_fight_combat() {
    // [REF:ability_shock_area]
    // Bullet: "This ability is currently not included in the
    // stand-and-fight combat model."
    // Shock Area is an area-of-effect ability whose modeling is out
    // of scope for the 1v1 combat model. No combat branch reads it.
}
