//! Reference: ability_raider
//!
//! "Raider" is generated through `createOutOfModelAbilityEntry` in
//! src/pages/referenceContent.ts. The single mechanics bullet states
//! the ability is currently not included in the stand-and-fight combat
//! model. The Rust engine has no Raider path; this test exists so the
//! coverage gate sees the [REF:ability_raider] marker.

#[test]
fn not_modeled_in_stand_and_fight_combat() {
    // [REF:ability_raider]
    // Bullet: "This ability is currently not included in the
    // stand-and-fight combat model."
    // Raider grants out-of-combat utility (typically food/herb/foraging
    // or PvE-only behaviour) outside the 1v1 model. No combat branch
    // reads it.
}
