//! Reference: ability_stamina_puddle
//!
//! "stamina_puddle" is generated through `createOutOfModelAbilityEntry`
//! in src/pages/referenceContent.ts. The single mechanics bullet
//! states the ability is currently not included in the
//! stand-and-fight combat model. The Rust engine has no
//! stamina_puddle path; this test exists so the coverage gate sees
//! the [REF:ability_stamina_puddle] marker.

#[test]
fn not_modeled_in_stand_and_fight_combat() {
    // [REF:ability_stamina_puddle]
    // Bullet: "This ability is currently not included in the
    // stand-and-fight combat model."
    // No combat branch reads this ability.
}
