//! How far each area ability reaches, and whether a gap defeats it.
//!
//! A facetank has no distance: the two sides stand on each other, every range
//! is satisfied, and the gate below always passes. It exists for the route,
//! where a gap does exist and an ability with 75 studs of reach must not land
//! across 600.
//!
//! Every figure is the ability's own `Range` (or `MaxDistance` for the two
//! projectiles and the wind blast) off its record in the game, in studs. The
//! table lists all of them, including the abilities this engine does not fire,
//! so the set is complete where a reader looks for it.

use crate::contracts::SimpleCombatantStats;

use super::route;
use super::side::CombatSide;

/// Ability name to reach in studs. Frost Nova is absent on purpose - its reach
/// is the creature's own ability value, not a constant. See
/// [`frost_nova_range_studs`].
const ABILITY_RANGE_STUDS: &[(&str, f64)] = &[
    ("Ink Cloud", 60.0),
    ("Grim Lariat", 75.0),
    ("Aura", 100.0),
    ("Cursed Sigil", 100.0),
    ("Poison Area", 100.0),
    ("Earthquake", 125.0),
    ("Cause Fear", 150.0),
    ("Dazzling Flash", 150.0),
    ("Drowsy Area", 150.0),
    ("Gale", 150.0),
    ("Shock Area", 150.0),
    ("Speed Steal", 150.0),
    ("Healing Pulse", 175.0),
    ("Reflux", 250.0),
    ("Moon Beam", 300.0),
    ("Seedling Mist", 350.0),
    ("Area Wind Blast", 400.0),
    ("Lance", 500.0),
];

/// Defiled Ground's reach grows with its stage: 150 at stages 0 and 1, 250 at
/// stage 2, 350 at stage 3.
///
/// Nothing calls this yet. Defiled Ground is not modelled as an ability fired
/// across a distance - it is a level the side is standing on, affecting that
/// side's own ailment recovery - so there is no gap for the reach to cross. The
/// figures are here because they are the ability's own, and a surface that
/// places the ground spatially is what would read them.
#[allow(dead_code)]
const DEFILED_GROUND_STAGE_RANGES: [f64; 4] = [150.0, 150.0, 250.0, 350.0];

/// Frost Nova is the one area ability whose reach is per creature rather than
/// per ability: the game reads the creature's own Frost Nova value and falls
/// back to 75. Across our roster its
/// carriers spread from 70 to 300.
pub(crate) fn frost_nova_range_studs(stats: &SimpleCombatantStats) -> f64 {
    if stats.frost_nova_range_studs > 0.0 {
        stats.frost_nova_range_studs
    } else {
        crate::spec_constants::FROST_NOVA_DEFAULT_RANGE_STUDS
    }
}

#[allow(dead_code)]
pub(crate) fn defiled_ground_range_studs(stage: usize) -> f64 {
    DEFILED_GROUND_STAGE_RANGES[stage.min(DEFILED_GROUND_STAGE_RANGES.len() - 1)]
}

/// The ability's reach, or `None` for an ability that carries no range at all.
/// Escape Area is the worked example of the second case: it applies its buff to
/// the user and to nobody else, so there is no distance for it to cross.
pub(crate) fn ability_range_studs(name: &str, stats: &SimpleCombatantStats) -> Option<f64> {
    if name == "Frost Nova" {
        return Some(frost_nova_range_studs(stats));
    }
    ABILITY_RANGE_STUDS
        .iter()
        .find(|(ability, _)| *ability == name)
        .map(|(_, studs)| *studs)
}

/// Whether `user` can land `name` on the other side right now.
///
/// Three cases, and only the third can refuse. Both sides standing is a fight,
/// where distance is nothing. An ability with no range reaches whatever it was
/// always going to reach. Otherwise the gap between the two has to be inside
/// the ability's own figure.
pub(crate) fn within_reach(
    name: &str,
    user_stats: &SimpleCombatantStats,
    a: &CombatSide,
    b: &CombatSide,
    route_initial_gap_studs: f64,
) -> bool {
    let gap = route::gap_studs(a, b, route_initial_gap_studs);
    if gap <= 0.0 {
        return true;
    }
    match ability_range_studs(name, user_stats) {
        Some(range) => gap <= range + 1e-9,
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats(frost_nova: f64) -> SimpleCombatantStats {
        SimpleCombatantStats {
            frost_nova_range_studs: frost_nova,
            ..Default::default()
        }
    }

    #[test]
    fn frost_nova_reads_the_creature_and_falls_back_to_seventy_five() {
        assert_eq!(frost_nova_range_studs(&stats(300.0)), 300.0);
        assert_eq!(frost_nova_range_studs(&stats(0.0)), 75.0);
        assert_eq!(ability_range_studs("Frost Nova", &stats(70.0)), Some(70.0));
    }

    #[test]
    fn every_other_range_is_a_constant() {
        assert_eq!(ability_range_studs("Grim Lariat", &stats(300.0)), Some(75.0));
        assert_eq!(ability_range_studs("Lance", &stats(0.0)), Some(500.0));
        assert_eq!(ability_range_studs("Escape Area", &stats(0.0)), None);
    }

    /// The three abilities the game builds out of one throw carry the three
    /// reaches it gives them, and each of them refuses a gap one stud wider.
    #[test]
    fn the_three_throws_carry_their_own_reach() {
        for (ability, reach) in [("Reflux", 250.0), ("Seedling Mist", 350.0), ("Lance", 500.0)] {
            assert_eq!(ability_range_studs(ability, &stats(0.0)), Some(reach), "{ability}");

            let user = stats(0.0);
            let mut a = CombatSide::new(&user, None);
            let b = CombatSide::new(&user, None);
            // A gap is only measured while one of the two is travelling; a
            // fight leaves both standing and every reach passes.
            a.movement = route::MovementState::Walking;
            assert!(
                within_reach(ability, &user, &a, &b, reach),
                "{ability} reaches exactly its own figure"
            );
            assert!(
                !within_reach(ability, &user, &a, &b, reach + 1.0),
                "{ability} refuses a gap one stud wider than its reach"
            );
        }
    }

    #[test]
    fn defiled_ground_grows_with_its_stage() {
        assert_eq!(defiled_ground_range_studs(0), 150.0);
        assert_eq!(defiled_ground_range_studs(1), 150.0);
        assert_eq!(defiled_ground_range_studs(2), 250.0);
        assert_eq!(defiled_ground_range_studs(3), 350.0);
        assert_eq!(defiled_ground_range_studs(9), 350.0);
    }
}
