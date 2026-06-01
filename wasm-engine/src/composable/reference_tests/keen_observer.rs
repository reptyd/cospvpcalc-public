//! Reference: ability_keen_observer
//!
//! "Keen Observer" is generated through `createOutOfModelAbilityEntry`
//! in src/pages/referenceContent.ts. The single mechanics bullet states
//! the ability is currently not included in the stand-and-fight combat
//! model. The Rust engine has no Keen Observer path; this test exists
//! so the coverage gate sees the [REF:ability_keen_observer] marker.

#[test]
fn not_modeled_in_stand_and_fight_combat() {
    // [REF:ability_keen_observer]
    // Bullet: "This ability is currently not included in the
    // stand-and-fight combat model."
    // Keen Observer affects detection / awareness systems outside the
    // 1v1 combat model. The runtime has no branch on it.
}
